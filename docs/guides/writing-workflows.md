---
sidebar_label: Writing Workflows
sidebar_position: 2
---

# Writing Workflows

This guide builds a workflow one feature at a time: a single task, then several, then data flow,
conditions, loops, parallelism, error handling and reuse. It assumes you have the CLI installed and
can run a workflow. If not, start with the [Quick Start](../quick-start.md).

Every complete example on this page is a valid wfspec: save it to a file, run
`moco validate <file>`, then `moco run <file>`.

---

## Anatomy of a wfspec

A wfspec is a YAML file with these top-level keys:

| Key | Required | Purpose |
|-----|----------|---------|
| `header` | yes | `schema_version` (`2.0.0`) and `workflow_name`; optional `tags` and `metadata` |
| `context` | no | Initial variables. Values may be expressions, evaluated in order |
| `input` | no | Declared parameters and their defaults. The caller's values win |
| `output` | no | The workflow result, evaluated after `main` finishes. Without it the result is `{}` |
| `functions` | no | Reusable sub-workflows private to this document |
| `main` | yes | The workflow logic: **one task** |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: my-workflow      # lowercase letters, digits, '.', '_', '-'
  tags: [orders]

context:                          # always present; a caller may still override
  base_url: https://api.example.com

input:                            # parameters
  order_id:                       # no default
  timeout: 60                     # default 60

output:                           # what the caller gets back
  result: '{{ result }}'

main:
  set:
    - result: Hello from {{ order_id }}
```

A wfspec has no version of its own: it takes the version of the package it is published in
(`moco.json`).

### Tasks

Everything under `main` is a **task**. A task has exactly one **kind** key, which says what it
does, plus optional shared keys:

| Kind | Does |
|------|------|
| `activity` | Calls an activity: HTTP, SQL, email, an LLM, ... |
| `workflow` | Runs a child workflow or a function |
| `set` | Assigns variables |
| `tasks` | Runs a list of tasks, in order or in parallel |
| `loop` | Runs a task once per item |
| `branches` / `switch` | Picks one task to run |
| `raise` | Fails, or leaves a container, loop or the workflow early |
| `emit_event` / `wait_for` | Publishes / waits for an event |
| `state_machine` / `rules_engine` | Event-driven and rule-based logic |
| `checkpoint` | Lets a long-running workflow continue as new |

| Shared key | Purpose |
|------------|---------|
| `task_name` | Names the task in logs and traces; the handle tests use to mock it. Unique per document |
| `skip_if` | A condition; when true the task does not run |
| `output` | Post-processes the task's result: `set`, `data`, `as` |
| `on_error` | Handles the task's failure |
| `props` | Options; `execute_mode` and `join_type` apply to a `tasks` container |

A task has no description field — use YAML comments. The [Tasks reference](../reference/statements.md)
covers every kind in full.

---

## Step 1: one task

The smallest useful workflow calls one activity and returns something:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: get-ip

output: '{{ ip }}'

main:
  task_name: fetch-ip
  activity:
    type: http.request
    input:
      method: GET
      url: https://httpbin.org/ip
      output_json: true
  output:
    data: '{{ _["json"]["origin"] }}'
    as: ip
```

Inside a task's `output`, `_` is what the kind returned — here the HTTP response
(`{status_code, is_success, headers, json}`). `output.data` turns it into the task's result, and
`output.as` stores that result in a variable. The top-level `output` then returns it.

---

## Step 2: several tasks in order

`main` takes one task, so for several steps use a `tasks` container. Its children run in order, and
a variable one child writes is visible to every later child:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: order-total

input:
  quantity: 3
  unit_price: 19.99

output:
  total: '{{ total }}'
  received_at: '{{ received_at }}'

main:
  tasks:
    - set:
        - received_at: '{{ now() }}'

    - task_name: compute-total
      set:
        - _tax_rate: 0.08
        - _subtotal: '{{ quantity * unit_price }}'
        - total: '{{ round(_subtotal * (1 + _tax_rate), 2) }}'
```

The entries of a `set` run in order, and each can read the earlier ones.

The name you write to decides where the value lives:

| Name | Stored in | Visible to |
|------|-----------|------------|
| `total` | the workflow context | every later task and the workflow `output` |
| `_subtotal` | the task's local scope | the rest of this task (`set`, `output`), then discarded |
| `total@` | the nearest container scope | later tasks in the same `tasks` container or loop iteration |

Use `_name` for intermediate values, so the context holds only what later tasks need.

---

## Step 3: shaping a task's result

A task's `output` has three jobs, run in this order:

| Key | Does |
|-----|------|
| `set` | Ordered writes, like a `set` task. `_` is the raw result |
| `data` | The task's result (default: `_`). Can read the locals written by `set` |
| `as` | Stores the result in one variable |

```yaml
- task_name: fetch-order
  activity:
    type: http.request
    input:
      method: GET
      url: '{{ base_url }}/orders/{{ order_id }}'
      output_json: true
      raise_for_status: true
  output:
    set:
      - customer_id: '{{ _["json"]["customer_id"] }}'   # pick one value out
      - _items: '{{ _["json"]["items"] }}'
    data:                                              # reshape the rest
      id: '{{ order_id }}'
      total: '{{ sum(i["price"] * i["qty"] for i in _items) }}'
    as: order
```

Nothing a task returns becomes a variable unless you write it. A child workflow that returns a key
called `currency` does not overwrite your `currency` variable — read it as `_["currency"]`.

---

## Step 4: conditions

### Skip a task

Every task accepts `skip_if`. A skipped task does not run, its result is `null`, and its `output`
does not run:

```yaml
- task_name: notify-large-order
  skip_if: '{{ order["total"] < 1000 }}'
  activity:
    type: email.send
    input:
      from_address: orders@example.com
      to_addresses: [sales@example.com]
      subject: Large order {{ order_id }}
      body_text: 'Total: {{ order["total"] }}'
```

A skipped task writes nothing, so check before reading a variable it would have set:
`'{{ tier if "tier" in __context__ else "standard" }}'`. `__context__` is the merged view of every
visible variable.

### if / elif / else

```yaml
- task_name: shipping-band
  branches:
    - if: '{{ order["total"] >= 100 }}'
      do:
        set:
          - shipping: 0
    - elif: '{{ order["total"] >= 50 }}'
      do:
        set:
          - shipping: 4.99
    - else:
      do:
        set:
          - shipping: 9.99
```

### One value, many cases

`switch` evaluates `value` once. A case matches with `==`, or with `in` when `match` is a list:

```yaml
- task_name: region
  switch:
    value: '{{ country }}'
    cases:
      - match: [US, CA]
        do:
          set:
            - region: north-america
      - match: [GB, FR, DE]
        do:
          set:
            - region: europe
    default:
      set:
        - region: rest-of-world
```

### Combining conditions

A condition is an expression that must evaluate to a boolean, or a tree of `and`, `or` and `not`
that short-circuits:

```yaml
- task_name: domestic-member-discount
  skip_if:
    not:
      and:
        - '{{ country == "US" }}'
        - '{{ is_member }}'
  set:
    - discount: 0.15
```

---

## Step 5: loops

`loop` runs its `do` task once per item of `in`. The loop's result is the list of iteration
results, in input order, so put an `output` on `do` to choose what each item contributes:

```yaml
- task_name: price-lines
  loop:
    in: '{{ order_lines }}'
    foreach: line              # the loop variable (default: item)
    index: i                   # optional 0-based position
    do:
      set:
        - _amount: '{{ round(line["qty"] * line["price"], 2) }}'
      output:
        data:
          line_no: '{{ i + 1 }}'
          sku: '{{ line["sku"] }}'
          amount: '{{ _amount }}'
  output:
    as: priced_lines
```

Each iteration has its own container scope holding `line` and `i`. Write per-item temporaries with
`@` so they stay inside the iteration and never clash between items:

```yaml
- task_name: check-stock
  loop:
    in: '{{ order_lines }}'
    foreach: line
    execute_mode: parallel     # run the iterations concurrently
    do:
      tasks:
        - task_name: lookup-stock
          activity:
            type: http.request
            input:
              method: GET
              url: '{{ base_url }}/stock/{{ line["sku"] }}'
              output_json: true
          output:
            set:
              - available@: '{{ _["json"]["available"] }}'
        - set:
            - ok@: '{{ available >= line["qty"] }}'
      output:
        data: {sku: '{{ line["sku"] }}', ok: '{{ ok }}'}
  output:
    as: stock_checks
```

`execute_mode: parallel` runs all iterations at once. With the default `join_type: all` every
iteration must succeed; with `join_type: any` the first success wins and the rest are cancelled.
Nested loops must use different `foreach` names; the outer variable stays visible inside.

---

## Step 6: parallel tasks

To run different tasks at the same time, give a `tasks` container `props.execute_mode: parallel`:

```yaml
- task_name: fetch-profile
  props:
    execute_mode: parallel
    join_type: all             # wait for all; fail if any fails
  tasks:
    - task_name: fetch-user
      activity:
        type: http.request
        input:
          method: GET
          url: '{{ base_url }}/users/{{ user_id }}'
          output_json: true
      output:
        data: '{{ _["json"] }}'
        as: user

    - task_name: fetch-orders
      activity:
        type: http.request
        input:
          method: GET
          url: '{{ base_url }}/users/{{ user_id }}/orders'
          output_json: true
      output:
        data: '{{ _["json"] }}'
        as: orders
```

Both `user` and `orders` are available after the container completes. The container's own result is
the list of its children's results, in declaration order. With `join_type: any` it is the result of
the first child to succeed.

---

## Step 7: errors

### Validate early

`raise` with `type: error` fails the workflow. Its `if` reads as "raise ... if ...":

```yaml
- task_name: validate-input
  tasks:
    - raise:
        if: '{{ not order_id }}'
        type: error
        error_type: ValidationError
        message: order_id is required
    - raise:
        if: '{{ quantity <= 0 }}'
        type: error
        error_type: ValidationError
        message: quantity must be positive, got {{ quantity }}
```

`error_type` defaults to `WorkflowError`. Tests can assert on both the type and the message.

### Handle a failure: `on_error`

Any task can carry `on_error`. Inside `do`, `_` is the error, `{error_type, error_message,
error_detail}`:

```yaml
- task_name: fetch-recommendations
  activity:
    type: http.request
    input:
      method: GET
      url: '{{ base_url }}/recommendations/{{ user_id }}'
      output_json: true
      raise_for_status: true
  output:
    data: '{{ _["json"] }}'
    as: recommendations
  on_error:
    catch: true                # consume the error and carry on
    do:
      set:
        - recommendations: []
        - _log#: 'recommendations unavailable: {{ _["error_message"] }}'
```

| `catch` | Effect |
|---------|--------|
| `true` | The error is consumed. The task's result is `do`'s result (or `null`), and the task's own `output` is skipped |
| `false` (default) | `do` runs as a cleanup hook, then the error keeps propagating to the parent |

An error raised inside `do` replaces the original. `on_error` catches every error type; to handle
only the ones you expect, record the error and re-raise the rest with a `raise` task.

### Retries and timeouts

Activities retry on failure. Set a default for the whole document in the header, and override it
per activity — fields are merged one by one:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: flaky-call
  metadata:
    default_activity_retry_policy:
      max_attempts: 3
      initial_interval_sec: 1
      timeout_sec: 60

main:
  task_name: fetch-data
  activity:
    type: http.request
    input:
      method: GET
      url: https://httpbin.org/get
      output_json: true
    options:
      retry_policy:
        max_attempts: 5        # timeout_sec and initial_interval_sec come from the header
```

Only the final failure, after the retries run out, reaches `on_error`. Retry policies apply on the
Temporal runtime; the in-memory runtime ignores them.

### Cache expensive calls

```yaml
- task_name: load-reference-data
  activity:
    type: http.request
    input:
      method: GET
      url: '{{ base_url }}/reference-data'
      output_json: true
    options:
      enable_cache: true
      cache_policy:
        expire_in_seconds: 3600
  output:
    as: ref_data
```

---

## Step 8: leaving early

`raise` also carries control signals. They are not errors, and `on_error` never sees them:

| `type` | Effect |
|--------|--------|
| `terminate` | Stops the whole workflow successfully. The workflow `output` is still evaluated, with `terminate_message` added |
| `exit` | Leaves the nearest `tasks` container; execution continues after it |
| `continue` | Skips the rest of the current loop iteration |
| `break` | Leaves the nearest loop |

```yaml
- task_name: nothing-to-do
  raise:
    if: '{{ len(records) == 0 }}'
    type: terminate
    message: no eligible records
```

Because the workflow `output` is evaluated after `terminate`, every variable it reads must exist at
that point. Give them initial values in `context`.

---

## Step 9: reuse

### Functions

A function is a sub-workflow private to the document: `input`, `output` and `main`. Call it with a
`workflow` task:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: shipping-quote

input:
  weight_kg: 2.5
  destination: FR

output: '{{ quote }}'

functions:
  shipping_cost:
    input:
      weight_kg: 0
      zone: domestic
    output:
      cost: '{{ round(base + weight_kg * per_kg, 2) }}'
    main:
      set:
        - base: '{{ 5 if zone == "domestic" else 15 }}'
        - per_kg: '{{ 1.2 if zone == "domestic" else 3.5 }}'

main:
  tasks:
    - set:
        - zone: '{{ "domestic" if destination == "US" else "international" }}'
    - task_name: quote-shipping
      workflow:
        function: shipping_cost
        input:
          weight_kg: '{{ weight_kg }}'
          zone: '{{ zone }}'
      output:
        data: '{{ _["cost"] }}'
        as: quote
```

Each call starts with a fresh context made only of its `input`, so a function cannot read or
overwrite the caller's variables. Functions can call each other, but not recursively.

### Child workflows

To share logic between documents, publish it as its own wfspec and call it by `ref`:

```yaml
- task_name: calculate-shipping
  workflow:
    ref: calculate-shipping    # same namespace and package, latest version
    mode: sync
    input:
      weight: '{{ order["weight_kg"] }}'
      destination: '{{ order["ship_to"] }}'
  output:
    as: shipping_cost
```

A `ref` can also name a package, a version pattern and a namespace —
`/my-ns/shipping/1.*/calculate-shipping` — or be a mapping `{namespace, name, version}`. Instead of
`ref`, `contents` inlines child documents and `contents_yaml` takes them as YAML text, which lets a
workflow pick or generate its child at runtime.

`mode` decides how the child runs:

| `mode` | The child | The parent |
|--------|-----------|------------|
| `inline` (default) | Runs inside the parent's execution | Waits; `_` is the child's result |
| `sync` | Is a separate workflow with its own history, retries and timeouts | Waits; `_` is the child's result |
| `async` | Is started, and cancelled if the parent finishes first | Carries on; `_` is the child's workflow ID |
| `detached` | Is started and outlives the parent | Carries on; `_` is the child's workflow ID |

Whatever the mode, the child sees only its `input`, never the parent's variables. A failing child
raises in the parent like any other task, so handle it with `on_error`. See
[Child Workflows](../concepts/child-workflows.md) for more.

---

## Debugging

Append `#` to any variable name you write and its value is streamed to your terminal when it is
evaluated:

```yaml
- set:
    - total#: '{{ round(sum(prices), 2) }}'
    - _log#: 'processing {{ order_id }}'     # a task-local just for the log
```

It works in `set`, `output.set` and `output.as` (`as: order#`), and combines with the other
markers: `greeting@#`. `moco run` on a local file shows these traces automatically; for a deployed
workflow add `--debug`.

---

## A complete example

Order processing with validation, a fetch, parallel payment and notification, and error handling:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: process-order
  metadata:
    default_activity_retry_policy:
      timeout_sec: 30
      max_attempts: 3

context:
  payment_status: pending

input:
  order_id:
  customer_email:

output:
  order_id: '{{ order_id }}'
  payment_status: '{{ payment_status }}'

main:
  tasks:
    # Validate
    - task_name: validate-input
      raise:
        if: '{{ not order_id }}'
        type: error
        error_type: ValidationError
        message: order_id is required

    # Fetch the order
    - task_name: fetch-order
      activity:
        type: http.request
        input:
          method: GET
          url: https://api.example.com/orders/{{ order_id }}
          output_json: true
          raise_for_status: true
      output:
        data: '{{ _["json"] }}'
        as: order

    # Charge and notify in parallel
    - task_name: charge-and-notify
      props:
        execute_mode: parallel
      tasks:
        - task_name: charge-payment
          activity:
            type: http.request
            input:
              method: POST
              url: https://payments.example.com/charge
              json_data:
                amount: '{{ order["total"] }}'
                customer_id: '{{ order["customer_id"] }}'
              output_json: true
              raise_for_status: true
          output:
            set:
              - payment_status: '{{ "paid" if _["json"].get("success") else "failed" }}'
          on_error:
            catch: true
            do:
              set:
                - payment_status: failed
                - _reason#: '{{ _["error_message"] }}'

        - task_name: send-confirmation
          activity:
            type: email.send
            input:
              from_address: orders@example.com
              to_addresses: ['{{ customer_email }}']
              subject: Order {{ order_id }} received
              body_text: We have received your order {{ order_id }}.
            options:
              retry_policy:
                timeout_sec: 10
```

---

## Next steps

- [Testing Workflows](./testing.md) — writing `*.test.yaml` suites for what you just built
- [Activities](../concepts/activities.md) — retries, caching, secrets, and `async_mode`
- [Tasks Reference](../reference/statements.md) — every task kind in full
- [Workflowspec Reference](../reference/workflowspec-reference.md) — expressions, conditions, variable markers, and more
- [Using the Moco CLI](./use-moco-cli.md) — publish and share the workflow
