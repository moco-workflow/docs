---
sidebar_label: Composing Workflows
sidebar_position: 8
---

# Composing Workflows

A workflow that does everything itself is a workflow nobody else can reuse. Moco's answer is that a
workflow can run another workflow — and because workflows are published, versioned documents, the
one you call may belong to someone else entirely.

This page is about *why* you would split a workflow up and which composition mechanism fits. For the
exact field list, see the [`workflow` task](../reference/statements.md).

---

## One task, two choices

Every child is run by a `workflow` task. It answers two independent questions:

- **Where does the child come from?** Exactly one *source* key: `ref`, `function`, `contents` or
  `contents_yaml`.
- **How does it run?** The `mode`: `inline` (the default), `sync`, `async` or `detached`.

```yaml
- task_name: charge
  workflow:
    ref: payment-charge          # source
    mode: sync                   # mode
    input:
      amount: "{{ total }}"
  output:
    as: payment_result           # the child's result
```

| Mechanism | Scope | Reach for it when |
|-----------|-------|-------------------|
| `workflow.function` | Inside one wfspec | A few tasks repeat within this workflow |
| `workflow` with `mode: inline` | Another wfspec, run inside the parent's execution | Factoring a long spec into readable files |
| `workflow` with `mode: sync` / `async` / `detached` | Another wfspec, run as its own workflow | Reusing something independently owned, giving a child its own retries, or fanning work out |
| `builtin.execute_workflow` activity | Another wfspec, as one activity | Large data or CPU-bound work you want in a single unit |

---

## Data in, data out

Whatever the source and the mode, a child **starts with a fresh context made only of its `input`**.
It cannot see the parent's variables, and nothing it sets leaks back. The contract is:

- **In:** the task's `input` map. Inside the child, the values arrive as the child's declared
  `input` (with its defaults filling any gaps).
- **Out:** the child's top-level `output`, which becomes the task's raw output `_`. Store it with
  `output.as`, or reshape it first with `output.data`.

```yaml
- task_name: price-order
  workflow:
    ref: pricing
    input:
      sku: "{{ sku }}"
      qty: "{{ qty }}"
  output:
    data: '{{ _["total"] }}'     # keep just the number
    as: order_total
```

This holds for `inline` children too. Nothing crosses the boundary except `input` and the result,
which is what makes a child safe to call from several places, and safe to hand to another owner.

---

## Functions: reuse within a spec

When the repetition is local, a separate wfspec is too much ceremony. Declare a function in the
document's `functions` block and call it with `workflow.function`:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: invoice

input:
  lines:
    - {price: 10, qty: 3}
    - {price: 4, qty: 5}

functions:
  line_total:
    input:
      price: 0
      qty: 0
    output:
      total: "{{ price * qty }}"
    main:
      set: []                    # no work: `output` computes the result

output:
  totals: "{{ totals }}"

main:
  task_name: price-lines
  loop:
    in: "{{ lines }}"
    foreach: line
    do:
      workflow:
        function: line_total
        input:
          price: '{{ line["price"] }}'
          qty: '{{ line["qty"] }}'
      output:
        data: '{{ _["total"] }}'
  output:
    as: totals                   # [30, 20]
```

A function is a private sub-workflow: `input` (parameters and defaults), `output` (its result) and
`main` (one task). It always runs `inline`, with the same fresh-context rule as any other child.
Functions are visible only inside the document that defines them. A function may call its sibling
functions, but recursion — direct or indirect — is rejected.

---

## Modes

The `mode` decides whether the child is a separate workflow, and whether the parent waits.

| Mode | Separate workflow | Parent waits | `_` is |
|------|-------------------|--------------|--------|
| `inline` (default) | No | Yes | the child's result |
| `sync` | Yes | Yes | the child's result |
| `async` | Yes | No | the child's `workflow_id` |
| `detached` | Yes, outlives the parent | No | the child's `workflow_id` |

### `inline` — the default

The child runs inside the parent's own execution: same `workflow_id`, no separate history, no
separate retries. It is the cheapest mode, and the parent waits for the result.

```yaml
- task_name: validate
  workflow:
    ref: validate-order
    input:
      order: "{{ order }}"
  output:
    as: validation
```

Use it to split a long spec into readable pieces. Its data isolation is the same as `sync`, so the
choice between the two is about execution cost and failure isolation, not about data.

### `sync` — an independent call

The child runs as a genuinely separate workflow, with its own derived id, history, retries and
timeouts. The parent waits for the result.

```yaml
- task_name: charge
  workflow:
    ref: payment-charge
    mode: sync
    input:
      amount: "{{ total }}"
    options:
      retry_policy:
        timeout_sec: 300
  output:
    as: payment_result
```

Reach for `sync` when the child needs its own `retry_policy`, its own timeout, or its own entry in
the workflow history — typically when someone else owns it. On Temporal a `sync` child is a real
child workflow; the in-memory runtime runs it in-process.

### `async` — start and keep going

The parent gets the child's `workflow_id` as soon as the child starts, and carries on. Use it to fan
work out:

```yaml
- task_name: start-reports
  loop:
    in: "{{ regions }}"
    foreach: region
    do:
      workflow:
        ref: regional-report
        mode: async
        input:
          region: "{{ region }}"
  output:
    as: child_ids                # one workflow_id per region
```

An `async` child is tied to the parent's lifetime: if the parent finishes first, the child is
cancelled. To collect results, have the children `emit_event` back to the parent and have the
parent `wait_for` them — see [Events](./events.md).

### `detached` — cut loose

Like `async`, but the child survives the parent. Use it for work that must finish regardless — a
cleanup job, a notification pipeline, an audit trail — or to hand off to a long-running workflow
while the caller returns immediately.

The flip side is that you have given up control: the parent has no handle on the outcome beyond the
`workflow_id`, so whatever the child does must be safe unattended.

---

## Where the child comes from

### `ref` — a published workflow

```yaml
workflow:
  ref: payment-charge
```

`ref` names a published workflow. It resolves through the deployment for the calling user and tier,
so the owner of `payment-charge` can ship a fix without every caller editing their spec. This is how
workflows are shared: you call a name, not a file.

The string form is a `/`-separated path. The last segment is the workflow name; the segment before
it may be a version pattern; what remains is the package. A leading `/` makes the first segment a
namespace.

| `ref` | Resolves to |
|-------|-------------|
| `payment-charge` | A workflow in the caller's package, or a uniquely named workflow |
| `payments/payment-charge` | Workflow `payment-charge` in package `payments`, caller's namespace, latest version |
| `payments/1.*/payment-charge` | The same, highest `1.x.y` version |
| `/finance/payments/1.2.0/payment-charge` | Namespace `finance`, package `payments`, version `1.2.0` |

The mapping form spells the parts out:

```yaml
workflow:
  ref:
    namespace: finance
    name: payments/payment-charge
    version: "1.*"
```

Omit the version and you get whatever the stage resolves to — the highest version visible to the
caller. Pin a version, or a wildcard such as `1.*`, when you need the behaviour frozen. `ref` may
also be an expression, to pick a published workflow at runtime.

When you run a spec from source (`moco run src/parent.yaml`), the CLI bundles the local files its
`ref`s point to and sends them along, so you can iterate on a whole tree without publishing.

### `contents` — the child written inline

```yaml
- task_name: double
  workflow:
    contents:
      - header:
          schema_version: 2.0.0
          workflow_name: doubler
        input:
          x: 0
        output: "{{ doubled }}"
        main:
          set:
            - doubled: "{{ x * 2 }}"
    input:
      x: 21
  output:
    as: doubled                  # 42
```

`contents` is a list of complete wfspec documents. The first is the entry point; later ones are
reachable from it by `ref`. The spec travels with the call — useful for self-contained examples and
tests, and for small helpers that are not worth publishing.

### `contents_yaml` — the child as text

`contents_yaml` takes the same documents as YAML **text** — a string, or a list of strings. Because
the text can come from an expression, a workflow can choose or build a child at runtime:

```yaml
context:
  cache_resolver#literal: |
    header:
      schema_version: 2.0.0
      workflow_name: fx-cache
    output:
      rate: 1.0
    main:
      set: []

main:
  task_name: resolve-fx
  workflow:
    contents_yaml: "{{ cache_resolver if source == 'cache' else catalog_resolver }}"
  output:
    as: fx
```

`#literal` keeps the stored text's `{{ }}` unevaluated until the child runs. Use a literal block
(`|`), not a folded one (`>`), so the lines of the child stay apart. This is the basis for
generated and agent-authored workflows: a dynamically generated child is just a string your
workflow computed.

---

## When a child fails

A failing child raises in the parent like any other task error: the `workflow` task fails, and so
does its parent unless something handles it. Handle it with the task's `on_error`:

```yaml
- task_name: charge
  workflow:
    ref: payment-charge
    mode: sync
    input:
      amount: "{{ total }}"
  output:
    as: payment_result
  on_error:
    catch: true                  # consume the error; the workflow carries on
    do:
      set:
        - payment_result:
            status: failed
            reason: '{{ _["error_message"] }}'
```

Inside `on_error.do`, `_` is `{error_type, error_message, error_detail}`. With `catch: true` the
error is consumed and the task's result is the result of `do`; without it, `do` runs as cleanup and
the error still propagates. See the [Workflowspec Reference](../reference/workflowspec-reference.md) for the full error model.

`async` and `detached` children run on their own, so their later failures do not reach the parent;
only a failure to *start* them does.

---

## Per-child options

A `workflow` task can carry `options`, applying to that child only:

```yaml
- task_name: slow-report
  workflow:
    ref: slow-report
    mode: sync
    options:
      retry_policy:
        timeout_sec: 1800
        max_attempts: 2
      debug_mode: true
  output:
    as: report
```

| Option | Purpose |
|--------|---------|
| `retry_policy` | Timeout and retry configuration for the child (Temporal only) |
| `execute_mode` | `workflow`, `standalone-activity` or `in-memory` — see [How Workflows Run](./how-to-run-workflow.md) |
| `debug_mode`, `debug_info` | Emit debug events from the child |
| `enable_otel_trace` | Emit OpenTelemetry spans |
| `entity_workflow_args` | Entity-workflow configuration |

Every `retry_policy` field except `non_retryable_error_types` may be an expression, evaluated when
the task runs, so a child's timeout or attempt count can depend on the parent's data:

```yaml
- task_name: build-report
  workflow:
    ref: build-report
    mode: sync
    input:
      rows: "{{ rows }}"
    options:
      retry_policy:
        timeout_sec: "{{ 60 + len(rows) // 100 }}"     # scale with the input
        max_attempts: "{{ 1 if dry_run else 3 }}"
  output:
    as: report
```

The engine derives the child's `workflow_id`, `tier` and `trace_id` from the parent, so they are not
options. `trace_id` in particular is inherited: parent and every descendant share one trace, so a
whole tree is greppable by a single ID.

To start a child at an address of your choosing — an
[entity workflow](./how-to-run-workflow.md#entity-workflows) — use `emit_event` with
`entity_workflow` and a `target_workflow_id`: it starts the entity if it is not running and delivers
the event either way. See [Events](./events.md#starting-an-entity-workflow-signal-with-start).

---

## Running a workflow as an activity

`builtin.execute_workflow` runs a wfspec as a *single activity* instead of as a child workflow. Its
input names the spec (`wfspec.name` for a published one, `wfspec.content` for YAML text) and the
child's input:

```yaml
- task_name: transform-dataset
  activity:
    type: builtin.execute_workflow
    input:
      wfspec:
        name: transform-dataset
      input_data:
        source: "{{ path }}"
  output:
    as: dataset
```

The difference is where the durability boundary sits. A child workflow records every task; an
activity records one result. On Temporal every activity input and output crosses the wire and is
capped at 2 MB, so for a spec that moves a large dataframe through several transforms this is the
difference between marshalling the frame repeatedly and not marshalling it at all.

What you give up is observability: the embedded tasks are not individual Temporal activities, so
there is no per-task history and no per-task retry — the whole run succeeds or fails as one unit,
and a restart re-runs it from the top. It must be idempotent. This is the in-workflow form of
`execute_mode: standalone-activity`; see
[How Workflows Run](./how-to-run-workflow.md#standalone-activity--one-durable-unit) and the
[`builtin.execute_workflow` reference](../reference/activities/builtin-core.md#builtinexecute_workflow).

---

## Designing for reuse

**Publish the interface, not the internals.** A child's contract is its `input` and its `output`.
Keep both stable and you can rewrite everything between them.

**Pick the mode for execution, not for data.** Every child is isolated. Use `inline` for cheap
in-process composition; use `sync` when the child deserves its own retries, timeout and history —
usually when another team owns it.

**Version deliberately.** Callers who omit the version roll forward with you — good for a bug fix,
bad for a changed output shape. A breaking change deserves a major version, so callers who pinned
`1.*` stay where they are.

**Watch the depth.** Every level adds latency and history. A tree three deep is usually a sign that
some middle layer is only passing data through.

---

## Next steps

- [`workflow` task](../reference/statements.md) — full field reference
- [Events](./events.md) — collecting results from `async` children
- [Releasing and Sharing Workflows](./release-and-sharing.md) — how a name becomes resolvable
