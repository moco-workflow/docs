---
sidebar_label: Runtimes
sidebar_position: 2
---

# Runtimes

The same wfspec runs on two different engines. You do not choose between them when you write the
workflow — you choose when you run it, and the workflow does not change.

| | In-memory runtime | Temporal runtime |
|---|---|---|
| Where it runs | In one process | Across distributed workers |
| Durability | None | Full — state survives crashes and restarts |
| Retries and timeouts | Retry policies ignored | Honored |
| `start` / `cancel` / `status` | Not available | Available |
| Waiting for events or long timers | Holds the process open | Free — the workflow is not resident |
| Latency | Lowest | Higher, per step |
| Infrastructure | None | Temporal server and workers |

This is what lets you iterate quickly and still deploy something durable. Run your workflow
in-memory while you are writing it, and run it on Temporal when it matters.

---

## Choosing a runtime

From the CLI, `--in-memory` picks the in-memory runtime; without it you get Temporal:

```bash
moco run src/hello-moco.yaml --in-memory     # fast, no durability
moco run src/hello-moco.yaml                 # durable, distributed
moco test --in-memory                        # the usual choice for a mocked suite
```

Through the API, it is the `execute_mode` option:

```json
{ "options": { "execute_mode": "in-memory" } }
```

There is also a third dispatch mode, `standalone-activity`, which runs the whole wfspec as a single
durable unit on Temporal. All three are compared in
[How Workflows Run](./how-to-run-workflow.md#execute-modes).

---

## What the Temporal runtime gives you

Moco runs on the open-source [Temporal](https://temporal.io) platform, but you never write Temporal
code — the wfspec is the whole interface. What you get from it:

**Durable execution.** Every activity's input and output is recorded. If the worker running your
workflow dies, another one replays the record, rebuilds the state exactly, and continues from the
last completed step. Your workflow contains no checkpointing logic because it does not need any.

**Free waiting.** A workflow blocked on `wait_for` or a long timer is not occupying a process. It
can wait days for a human to click approve. On the in-memory runtime, the same wait ties up the
caller for the duration.

**Retries that mean something.** An activity that fails transiently is retried according to its
retry policy, with exponential backoff, without the workflow knowing. Only a final failure reaches
your logic.

**Scale and isolation.** Activities run on workers, separately from workflow orchestration, so you
add throughput by adding workers. Some activity types run on dedicated workers — `claude_agent.*`
has its own, so a long agent run cannot starve ordinary activity traffic.

**A history you can inspect.** Every run has a complete event log, which is what `moco history`
reads.

---

## What the in-memory runtime gives up

Everything above. The wfspec is interpreted in a single process, and:

- Nothing is recorded, so nothing recovers. A crash loses the run.
- Retry policies are ignored entirely — activities get one attempt.
- There is no workflow ID to address, so `moco start`, `status`, `cancel`, `terminate`, and
  `history` are unavailable. The API returns `400` rather than failing quietly.
- Activities execute in-process rather than on workers.

None of that matters for a short, idempotent workflow whose caller will retry anyway — and for that
shape, skipping the orchestration overhead is a real win. It is also why tests default to it.

---

## Writing runtime-agnostic workflows

Most wfspecs already are. The few things worth knowing:

**Push side effects into activities.** Orchestration logic — conditions, loops, assignments — is
replayed when a workflow recovers. Anything that touches the outside world belongs in an activity,
where its result is recorded once and reused on replay. Writing files or calling APIs from an
expression is the way to get surprising behaviour after a worker restart.

**Read the clock with `now()`.** The `now()` and `uuid4()` helpers are replay-safe: on Temporal
they come from the workflow's deterministic clock and random source. `dt.datetime.now()` does not,
so a replay can see a different value from the original run.

**Assume activities may run more than once.** With retries enabled, they will. Prefer idempotent
operations — upserts over inserts, `PUT` over `POST`, or an idempotency key.

**Set retry policies where they matter, and expect them to be ignored in-memory.** A test run that
passes in-memory has not exercised your retry configuration.

---

## Local activity execution

Even on Temporal, an individual activity can run in the workflow's own process instead of being
dispatched to a worker:

```yaml
- activity:
    type: builtin.delay
    input:
      duration: 1s
    options:
      execute_locally: true
```

This is worth it when the work is shorter than the queue round trip would be. It is not free: a
local activity blocks the workflow while it runs, and skips the dispatch machinery that would
otherwise retry it.

Some activities already do this for you. Short built-ins like `builtin.now` and `builtin.delay` do
it for speed. Every `selenium.*` and `playwright.*` activity does it for correctness — a browser
session only exists in the process that opened it, so the whole session has to stay on one worker.
Details, and the reason not to override it, are in
[Activities that are already local by default](./activities.md#activities-that-are-already-local-by-default).

---

## Next steps

- [How Workflows Run](./how-to-run-workflow.md) — the three execute modes and their options
- [Activities](./activities.md) — retries, timeouts, caching, and local execution
- [Testing Workflows](../guides/testing.md) — why suites run in-memory
- [Deploying on Kubernetes](../guides/kubernetes-deployment.md) — running the Temporal side yourself
