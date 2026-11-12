---
sidebar_position: 3
---

# Workflowspec Structure

A **workflowspec** (**wfspec**) is a YAML document that defines one workflow. This page explains
its shape: the top-level keys, tasks and containers, how data moves between tasks, and how control
flow and errors are expressed. The full key-by-key reference is the
[Workflowspec Reference](../reference/workflowspec-reference.md).

## The smallest workflow

```yaml
header:
  schema_version: 2.0.0
  workflow_name: hello-moco

output: '{{ greeting }}'

main:
  task_name: wait-and-greet
  activity:
    type: builtin.delay
    input:
      duration: 1s
  output:
    data: 'hello, the current time is {{ now() }}'
    as: greeting
```

`header` names the workflow, `main` is the logic, and `output` is what the run returns. Everything
under `main` is a **task**.

## Document shape

```yaml
header:                     # Required: identity and metadata
  schema_version: 2.0.0
  workflow_name: order-intake
  tags: [orders]
  metadata:
    default_activity_retry_policy:
      max_attempts: 3

context:                    # Optional: initial variables (values may be expressions)
  status: pending

input:                      # Optional: declared parameters and their defaults
  order_id:                 # no default
  priority: normal

output:                     # Optional: the workflow result
  order_id: '{{ order_id }}'
  status: '{{ status }}'

functions:                  # Optional: private, reusable sub-workflows
  add:
    input: {a: 0, b: 0}
    output: '{{ total }}'
    main:
      set:
        - total: '{{ a + b }}'

main:                       # Required: exactly one task
  tasks:
    - set:
        - status: received
```

| Key | Required | Purpose |
|---|---|---|
| `header` | yes | `schema_version`, `workflow_name`, optional `tags` and `metadata` |
| `context` | no | Initial variables. Each value is evaluated in order and may use earlier ones |
| `input` | no | The parameters a caller may pass, with defaults. Values are not evaluated |
| `output` | no | The workflow result, evaluated after `main` finishes. Absent means `{}` |
| `functions` | no | Named sub-workflows callable from this document only |
| `main` | yes | The single task the workflow runs |

No other top-level keys are allowed.

### header

- `schema_version` — the DSL version the document is written in: `2.0.0`.
- `workflow_name` — the workflow's identity. Lowercase letters, digits, `.`, `_` and `-`, starting
  with a letter or digit: `process-order`, `billing.invoice-sync`. It is the name you run, test,
  publish and reference from other workflows.
- `tags` — free-form labels for search and grouping.
- `metadata` — an open map. The engine reads one key, `default_activity_retry_policy`, the retry
  policy every activity starts from (see [Activities](./activities.md#retry-and-timeout)).

A document has **no version field**. A workflow's version is the version of the package it is
published in (`moco.json`), so cutting a release never means editing the spec. See
[Releasing and Sharing](./release-and-sharing.md).

### input

`input` declares what a caller may pass and gives each parameter a default:

```yaml
input:
  user_id:          # no default: null unless the caller supplies it
  limit: 10
  options:
    verbose: false
    format: json
```

Callers supply values when they run the workflow, from the CLI:

```bash
moco run src/my-workflow.yaml --input '{"user_id": "12345", "limit": 20}'
```

from the [API](../guides/run-moco-workflow-through-api.md), or from a
[parent workflow](./child-workflows.md):

```yaml
- workflow:
    ref: my-workflow
    mode: sync
    input:
      user_id: '{{ customer_id }}'
      limit: 20
```

How input is applied:

- The workflow context is built from `context` first, then `input` defaults, then the caller's
  values, so a caller can override both.
- A parameter with no default that the caller does not supply is simply `null`. **Nothing
  validates it for you.** If the workflow needs it, check it with `raise`:

  ```yaml
  - task_name: require-user-id
    raise:
      if: '{{ not user_id }}'
      type: error
      error_type: ValidationError
      message: user_id is required
  ```

- Extra keys the caller passes are merged into the context too, not rejected.

`input` is also the workflow's documented interface. Keep it accurate, and give a default wherever
a sensible one exists.

### context

Initial variables that always exist, whatever the caller passes. Values may be expressions and may
refer to earlier entries:

```yaml
context:
  items: []
  max_retries: 3
  started_at: '{{ now() }}'
```

Use it for accumulators, flags, and configuration a caller should not need to supply.

### output

The workflow result, evaluated against the final context after `main` completes. It is a single
expression or a mapping:

```yaml
output: '{{ order_result }}'
```

```yaml
output:
  order_id: '{{ order_id }}'
  total: '{{ total }}'
```

Without `output`, the workflow returns `{}`. When a workflow ends early with `raise: terminate`,
`output` is still evaluated and the engine adds a `terminate_message` key.

### functions

A function is a private sub-workflow: `input` (with defaults), `main`, and `output`. It runs with
a fresh context made of its input and returns its output. Call it with a `workflow` task:

```yaml
- workflow:
    function: add
    input: {a: 2, b: 3}
  output:
    as: sum            # 5
```

Functions may call each other, but not recursively. See
[Composing Workflows](./child-workflows.md).

## Tasks

Every node under `main` is a **task**: a mapping with **exactly one kind key** plus any of the
shared keys.

```yaml
task_name: fetch-user              # optional; unique within the document
skip_if: '{{ not user_id }}'       # optional guard
activity:                          # the kind key: exactly one
  type: http.request
  input:
    method: GET
    url: 'https://api.example.com/users/{{ user_id }}'
    output_json: true
output:                            # optional: post-process the result
  data: '{{ _["json"] }}'
  as: user
on_error:                          # optional: handle a failure
  catch: true
  do:
    set:
      - user: null
```

| Shared key | Purpose |
|---|---|
| `task_name` | Names the task in logs, traces and debug events, and lets a [test](../guides/testing.md) mock it. Unique per document |
| `skip_if` | Skip the task when the condition is true. Its result is then `null` and its `output` does not run |
| `props` | Open map. On a `tasks` container, `execute_mode` and `join_type` choose sequential or parallel execution |
| `output` | `set` / `data` / `as`: what the task publishes (see [Data flow](#data-flow)) |
| `on_error` | What to do when the task fails (see [Error handling](#error-handling)) |

A task has no `description` key: document intent with YAML comments.

### Task kinds

| Category | Kind | What it does |
|---|---|---|
| primitive | `activity` | Call an [activity](./activities.md): HTTP, SQL, shell, LLM, ... |
| primitive | `workflow` | Run a child workflow or a function |
| primitive | `set` | Assign variables |
| primitive | `raise` | Fail, stop early, or leave a container or loop |
| primitive | `emit_event` | Publish an [event](./events.md) |
| primitive | `wait_for` | Wait for an event or a timeout |
| primitive | `checkpoint` | Let a long-running workflow continue as new |
| primitive | `state_machine` | Run an event-driven [state machine](./state-machines.md) |
| primitive | `rules_engine` | Run a declarative [rules engine](./rules-engine.md) |
| container | `tasks` | Run child tasks, in order or in parallel |
| control flow | `loop` | Run a task for each item of a collection |
| control flow | `branches` | if / elif / else |
| control flow | `switch` | Match one value against cases |

Every kind is described in the [Tasks reference](../reference/statements.md).

### The `tasks` container

`tasks` holds a list of child tasks. They run in order by default; a value one child writes to the
context is visible to every later child, which is how data is carried from step to step:

```yaml
main:
  tasks:
    - set:
        - start_time: '{{ now() }}'

    - task_name: delay-step
      activity:
        type: builtin.delay
        input:
          duration: 1s

    - set:
        - greeting: Request received at {{ start_time }}, finished at {{ now() }}
```

`props.execute_mode: parallel` starts every child at once (see [Control flow](#control-flow)).

## Data flow

### Where values live

| Written as | Scope | Visible to | Lifetime |
|---|---|---|---|
| `name` | **workflow context** | every later task and the workflow `output` | the run |
| `name@` | **container scope**: the nearest enclosing `tasks` container or loop iteration | later siblings and their children | until that container or iteration ends |
| `_name` | **task-local** | the rest of the same task's `set` / `output` | until the task ends |

The context also holds the values from `context` and `input`. A name is read innermost-first:
task-local, then container scopes from inner to outer, then the context. So a `discount@` shadows a
`discount` in the context while its container runs.

```yaml
- task_name: compute-total
  set:
    - _tax_rate: 0.08                                  # task-local
    - _subtotal: '{{ quantity * unit_price }}'         # task-local
    - total: '{{ round(_subtotal * (1 + _tax_rate), 2) }}'   # context
```

Only `total` survives the task. Use `@` for per-item temporaries in a loop: each iteration gets a
fresh scope, so parallel iterations never overwrite each other and nothing leaks out of the loop.

### A task's result: `_` and `output`

Every kind produces a raw result, bound to `_` while the task's `output` runs:

| Kind | `_` |
|---|---|
| `activity` | the activity's output (a token in `async_mode`) |
| `workflow` | the child's `output`; its `workflow_id` for `async` / `detached` |
| `set` | a mapping of the non-local values it stored |
| `wait_for` | the event, or `null` on timeout |
| `emit_event`, `checkpoint` | `null` |
| `state_machine` | the name of the terminal state reached |
| `rules_engine` | the facts the rules derived |
| `tasks`, `loop` | the list of child or iteration results |
| `branches`, `switch` | the result of the task that ran, or `null` |
| inside `on_error.do` | the error: `{error_type, error_message, error_detail}` |

`output` has three jobs, run in order:

```yaml
- task_name: fetch-order
  activity:
    type: http.request
    input:
      method: GET
      url: 'https://api.example.com/orders/{{ order_id }}'
      output_json: true
  output:
    set:                                  # 1. ordered writes; `_` is the raw result
      - _body: '{{ _["json"] }}'
      - last_order_id: '{{ _body["id"] }}'
    data:                                 # 2. the task's result (default: `_`)
      id: '{{ _body["id"] }}'
      items: '{{ _body["items"] }}'
    as: order                             # 3. store the result in one variable
```

- `set` follows the same rules as a `set` task, so it can write task-locals, container-scope and
  context variables.
- `data` defines what the task returns to its parent, for example what one loop iteration
  contributes to the loop's list. It can read the locals written by `set`.
- `as` accepts the scope markers: `as: order@` stores in the container scope.

**Nothing is merged into the context implicitly.** A child workflow that returns
`{currency: EUR}` does not overwrite your `currency` variable; its value is `_["currency"]` until
you write it somewhere with `output.set` or `output.as`.

To read the merged view of every visible variable, use `__context__`, for example
`'{{ "tier" in __context__ }}'` to ask whether `tier` is defined. See
[Expressions](./expressions.md).

## Control flow

A guard on any task:

```yaml
- task_name: flag-minor
  skip_if: '{{ age >= 18 }}'
  set:
    - is_minor: true
```

if / elif / else, and matching one value against cases:

```yaml
- task_name: age-band
  branches:
    - if: '{{ age < 18 }}'
      do:
        set:
          - band: minor
    - elif: '{{ age < 65 }}'
      do:
        set:
          - band: adult
    - else:
      do:
        set:
          - band: senior

- task_name: region
  switch:
    value: '{{ country }}'
    cases:
      - match: [US, CA]           # a list matches with `in`, anything else with `==`
        do:
          set:
            - region: north-america
    default:
      set:
        - region: rest-of-world
```

A loop, sequential by default, with an optional index:

```yaml
- task_name: price-each-order
  loop:
    in: '{{ orders }}'
    foreach: order                # default name: item
    index: i
    execute_mode: parallel        # optional: run iterations concurrently
    do:
      set:
        - _amount: '{{ order["units"] * order["price"] }}'
      output:
        data:                     # what this iteration contributes
          line: '{{ i + 1 }}'
          amount: '{{ _amount }}'
  output:
    as: priced_lines              # the list of iteration results, in input order
```

Concurrent tasks:

```yaml
- task_name: fetch-in-parallel
  props:
    execute_mode: parallel
    join_type: all                # all (default): wait for every child; any: first success wins
  tasks:
    - activity: {type: builtin.delay, input: {duration: 1s}}
    - activity: {type: builtin.delay, input: {duration: 2s}}
  output:
    as: results                   # child results, in declaration order
```

Leaving early with `raise`:

| `type` | Effect |
|---|---|
| `error` (default) | Fail with `error_type` (default `WorkflowError`) and `message`. Catchable by `on_error` |
| `terminate` | End the whole workflow successfully. `output` is still evaluated |
| `exit` | Leave the nearest `tasks` container; execution continues after it |
| `break` | Leave the nearest `loop` |
| `continue` | Skip the rest of the current loop iteration |

```yaml
- task_name: nothing-to-do
  raise:
    if: '{{ len(items) == 0 }}'
    type: terminate
    message: no items to process
```

A condition (`skip_if`, `raise.if`, `branches`) is an expression that must evaluate to a `bool`,
or a tree of `{and: [...]}`, `{or: [...]}` and `{not: ...}`. See
[Expressions](./expressions.md#conditions).

## Error handling

Errors are handled in two layers.

**Retries.** A failing activity is retried by its retry policy:
`header.metadata.default_activity_retry_policy`, overlaid with the activity's own
`options.retry_policy`. Only the final failure reaches the workflow. Retry policies apply on the
Temporal runtime.

**`on_error`.** Any task can handle its own failure, including failures of its children that were
not handled further down:

```yaml
- task_name: validate-quantity
  raise:
    if: '{{ quantity <= 0 }}'
    type: error
    error_type: ValidationError
    message: 'quantity must be positive, got {{ quantity }}'
  on_error:
    catch: true                   # consume the error; `do`'s result becomes the task's result
    do:
      set:
        - quantity: 1
        - last_error: '{{ _["error_message"] }}'
```

| `on_error` | Behaviour |
|---|---|
| `catch: true` | The error is consumed. The result of `do` (or `null`) becomes the task's result; the task's own `output` is skipped |
| `catch: false` (default) | `do` runs as a cleanup hook, then the error keeps propagating to the parent |
| `do` | A task. Inside it, `_` is `{error_type, error_message, error_detail}` |

`on_error` catches every error type. To handle only the ones you expect, store the error with
`catch: true` and re-raise the others with `raise`. An error raised inside `do` replaces the
original one. `raise: terminate / exit / break / continue` are control signals, not errors, and are
never caught.

## Complete example

```yaml
header:
  schema_version: 2.0.0
  workflow_name: order-processing
  tags: [orders]
  metadata:
    default_activity_retry_policy:
      max_attempts: 3
      timeout_sec: 30

context:
  status: pending

input:
  order_id:                         # required: checked below
  customer_id:                      # required: checked below
  items: []
  shipping_method: standard

output:
  order_id: '{{ order_id }}'
  status: '{{ status }}'
  total: '{{ total }}'
  payment_id: '{{ payment["id"] }}'

main:
  tasks:
    # Validate inputs: fail fast with a clear message.
    - task_name: validate
      raise:
        if:
          or:
            - '{{ not order_id }}'
            - '{{ not customer_id }}'
            - '{{ len(items) == 0 }}'
        type: error
        error_type: ValidationError
        message: 'invalid order: order_id, customer_id and items are required'

    # Price the order. Only `total` reaches the context.
    - task_name: price
      set:
        - _subtotal: '{{ sum(i["price"] * i["qty"] for i in items) }}'
        - _shipping: '{{ 0 if shipping_method == "pickup" else 9.99 }}'
        - total: '{{ round(_subtotal * 1.08 + _shipping, 2) }}'

    # Charge the customer. POST is not idempotent, so send an idempotency key.
    - task_name: charge
      activity:
        type: http.request
        input:
          method: POST
          url: https://payments.example.com/charges
          headers:
            Idempotency-Key: '{{ order_id }}'
          json_data:
            customer_id: '{{ customer_id }}'
            amount: '{{ total }}'
          output_json: true
          raise_for_status: true
      output:
        data: '{{ _["json"] }}'
        as: payment
      on_error:
        do:                         # cleanup, then let the error fail the workflow
          set:
            - status: payment-failed

    - task_name: complete
      set:
        - status: completed
```

## Best practices

- **Names.** Kebab-case for `workflow_name` and `task_name` (`process-customer-order`),
  snake_case for variables (`customer_email`).
- **Keep the context small.** Use `_name` for values only one task needs and `name@` for per-item
  values in a loop. Store what later tasks need, and nothing else.
- **Declare every external parameter in `input`**, with a default where one makes sense.
- **Always write `output`** so callers know what the workflow returns.
- **Validate inputs early** with `raise` and a clear `message`.
- **Name the tasks you want to see** in traces or mock in tests. Document intent with comments.

## Schema validation

Every wfspec is checked against a JSON schema. Validate locally, before anything is published. It
needs no login and no running service, so it belongs in a pre-commit hook and in CI:

```bash
moco validate src/my-workflow.yaml
```

The schema ships with the CLI and also drives autocompletion and inline diagnostics in the VSCode
extension. The service's schema advances as activities are added, so refresh yours occasionally:

```bash
moco schema update     # download the current schema from your Moco service
moco schema show       # show the active schema and where it came from
```

If your editor supports the YAML language server, point a file at the schema directly for
autocompletion without the extension:

```yaml
# yaml-language-server: $schema=<path-to>/workflowspec_schema.json
```

## Next steps

- [Expressions](./expressions.md) — the `{{ }}` language, modifiers and conditions
- [Activities](./activities.md) — calling the outside world
- [Tasks Reference](../reference/statements.md) — every task kind
- [Writing Workflows Guide](../guides/writing-workflows.md) — practical patterns
