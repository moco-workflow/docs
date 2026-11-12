---
sidebar_label: How Workflows Run
sidebar_position: 7
---

# How Workflows Run

A wfspec says *what* should happen. It says nothing about *how* the run is dispatched —
whether it becomes a durable distributed workflow, a single retryable unit of work, or a function
call in a server process. That choice is made per run, through **execute options**, and the same
spec works under all of them.

This separation is deliberate. Durability is not free: every step of a durable workflow is recorded,
marshalled, and replayable, which costs latency and imposes payload limits. Some workflows need all
of it. Many are idempotent request-response operations that would rather be fast. You should not
have to rewrite a workflow to move between the two.

---

## Execute modes

Set `execute_mode` on a run to choose how it is dispatched. The default is `workflow`.

| Mode | Durability | Async control | Best for |
|------|-----------|---------------|----------|
| `workflow` | Full — every step recoverable | Yes | Long-running, event-driven, or business-critical workflows |
| `standalone-activity` | Top level only | Yes | Idempotent workflows moving large data or doing CPU-bound work |
| `in-memory` | None | No | Idempotent, short, latency-sensitive workflows |

### `workflow` — durable distributed execution

The default. The wfspec runs as a Temporal workflow, and each activity in it is dispatched to a
worker as a separate Temporal activity. Temporal records the input and output of every step in an
event history.

That history is what makes the run durable. If a worker dies mid-workflow, another worker replays
the history to rebuild the exact in-memory state and carries on from the last completed step —
without the workflow containing a single line of checkpointing logic. It is also what makes
`wait_for` viable: a workflow can sit idle for days waiting on a human approval without holding a
process open.

`sync`, `async` and `detached` child workflows and activities map directly onto the corresponding
Temporal concepts, so retries, timeouts, and cancellation all behave the way Temporal's do.

Use it unless you have a specific reason not to.

### `standalone-activity` — one durable unit

The whole wfspec runs as a **single** Temporal activity rather than as a workflow. Temporal knows
about the run, can retry it, and can time it out — but it knows nothing about what happens inside.
Intermediate state is not persisted, so an interruption restarts the wfspec from the beginning
rather than resuming mid-way.

What you gain is everything the per-step recording costs:

- No marshalling of intermediate results through the Temporal history
- No activity payload size limit on data passed between steps
- Substantially lower overhead for workflows with many small steps

That makes it the right mode for a data-heavy or CPU-bound workflow — one that pulls a large
dataframe, transforms it across several steps, and writes it somewhere. Passing that dataframe
between steps as Temporal activity payloads is exactly what you want to avoid.

Because a restart re-runs the whole spec, the workflow should be **idempotent**.

Long runs in this mode heartbeat so Temporal can detect a dead worker: `heartbeat_timeout_sec` and
`heartbeat_interval_sec` default to 60 s and 20 s, and both are overridable through `retry_policy`.

```bash
moco run src/etl.yaml --activity
```

### `in-memory` — no Temporal at all

The wfspec is interpreted in the calling process — the Moco server, or a desktop application
embedding the engine. Nothing is recorded, nothing is distributed, and nothing survives a crash.

This is the micro-service shape: a workflow used as a request-response endpoint, where the caller is
going to retry on failure anyway and every millisecond of orchestration overhead is visible in the
response time. It is also the mode tests run in, since it needs no infrastructure.

The trade-offs are absolute rather than gradual:

- No durability, no recovery, no replay
- No `start` / `cancel` / `terminate` / `status` — there is no durable handle to address
- `retry_policy` is ignored
- Activities run in-process on the server, not on a worker

```bash
moco run src/lookup.yaml --in-memory
```

### Choosing

Start with `workflow`. Move a workflow to `standalone-activity` when per-step recording is
measurably in your way — large intermediate payloads or a very high step count — and the workflow
is idempotent. Move to `in-memory` when the workflow is short, idempotent, and latency is the
dominant concern.

A workflow that waits on events, runs for hours, or must not be re-executed from the top belongs in
`workflow` mode regardless of how attractive the other two look.

---

## Entity workflows

An **entity workflow** is a long-lived workflow instance that represents one domain object — an
order, a device, a user session — and is addressed by a deterministic ID rather than started afresh
each time. It stays alive waiting for events, keeps state across interactions, and typically has a
[state machine](./state-machines.md) as its `main`.

The pattern is the Actor Model expressed in workflows: instead of a database row plus handlers that
load and save it, the entity *is* a running workflow holding its own state.

Two things make it work:

**A deterministic workflow ID.** `order-entity:ORD-001` is the entity's address. Anyone who knows
the order ID can reach the instance.

**Start-or-signal.** Setting `is_entity_workflow` tells Moco to use Temporal's *use existing*
conflict policy: starting a workflow whose ID is already running delivers the event to the running
instance instead of failing. Callers do not have to know, or check, whether the entity is alive.

```json
{
  "options": {
    "workflow_id": "order-entity:ORD-001",
    "entity_workflow_args": {
      "is_entity_workflow": true,
      "signal_name": "order_events",
      "signal_input": {
        "event_type": "add_item",
        "data": { "sku": "WIDGET-A", "price": 10 }
      }
    }
  }
}
```

`signal_name` is the topic the entity's state machine listens on (its `event_source_topic`), and
`signal_input` is the event delivered atomically with the start — so the first command is never
lost to a race between starting the entity and sending to it.

Entity workflows require `execute_mode: "workflow"`; `workflow_id` must be set explicitly.

From inside a workflow, the same start-or-signal is an `emit_event` task with an `entity_workflow`
block. `target_workflow_id` is the entity's address:

```yaml
- task_name: add-item
  emit_event:
    topic: order_events
    event_type: add_item
    target_workflow_id: "order-entity:{{ order_id }}"
    data:
      sku: WIDGET-A
      price: 10
    entity_workflow:
      ref: order-entity
      input:
        order_id: "{{ order_id }}"
```

See [Events](./events.md#starting-an-entity-workflow-signal-with-start).

An entity that lives long enough will accumulate event history. Give its state machine a
[`checkpoint_policy`](./state-machines.md#long-running-machines), or use a `checkpoint` task in a
looping workflow, to continue as new and keep the history bounded.

---

## Execute options

Execute options travel alongside the run, not inside the spec — the same wfspec can be run at a
different tier, with a different timeout, under a different trace, without being edited. The
workflow's version is not an option either: it is the version of the package the wfspec was
published in, picked by name resolution (see [Releasing and Sharing](./release-and-sharing.md)).

| Option | Purpose |
|--------|---------|
| `execute_mode` | Dispatch mode: `workflow`, `standalone-activity`, or `in-memory` |
| `tier` | Execution stage — `dev`, `beta`, `prod`. Decides which deployed version a name resolves to |
| `workflow_id` | The run's address. Generated when omitted |
| `trace_id` | Correlation ID shared with every child workflow. Generated when omitted |
| `debug_mode` | Emit debug events, including variables marked with `#` |
| `enable_otel_trace` | Emit OpenTelemetry spans |
| `catch_exception` | Return the error as the run's result instead of failing the run. Top-level runs only — inside a workflow, handle a child's failure with `on_error` |
| `retry_policy` | Timeout and retry configuration for the run |
| `entity_workflow_args` | Entity-workflow configuration, as above |

### Identity: `trace_id` and `workflow_id`

`trace_id` identifies a *logical operation*. It is inherited by every child workflow, so one trace
ID gathers a parent and its whole subtree in logs and traces. `workflow_id` identifies a *single
instance*, and is the handle for status, cancel, and terminate.

Both are generated when omitted. Supply them when Moco is one step in a larger system and you want
your own request ID to follow the work through it. A generated workflow ID has the form
`{workflow_name}:{version}:{user_id}:{trace_id}`.

### `retry_policy`

`retry_policy` configures the run as a whole:

```yaml
retry_policy:
  timeout_sec: 600          # overall run timeout; 24 hours when unset
  max_attempts: 3           # 0 means unlimited; workflows default to 1
  initial_interval_sec: 1
  backoff_coefficient: 2.0
  maximum_interval_sec: 60
  non_retryable_error_types: ["ValidationError"]
```

Workflows default to a **single attempt**. Moco does not retry a whole workflow by default because
the useful retry boundary is almost always the individual activity — retrying the workflow would
re-run everything that already succeeded. Set `max_attempts` at the workflow level only when the
whole spec is idempotent.

This run-level policy is passed by the caller and is not part of the spec, so its values are plain
numbers, never expressions.

This policy governs the run as a whole. Individual activities carry their own retry policy in the
spec — `options.retry_policy` on the `activity` task, over a document-wide default in
`header.metadata.default_activity_retry_policy` — and that is the level to tune first:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: fetch-report
  metadata:
    default_activity_retry_policy:
      timeout_sec: 60
      max_attempts: 3

input:
  fast: false

main:
  task_name: fetch
  activity:
    type: http.request
    input:
      method: GET
      url: https://example.com/report
    options:
      retry_policy:
        max_attempts: 5        # overrides the default, key by key
        timeout_sec: '{{ 30 if fast else 120 }}'   # spec-level fields may be expressions
```

See the [`activity` task](../reference/statements.md).

Only the Temporal runtime honors these settings. The in-memory runtime ignores them.

### Tiers

`tier` selects the deployment stage a workflow **name** resolves through. The same call —
`{"name": "hello-moco"}` — reaches the `dev` version or the `prod` version depending on the tier,
which is how a workflow is promoted without any caller changing. It is also visible to the workflow
itself as `__sys_info__.tier`, so a spec can point at a staging endpoint when it is not running in
production.

---

## Where runs are started from

The same three modes and the same options are available from every entry point:

| Entry point | How |
|-------------|-----|
| [CLI](../guides/use-moco-cli.md) | `moco run` / `moco start`, with `--in-memory`, `--activity`, `--tier`, `--debug` |
| [REST API](../guides/run-moco-workflow-through-api.md#openapi) | `POST /api/workflow/execute` with an `options` object |
| [MCP](../guides/run-moco-workflow-through-api.md#mcp) | `execute_workflow` / `start_workflow` tools |
| Web console | Run a deployed workflow from its wfspec page |
| Another workflow | A [`workflow` task](./child-workflows.md#per-child-options), passing `options` |

---

## Next steps

- [Running Workflows Through the API](../guides/run-moco-workflow-through-api.md) — wire format
- [Using the Moco CLI](../guides/use-moco-cli.md) — the same options as flags
- [Dual Runtime](./dual-runtime.md) — how the in-memory and Temporal runtimes differ
- [State Machines](./state-machines.md) — the usual `main` of an entity workflow
