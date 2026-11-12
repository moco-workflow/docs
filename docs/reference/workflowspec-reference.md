---
sidebar_label: Workflowspec Reference
sidebar_position: 1
---

# Workflowspec Reference

A **workflowspec** (wfspec) is a YAML document that describes one workflow: its inputs, its
result, and the tasks it runs. This page is the complete reference for the wfspec language. The
individual task kinds are documented one by one in [Tasks](./statements.md), and the activities a
task can call are in the [Activity Catalog](./activity-catalog.md).

## Table of Contents

1. [A first wfspec](#a-first-wfspec)
2. [Document structure](#document-structure)
3. [Tasks](#tasks)
4. [Values and expressions](#values-and-expressions)
5. [Conditions](#conditions)
6. [Variable names (write targets)](#variable-names-write-targets)
7. [Shared task keys](#shared-task-keys)
8. [How a task runs](#how-a-task-runs)
9. [Scopes and name resolution](#scopes-and-name-resolution)
10. [Errors and control signals](#errors-and-control-signals)
11. [Retry policy](#retry-policy)
12. [Reserved names](#reserved-names)
13. [Validating a wfspec](#validating-a-wfspec)
14. [Complete example](#complete-example)
15. [Quick reference](#quick-reference)

---

## A first wfspec

```yaml
header:
  schema_version: 2.0.0
  workflow_name: hello-world

input:
  name: world                         # declared input with a default

output:
  greeting: '{{ greeting }}'          # the workflow's result

main:
  tasks:
    - task_name: wait-a-moment
      activity:
        type: builtin.delay
        input:
          duration: 1s

    - task_name: build-greeting
      set:
        - greeting: 'Hello, {{ name }}! It is {{ now() }}'
```

Every wfspec has a `header` and a `main`. `main` is one **task**; here it is a `tasks` container
that runs two child tasks in order. Values inside `{{ }}` are Python expressions.

### File conventions

- One document per file. The usual suffix is `.yaml` (or `.wfspec.yaml`).
- Files are loaded with a safe YAML loader, which reads the bare words `on`, `off`, `yes`, `no`,
  `y` and `n` as booleans. Quote them when you need them as keys or strings in `input`,
  `context` or activity data: `'yes': 1`.
- Document intent with YAML comments. Tasks have no `description` field.

---

## Document structure

### Top-level keys

| Key | Required | Type | Description |
|---|---|---|---|
| `header` | yes | mapping | Identity and metadata of the workflow |
| `context` | no | mapping | Initial workflow variables. Values may be expressions |
| `input` | no | mapping | Declared inputs and their defaults. Values are **not** evaluated |
| `output` | no | any | The workflow's result, evaluated after `main` completes |
| `functions` | no | mapping | Private sub-workflows of this document |
| `main` | yes | task | The task the workflow runs |

No other top-level keys are allowed.

### `header`

```yaml
header:
  schema_version: 2.0.0
  workflow_name: order-intake
  tags: [orders, intake]
  metadata:
    owner: team-orders                # free-form
    default_activity_retry_policy:    # read by the engine
      max_attempts: 3
      timeout_sec: 60
    schedules:                        # schedules users can create by name
      nightly:
        cron: ["0 2 * * *"]
        timezone: America/New_York
```

| Key | Required | Description |
|---|---|---|
| `schema_version` | yes | Version of the wfspec language, `2.x.y`. Use `2.0.0` |
| `workflow_name` | yes | Name of the workflow. Lowercase letters, digits, `.`, `_` and `-`, starting with a letter or digit |
| `tags` | no | List of strings, used for search and grouping |
| `metadata` | no | Free-form mapping. The engine reads one key: `default_activity_retry_policy`, the [retry policy](#retry-policy) every activity in the document starts from. `schedules` declares the schedules the workflow is meant to run on, see [Declaring schedules](../guides/scheduling-workflows.md#declaring-schedules-in-the-workflow) |

The header has no version. A workflow's version is the version of the package it is published in
(`moco.json`), so publishing a new release never requires editing the spec. See
[Release and Sharing](../concepts/release-and-sharing.md).

### `context`

Initial variables that always exist. Entries are evaluated in order, so a later entry can use an
earlier one. A name modifier on a key applies to its value (here `#literal` keeps a template
unevaluated).

```yaml
header:
  schema_version: 2.0.0
  workflow_name: context-example

context:
  started_at: '{{ now() }}'
  currency: USD
  greeting_template#literal: 'Dear {{ customer }},'
  audit_trail: []

main:
  set:
    - _log#: 'started at {{ started_at }} in {{ currency }}'
```

### `input`

The parameters a caller may pass, with their defaults. Values are taken as written, not
evaluated. A key with no value has the default `null`; nothing enforces that a caller provides it,
so validate required inputs with a [`raise`](./statements.md#raise) task.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: input-example

input:
  order_id:                           # null unless the caller passes it
  quantity: 1
  express: false

main:
  tasks:
    - task_name: require-order-id
      raise:
        if: '{{ not order_id }}'
        type: error
        error_type: ValidationError
        message: order_id is required
    - set:
        - shipping: '{{ "express" if express else "standard" }}'
```

### How the context is built

When a run starts, the workflow context is built in this order:

1. `context`, evaluated entry by entry.
2. `input`: the declared defaults, then the caller's values on top. Caller keys that are not
   declared are merged too. Caller keys that are [reserved names](#reserved-names) are dropped.
3. After a [checkpoint](./statements.md#checkpoint) restart, the saved context replaces the
   result of steps 1 and 2.

A caller can therefore override a `context` entry by passing the same key as input.

### `output`

The workflow's result, evaluated against the workflow context once `main` completes. It is either
a single expression or any structure containing expressions.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: output-example

output:
  order_id: '{{ order_id }}'
  total: '{{ total }}'
  lines: '{{ len(items) }}'

input:
  order_id: ORD-1
  items: [{price: 2.5}, {price: 4.0}]

main:
  set:
    - total: '{{ sum(i["price"] for i in items) }}'
```

- Without `output`, the workflow returns `{}`.
- `output: '{{ total }}'` returns a single value of any type.
- After [`raise: terminate`](#control-signals) the workflow still completes successfully and
  `output` is evaluated as usual. The engine adds a `terminate_message` key to a mapping result;
  any other result is wrapped as `{result: <value>, terminate_message: ...}`.

### `functions`

Functions are sub-workflows private to the document. Each has an optional `input` (parameters and
defaults), an optional `output` (its result) and a `main` task. Call one with a
[`workflow`](./statements.md#workflow) task and `function:`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: functions-example

input:
  a: 3
  b: 4

output:
  hypotenuse: '{{ c }}'

functions:
  square:
    input:
      x: 0
    output: '{{ y }}'
    main:
      set:
        - y: '{{ x * x }}'

  hypotenuse:
    input:
      a: 0
      b: 0
    output: '{{ round((a2 + b2) ** 0.5, 3) }}'
    main:
      tasks:
        - workflow:
            function: square          # a function may call its siblings
            input: {x: '{{ a }}'}
          output:
            as: a2
        - workflow:
            function: square
            input: {x: '{{ b }}'}
          output:
            as: b2

main:
  task_name: compute
  workflow:
    function: hypotenuse
    input:
      a: '{{ a }}'
      b: '{{ b }}'
  output:
    as: c                             # 5.0
```

- Function names use letters, digits, `_` and `-`, starting with a letter or `_`.
- A call runs with a fresh context built only from its `input`. The function cannot see or change
  the caller's variables.
- A function can call sibling functions, but not itself, directly or indirectly. Recursion fails
  at runtime.
- Functions are callable only from the document that defines them.

### `main`

Exactly one task. Most workflows use a `tasks` container here; a workflow that does one thing can
use that task directly.

---

## Tasks

Everything under `main` is a **task**. A task is a mapping with:

- **exactly one kind key**, which says what the task does;
- any of the [shared keys](#shared-task-keys) `task_name`, `skip_if`, `props`, `output`,
  `on_error`;
- nothing else. In particular, a task has no `input` key (kinds that take input declare it
  themselves, such as `activity.input`) and no `description`.

```yaml
# Look the user up                       <- intent goes in a comment
task_name: fetch-user                    # shared key
skip_if: '{{ not user_id }}'             # shared key
activity:                                # the kind
  type: http.request
  input:
    method: GET
    url: 'https://api.example.com/users/{{ user_id }}'
    output_json: true
output:                                  # shared key
  data: '{{ _["json"] }}'
  as: user
```

| Category | Kind | Does |
|---|---|---|
| Primitive | [`activity`](./statements.md#activity) | Calls an activity (HTTP, SQL, shell, LLM, ...) |
| Primitive | [`workflow`](./statements.md#workflow) | Runs a child workflow or a function |
| Primitive | [`set`](./statements.md#set) | Assigns variables |
| Primitive | [`raise`](./statements.md#raise) | Fails, or stops early with a control signal |
| Primitive | [`emit_event`](./statements.md#emit_event) | Publishes an event |
| Primitive | [`wait_for`](./statements.md#wait_for) | Waits for an event, or sleeps |
| Primitive | [`request`](./statements.md#request) | Asks another workflow and waits for its reply |
| Primitive | [`checkpoint`](./statements.md#checkpoint) | Restarts the run with its state saved (continue-as-new) |
| Primitive | [`state_machine`](./statements.md#state_machine) | Runs an event-driven state machine |
| Primitive | [`rules_engine`](./statements.md#rules_engine) | Evaluates rules over a set of facts |
| Container | [`tasks`](./statements.md#tasks) | Runs child tasks, in sequence or in parallel |
| Control flow | [`loop`](./statements.md#loop) | Runs a task once per item |
| Control flow | [`switch`](./statements.md#switch) | Picks a task by comparing one value |
| Control flow | [`branches`](./statements.md#branches) | Picks a task by `if` / `elif` / `else` conditions |

Each kind produces a **raw output**, bound to `_` while the task's `output` is processed. The
[Tasks](./statements.md) page lists what `_` is for each kind.

---

## Values and expressions

### How a value is evaluated

Almost every value in a wfspec is evaluated before it is used: `context` entries, activity
`input`, `set` values, `output`, conditions, and so on. Evaluation is recursive:

| Value | Result |
|---|---|
| Mapping | A mapping with each value evaluated. Keys are not evaluated |
| List | Each element evaluated |
| String without `{{` | The string itself |
| String that is exactly one `{{ e }}` (surrounding spaces allowed) | The value of Python expression `e`, **keeping its type** (number, list, dict, `None`, ...) |
| Any other string containing `{{` | Interpolation: each `{{ e }}` is replaced by `str()` of its value, and the result is a string |
| Number, boolean, `null` | Itself |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: evaluation-example

input:
  name: Ada
  prices: [15.99, 8.5, 25.0]

output: '{{ report }}'

main:
  set:
    - report:
        count: '{{ len(prices) }}'                  # 3 (an int)
        cheapest: '{{ min(prices) }}'               # 8.5 (a float)
        summary: '{{ name }} has {{ len(prices) }} items'   # a string
        ranked: '{{ sorted(prices, reverse=True) }}'        # a list
        status: pending                              # no {{ }}: a plain string
```

`input` defaults are the one place where values are not evaluated.

### Expression syntax

An expression is a single Python expression, not a statement: no assignments, `import`, `def` or
`for` loops. Comprehensions, conditional expressions, f-strings and lambdas all work.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: expression-syntax-example

input:
  people:
    - {name: Ada, dept: eng, salary: 120}
    - {name: Bo, dept: ops, salary: 90}

main:
  set:
    - eng_names: '{{ [p["name"] for p in people if p["dept"] == "eng"] }}'
    - label: '{{ "big" if len(people) > 10 else "small" }}'
    - headline: '{{ f"{len(people)} people, first is {people[0]}" }}'
    # A long expression may span lines; newlines inside {{ }} are treated as spaces.
    - stats: |
        {{
          {
            "headcount": len(people),
            "avg_salary": round(sum(p["salary"] for p in people) / len(people), 1)
          }
        }}
```

Quoting tips:

- Wrap expressions in single quotes so that double quotes can be used inside them.
- A `#` inside a `>` or `>-` folded scalar is part of the expression text, so Python reads it as
  a comment that runs to the end of the folded line, which is the whole expression. Do not put
  comments inside multi-line expressions.

### What expressions can use

| Kind | Available |
|---|---|
| Builtins | Python builtins, except unsafe ones such as `eval`, `exec`, `compile`, `open`, `input`, `globals`, `vars`, `dir`, `type`, `getattr`, `setattr`, `delattr`, `hasattr` |
| Libraries | `np` (numpy), `pd` (pandas), `pa` (pyarrow), `glom`, `json`, `yaml`, `re`, `base64`, `bs4` (BeautifulSoup), `dt` (`datetime` module), `rd` (`dateutil.relativedelta`) |
| Helpers | `now()` (current time, deterministic on replay), `uuid4()`, `copy`, `deepcopy`, `remap`, `StringIO`, `encrypt` |
| Variables | Every visible variable, by bare name. See [Scopes and name resolution](#scopes-and-name-resolution) |

Library access is restricted to safe functions: submodules, file access and code-loading functions
are blocked.

### Special names

| Name | Value |
|---|---|
| `_` | The current task's raw output, inside its `output` (and the error, inside `on_error.do`) |
| `__context__` | A read-only mapping of every visible variable, merged innermost-first. `"x" in __context__` asks whether `x` is defined here |
| `__sys_info__` | Information about the run: `workflow_id`, `trace_id` (shared by a workflow and all its children), `tier`, `debug_mode`, `is_continue_as_new`, and `state_machine` inside a state machine |
| `__user_info__` | The user who started the run: `user_id`, `user_org`, `requester_user_id`, `auth_mode` |
| `event` | The current event, inside `wait_for.event.match_expression` and state machine callbacks and conditions |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: special-names-example

input:
  region:

main:
  set:
    - workflow_id: '{{ __sys_info__.get("workflow_id") }}'
    - user_id: '{{ __user_info__.get("user_id") }}'
    - region_given: '{{ "region" in __context__ and region is not None }}'
```

### Evaluation modifiers

By default a value is evaluated as a Python expression. A modifier on the variable name changes
how its value is evaluated. Modifiers are written after the name and are stripped before the
value is stored (`report#jinja` stores `report`).

| Modifier | Evaluation |
|---|---|
| `#python` | Python expression in `{{ }}` (the default) |
| `#literal` | None. The value is kept exactly as written, braces included |
| `#jinja` | Rendered as a sandboxed Jinja2 template, with every visible variable available. Use it for `{% if %}` / `{% for %}` and filters. Turned off when the deployment sets `MOCO_ENABLE_JINJA=false` |
| `#python_glom` | The value is a glom spec, applied to `__context__`: `glom(__context__, <value>)`. A path must be a quoted Python string. Off unless the deployment sets `MOCO_ENABLE_GLOM=true` |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: modifiers-example

input:
  people:
    - {name: Ada, dept: eng}
    - {name: Bo, dept: ops}

main:
  set:
    # Kept as text, for example to render later or pass to another system.
    - template#literal: 'Hello {{ name }}'

    # Jinja2 has statements and filters, which one Python expression does not.
    - roster#jinja: |
        {% for p in people | sort(attribute='name') %}
        - {{ p.name | upper }} ({{ p.dept }})
        {% endfor %}

    # A glom path. Note the inner quotes: the value is Python, not a bare path.
    - first_dept#python_glom: '"people.0.dept"'
```

Modifiers chain left to right, each applied to the previous result; later passes act only on
strings. `#python#python` evaluates twice, which turns a string into a second expression:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: chained-modifiers-example

context:
  user_email: ada@example.com

main:
  set:
    - pointer#literal: '{{ user_email }}'    # stored as the text '{{ user_email }}'
    # pass 1: '{{ pointer }}'    -> '{{ user_email }}'
    # pass 2: '{{ user_email }}' -> 'ada@example.com'
    - value#python#python: '{{ pointer }}'
```

Modifiers can be used wherever a variable is written: `context` keys, `set` and `output.set`
keys, `output.as`, and the keys of the `input` maps of `activity`, `workflow` and `rules_engine`.

---

## Conditions

`skip_if`, `raise.if`, `branches` items, `wait_for.event.match_expression`, state machine
`trigger.condition` and rule `if.expression` all take a **condition**:

```text
condition := '{{ <expression> }}'
           | and: [condition, ...]      # every sub-condition holds
           | or:  [condition, ...]      # any sub-condition holds
           | not: condition
```

- An expression condition must evaluate to a `bool`. Anything else, including `None`, `0` or an
  empty list, fails with `ConditionTypeError`. Write `{{ len(items) > 0 }}`, not `{{ items }}`.
- `and` and `or` take a non-empty list and short-circuit.
- The tree nests freely.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: conditions-example

input:
  age: 30
  country: US
  is_member: true
  is_banned: false

main:
  tasks:
    - task_name: domestic-adult-member
      skip_if:
        not:
          and:
            - '{{ age >= 18 }}'
            - '{{ country == "US" }}'
            - '{{ is_member }}'
      set:
        - tier: domestic-premium

    - task_name: eligible
      skip_if:
        or:
          - '{{ is_banned }}'
          - '{{ age < 13 }}'
      set:
        - eligible: true
```

---

## Variable names (write targets)

A **write target** is a place where a variable is written: the keys of `context`, `set` and
`output.set`, the value of `output.as`, and the keys of the `input` maps of `activity`,
`workflow` and `rules_engine`. A target is a name with optional markers:

```text
target   :=  [_]name[@][#modifier...][#]
          |  '{{ name[<key>]... }}'          # subscript assignment, set and output.set only

name     :=  a letter, then letters, digits or _
modifier :=  python | literal | jinja | python_glom
```

| Part | Meaning |
|---|---|
| `name` | Write to the workflow context |
| `_name` | Write to the **task-local** scope: visible to the rest of this task, then discarded |
| `name@` | Write to the **container scope**: the nearest enclosing `tasks` container or loop iteration |
| `#modifier` | Evaluate the value with this [modifier](#evaluation-modifiers). Repeatable |
| trailing `#` | Log the stored value as a debug event, shown by the `moco` CLI |

Markers combine in that order: `greeting_html@#jinja#` is a container-scoped variable rendered
with Jinja2 and logged.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: write-targets-example

input:
  prices: [10, 20, 30]
  tax_rate: 0.08

output:
  total: '{{ total }}'

main:
  tasks:
    - task_name: subtotal
      set:
        - _sum: '{{ sum(prices) }}'                # task-local: only this task
        - subtotal@: '{{ _sum }}'                  # container: later siblings
    - task_name: total
      set:
        - _tax: '{{ round(subtotal * tax_rate, 2) }}'
        - total#: '{{ subtotal + _tax }}'          # context, and logged
```

Rules:

- A name cannot both start with `_` and end with `@`.
- A name cannot be `_` or a [reserved name](#reserved-names).
- An unknown modifier (`#yaml`) is rejected when the wfspec is validated.
- The scope markers `_` and `@` mean something only in `set`, `output.set` and `output.as`. In
  `context` keys and `input` maps, only the modifiers and the trailing `#` apply.

### Debug logging with a trailing `#`

A trailing `#` emits a `data_log` debug event with the value that was stored. The `moco` CLI
prints these events while the workflow runs, which makes it the main tool for inspecting a
workflow. `_log#: '...'` is a common idiom: a throwaway task-local whose only purpose is the log
line.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: debug-log-example

input:
  items: [a, b]

main:
  set:
    - _log#: 'processing {{ len(items) }} items'
    - first#: '{{ items[0] }}'
```

### Subscript assignment

In `set` and `output.set`, a key written as an expression with literal subscripts assigns into an
existing dict or list, instead of creating a variable. The root name must already be visible.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: subscript-assignment-example

context:
  profile:
    name: ''
    address: {city: ''}

main:
  set:
    - "{{ profile['name'] }}": Ada
    - "{{ profile['address']['city'] }}": London
```

---

## Shared task keys

These keys can appear on a task of any kind.

| Key | Type | Description |
|---|---|---|
| `task_name` | string | Identifies the task in logs, traces, debug events and tests. Unique within the document |
| `skip_if` | [condition](#conditions) | When true, the task does not run |
| `props` | mapping | Options; `execute_mode` and `join_type` configure a `tasks` container |
| `output` | `{set, data, as}` | Processes the task's raw output into its result |
| `on_error` | `{catch, do}` | Handles an error raised by the task |

### `task_name`

Optional, but name every task you want to find in a trace, mock in a test, or target with a unit
test (a test's `step_name` refers to a `task_name`). Names must be unique across the whole
document, including nested tasks and tasks inside `functions`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: task-name-example

main:
  task_name: build-greeting
  set:
    - greeting: hello
```

### `skip_if`

When the condition is true, the task is skipped: it does not run, its result is `null`, and its
`output` is not processed, so nothing is written. A later task that reads a variable the skipped
task would have written must check for it, or the variable must be given a default in
`context`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: skip-if-example

context:
  greeting: Hello, stranger!          # default for the skipped path

input:
  first_name: jon
  last_name: doe

output: '{{ greeting }}'

main:
  skip_if:
    or:
      - '{{ not first_name }}'
      - '{{ not last_name }}'
  set:
    - greeting: 'Hello, {{ first_name }} {{ last_name }}!'
```

### `props`

An open mapping. The engine reads two keys, and only on a `tasks` container:

| Key | Values | Default | Description |
|---|---|---|---|
| `execute_mode` | `sequential`, `parallel` | `sequential` | How the container runs its children |
| `join_type` | `all`, `any` | `all` | In parallel mode: wait for every child, or take the first to succeed |

Other keys are kept for tools and UIs. A loop sets its iteration mode with `loop.execute_mode`,
not with `props`. See [`tasks`](./statements.md#tasks).

```yaml
header:
  schema_version: 2.0.0
  workflow_name: props-example

main:
  task_name: two-at-once
  props:
    execute_mode: parallel
    join_type: all
    ui_group: demo                    # ignored by the engine
  tasks:
    - activity:
        type: builtin.delay
        input: {duration: 1s}
    - activity:
        type: builtin.delay
        input: {duration: 2s}
```

### `output`

Turns the task's raw output, `_`, into its **result**, and stores what you need. It has three
optional parts, processed in this order:

| Part | Description |
|---|---|
| `set` | An ordered list of assignments, exactly like a [`set`](./statements.md#set) task. `_` is the raw output |
| `data` | The task's result. Defaults to `_`. Can use task-locals written by `output.set` |
| `as` | A [write target](#variable-names-write-targets) that stores the result |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: task-output-example

output:
  order: '{{ order }}'
  last_order_id: '{{ last_order_id }}'

main:
  task_name: create-order
  activity:
    type: http.request
    input:
      method: POST
      url: https://httpbin.org/post
      json_data: {order_id: ORD-1, items: [{sku: A, qty: 2}]}
      output_json: true
  output:
    set:
      - _body: '{{ _["json"]["json"] }}'        # task-local
      - last_order_id: '{{ _body["order_id"] }}'  # context write
    data:
      id: '{{ _body["order_id"] }}'
      lines: '{{ len(_body["items"]) }}'
    as: order
```

- `output` never writes to the context by itself. A key of `_` becomes a variable only when
  `output.set` or `output.as` writes it. A child workflow that returns `{currency: EUR}` does not
  change your `currency` variable.
- `as` honours the scope markers: `as: page@` stores in the enclosing container's scope. On a
  `tasks` container itself, `@` in its own `output` refers to that container's scope, which ends
  with it, so store a container's result in the context instead.
- The result (from `data`, or `_`) is what the parent sees: an item of a `tasks` container's
  result list, or one iteration's result in a `loop`.
- On a container, `output` runs once, after all of its children.

### `on_error`

Handles an error raised by the task's kind or by its `output`. See
[Errors and control signals](#errors-and-control-signals).

| Key | Default | Description |
|---|---|---|
| `catch` | `false` | `true`: the error is consumed and the task succeeds. `false`: the error propagates after `do` runs |
| `do` | none | A task to run when the error happens. Inside it, `_` is the error |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: on-error-example

context:
  error: null

input:
  first_name:

output:
  error: '{{ error }}'

main:
  task_name: validate
  raise:
    if: '{{ not first_name }}'
    type: error
    error_type: ValidationError
    message: first_name is missing
  on_error:
    catch: true
    do:
      set:
        - error#: '{{ _["error_type"] }}: {{ _["error_message"] }}'
```

---

## How a task runs

For every task, the engine runs these steps in order:

1. **Guard.** Evaluate `skip_if`. If it is true, the task's result is `null` and the task ends.
   A `raise` task also evaluates its `if` here; if it is false, the result is `null`.
2. **Run.** Execute the kind and bind `_` to its raw output.
3. **Errors.** If step 2 or steps 4 to 6 fail, hand the error to `on_error`.
4. **`output.set`.** Process the assignments in order.
5. **`output.data`.** Evaluate it, or use `_`. This is the task's **result**.
6. **`output.as`.** Store the result.
7. **Clean up.** Discard the task's local scope and return the result to the parent.

Consequences:

- A skipped task writes nothing, and its `output` does not run.
- Task-locals (`_name`) written by a `set` task are still visible in that task's `output`.
- A control signal (`raise: exit`, `break`, `continue`, `terminate`) skips steps 4 to 6 of every
  task it passes through.

---

## Scopes and name resolution

### The three scopes

| Written as | Scope | Visible to | Lifetime |
|---|---|---|---|
| `name` | **Workflow context** | Every later task and the workflow's `output` | The whole run; saved on checkpoint |
| `name@` | **Container scope**: the nearest enclosing `tasks` container or loop iteration | Later siblings and their descendants | Until that container or iteration ends |
| `_name` | **Task-local** | The rest of the same task: later `set` entries, `output.set`, `output.data`, `output.as` | Until the task ends |

A `name@` written outside any container lands in the workflow's root scope: readable by every task,
but not part of the workflow context or the checkpointed state.

### Reading a name

A bare name is looked up innermost first:

1. the [special names](#special-names) (`_`, `__context__`, `event`, ...);
2. the current task's local scope;
3. the container scopes, from the innermost outwards;
4. the workflow context.

The first match wins, so a container-scoped `discount@` hides a `discount` in the context for as
long as its container runs. An unknown name fails with `NameError`. `__context__` holds the same
merge as a mapping; test membership with `"x" in __context__`.

Writing `name` always writes the context, even when a scoped `name@` hides it: readers inside the
scope keep seeing the scoped value.

### Container scopes in loops and parallel tasks

Every loop iteration opens a fresh container scope holding the loop variable (`foreach`, and
`index` if named). Values written with `@` inside an iteration stay private to it, so iterations
never overwrite each other's temporaries, even in parallel.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: scopes-example

input:
  orders:
    - {id: order-1, amount: 150.0}
    - {id: order-2, amount: 49.99}

output:
  processed: '{{ processed }}'
  leaked: '{{ leaked }}'

main:
  tasks:
    - task_name: price-orders
      loop:
        in: '{{ orders }}'
        foreach: order
        execute_mode: parallel
        do:
          tasks:
            - set:
                - discount@: '{{ 0.10 if order["amount"] >= 100 else 0.0 }}'
            - set:
                - final@: '{{ round(order["amount"] * (1 - discount), 2) }}'
          output:
            data: {id: '{{ order["id"] }}', final: '{{ final }}'}
      output:
        as: processed

    # order, discount and final are gone; only processed is left.
    - set:
        - leaked: '{{ [n for n in ("order", "discount", "final") if n in __context__] }}'
```

In a parallel `tasks` container or parallel loop, each child or iteration works on its own copy of
the enclosing container scopes, so siblings cannot see each other's `@` writes. Writes to the
workflow context are applied as the children finish.

### Boundaries

| Boundary | What is visible inside |
|---|---|
| `workflow` child and `function` call | Only the child's own `input`, as a fresh context. Nothing from the caller |
| State machine `on_enter`, `on_exit`, `action`, `condition` | The workflow context and `event`. Container scopes around the state machine are not visible |
| Rules engine rule expressions | The facts, as bare names |
| Rules engine `actions` | The workflow context, like a state machine callback |

---

## Errors and control signals

### Errors

An error fails the task that raised it, and propagates to the parent unless something handles it.
Errors come from activities, child workflows, expressions (`NameError`, a bad subscript, ...),
`raise` with `type: error`, and the engine itself. A failed activity is retried first, according
to its [retry policy](#retry-policy); only the final failure counts.

`on_error` on a task handles an error raised by its kind or by its `output`:

| `on_error` | What happens |
|---|---|
| absent | The error propagates to the parent task |
| `do` present | `do` runs in the task's place, in the same scopes. Inside `do`, `_` is the error |
| `catch: true` | The error is consumed. The task succeeds with `do`'s result (or `null` without `do`). The task's own `output` is **not** applied, because it assumes success; use `do`'s `output` to store something |
| `catch: false` (default) | After `do` completes, the original error keeps propagating. Use it for cleanup and compensation |

The error, bound to `_` inside `do`:

| Key | Description |
|---|---|
| `error_type` | The error's type name, such as `ActivityError` or a `raise` task's `error_type` |
| `error_message` | The message |
| `error_detail` | Extra detail, when available |

More rules:

- An error raised inside `do` replaces the original error and propagates.
- An error while evaluating `skip_if` is not handled by the task's own `on_error`.
- A container's `on_error` handles any error a child let through.
- `on_error` catches every error type. To handle only some, catch, store the error and re-raise
  the others with `raise`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: error-handling-example

context:
  reservation: null
  checkout_error: null

input:
  fail_payment: true

output:
  reservation: '{{ reservation }}'
  checkout_error: '{{ checkout_error }}'

main:
  tasks:
    - task_name: reserve-stock
      set:
        - reservation: {sku: SKU-A, qty: 1}

    - task_name: checkout
      tasks:
        - task_name: charge-card
          raise:
            if: '{{ fail_payment }}'
            type: error
            error_type: PaymentDeclined
            message: card declined
          on_error:
            # catch: false (the default): compensate, then let the error propagate.
            do:
              task_name: release-stock
              set:
                - reservation: null
        - task_name: confirm
          set:
            - _log#: payment charged          # not reached when charge-card fails
      # The container catches what its children let through.
      on_error:
        catch: true
        do:
          set:
            - checkout_error#: '{{ _ }}'

    - task_name: rethrow-unexpected
      raise:
        if: '{{ checkout_error is not None and checkout_error["error_type"] != "PaymentDeclined" }}'
        type: error
        error_type: CheckoutError
        message: '{{ checkout_error["error_message"] }}'
```

### Control signals

`raise` with a type other than `error` sends a **control signal**. A signal is not an error:
`on_error` never sees it, and the tasks it unwinds through skip their `output`.

| `raise.type` | Effect |
|---|---|
| `error` (default) | Fails with `error_type` (default `WorkflowError`) and `message` |
| `terminate` | Stops the whole workflow. The run completes **successfully**; `output` is evaluated and gets `terminate_message` |
| `exit` | Leaves the nearest enclosing `tasks` container, which completes; execution continues after it |
| `break` | Leaves the nearest enclosing `loop`, which completes with the results collected so far |
| `continue` | Ends the current loop iteration (from any depth inside it) with result `null`; the next one starts |

`exit` must be inside a `tasks` container, and `break` and `continue` inside a `loop`, without
crossing a `workflow` / `function` boundary or a state machine callback. The validator checks
this.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: control-signals-example

context:
  kept: []

input:
  numbers: [1, -2, 3, 0, 5]

output:
  kept: '{{ kept }}'                  # [1, 3]

main:
  tasks:
    - task_name: nothing-to-do
      raise:
        if: '{{ len(numbers) == 0 }}'
        type: terminate
        message: no numbers given

    - task_name: filter
      loop:
        in: '{{ numbers }}'
        foreach: n
        do:
          tasks:
            - raise:
                if: '{{ n < 0 }}'
                type: continue        # skip negatives
            - raise:
                if: '{{ n == 0 }}'
                type: break           # stop at the first zero
            - set:
                - kept: '{{ kept + [n] }}'
```

### Error types

The `error_type` an `on_error` handler sees is one of:

| `error_type` | Raised when |
|---|---|
| any name you choose | A `raise` task with `error_type` set |
| `WorkflowError` | A `raise` task without `error_type` |
| `ConditionTypeError` | A condition evaluated to something other than a `bool` |
| `LoopTypeError` | `loop.in` did not evaluate to an iterable |
| `NameError` | An expression read a name that is not defined |
| the activity's own type | An activity failed after its retries, for example `ValueError` for an invalid input |
| the child's error type | A child workflow or function failed; its error propagates with its own type |
| `RequestTimeoutError` | A `request` got no reply within its `timeout_sec` |
| `ReplyError` | An `emit_event` `reply_to` was given something that is not a request event |

`AbortError` is the conventional type for "stop this run as aborted":
`raise: {type: error, error_type: AbortError, message: ...}`.

A `wait_for` timeout is **not** an error: its result is `null`. A `request` timeout is.

---

## Retry policy

A retry policy controls the timeouts and retries of an activity, or of a `sync` child workflow. It
is applied by the Temporal runtime; the in-memory runtime ignores it.

An activity's effective policy is `header.metadata.default_activity_retry_policy` with the
activity's own `options.retry_policy` laid over it, field by field.

| Field | Description |
|---|---|
| `timeout_sec` | Timeout of one attempt |
| `schedule_to_close_timeout_sec` | Overall timeout, across all attempts |
| `heartbeat_timeout_sec` | Fail an attempt that has not heartbeated for this long |
| `heartbeat_interval_sec` | How often the activity heartbeats. Heartbeating is on only when both heartbeat fields are set |
| `max_attempts` | Total attempts, the first one included. `0` means unlimited |
| `initial_interval_sec` | Wait before the first retry |
| `backoff_coefficient` | Multiplier applied to the wait after each retry |
| `maximum_interval_sec` | Upper bound on the wait between retries |
| `non_retryable_error_types` | Error types that fail immediately, without retrying |

```yaml
header:
  schema_version: 2.0.0
  workflow_name: retry-policy-example
  metadata:
    default_activity_retry_policy:
      max_attempts: 3
      initial_interval_sec: 1
      timeout_sec: 60

main:
  task_name: fetch-report
  activity:
    type: http.request
    input:
      method: GET
      url: https://httpbin.org/get
      raise_for_status: true
    options:
      retry_policy:                   # max_attempts and timeout_sec override the default;
        max_attempts: 5               # initial_interval_sec (1) is inherited
        timeout_sec: 10
        backoff_coefficient: 2.0
        non_retryable_error_types: [ValueError]
```

### Computed retry policies

Every field except `non_retryable_error_types` takes either a number or a `{{ }}` expression,
and an expression must evaluate to a number. This holds wherever a policy is written:
`header.metadata.default_activity_retry_policy`, an activity's `options.retry_policy`, and a child
workflow's `options.retry_policy`. `non_retryable_error_types` is always a literal list.

Expressions are evaluated each time the task runs, in that task's scope, so they can read inputs,
context variables, container-scoped variables and loop variables. The header default is merged
into each activity's policy first and then evaluated in that activity's scope, so it should only
use names that exist everywhere, such as inputs and context variables.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: computed-retry-policy-example
  metadata:
    default_activity_retry_policy:
      max_attempts: '{{ 3 if environment == "prod" else 1 }}'   # fail fast outside prod
      timeout_sec: 60

input:
  environment: prod
  max_retries: 4
  files: [{name: a.csv, size_mb: 1}, {name: b.csv, size_mb: 40}]

main:
  tasks:
    - task_name: upload
      activity:
        type: builtin.delay
        input:
          duration: 1s
        options:
          retry_policy:
            max_attempts: '{{ max_retries + 1 }}'    # literals and expressions mix
            backoff_coefficient: 2.0

    - task_name: process-files
      loop:
        in: '{{ files }}'
        foreach: file
        do:
          activity:
            type: builtin.delay
            input:
              duration: 1s
            options:
              retry_policy:
                timeout_sec: '{{ 10 + file["size_mb"] * 3 }}'   # one timeout per item
```

A `retry_policy` passed when the run is started (through the API or the CLI) is not part of the
spec and is never evaluated, so it takes plain numbers only. See
`moco-examples/basics/26-retry-policy.yaml` for a runnable version that also sets a `sync`
child's policy.

---

## Reserved names

These names are bound by the engine. They cannot be written as variables or used as a loop's
`foreach` or `index` name:

- `_`
- `__context__`, `__sys_info__`, `__user_info__`, and every name that starts and ends with `__`
- `event`

Caller input keys that are reserved are dropped silently.

---

## Validating a wfspec

`moco validate` checks a wfspec against the wfspec schema and the activity catalog (activity
types and their input fields) before anything runs:

```bash
moco validate my-workflow.yaml
```

Besides the document's shape, it checks rules a schema cannot express:

- `task_name` values are unique in the document;
- a write target is well formed and does not use a reserved name or an unknown modifier;
- `raise: exit` is inside a `tasks` container, and `break` / `continue` inside a `loop`;
- `error_type` is used only with `type: error`;
- `branches` starts with `if`, and a single `else` comes last;
- a nested loop does not reuse an enclosing loop's `foreach` or `index` name;
- a `workflow` task has exactly one source, and `function` is not combined with a `mode` other
  than `inline`;
- state machine state names exist, automatic transitions have a `to_state`, and
  `checkpoint_policy` is used only when the state machine is `main`;
- rule `id`s are unique, and a `wait_for` without `event` has a `timeout_sec`.

---

## Complete example

An order pipeline that validates its input, looks up prices in parallel, applies a discount by
customer tier, and handles a payment failure.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: order-pipeline
  tags: [orders, example]
  metadata:
    default_activity_retry_policy:
      max_attempts: 3
      timeout_sec: 30

context:
  payment: pending
  payment_error: null

input:
  order_id:
  tier: standard
  skus: [SKU-A, SKU-B]
  fail_payment: false

output:
  order_id: '{{ order_id }}'
  lines: '{{ lines }}'
  total: '{{ total }}'
  payment: '{{ payment }}'
  payment_error: '{{ payment_error }}'

functions:
  # A stand-in price service: a key in, a value out.
  lookup_price:
    input:
      sku:
    output:
      sku: '{{ sku }}'
      price: '{{ {"SKU-A": 10.0, "SKU-B": 25.5}.get(sku, 0.0) }}'
    main:
      activity:
        type: builtin.delay
        input: {duration: 1s}

main:
  tasks:
    - task_name: validate-input
      raise:
        if: '{{ not order_id }}'
        type: error
        error_type: ValidationError
        message: order_id is required

    - task_name: price-lines
      loop:
        in: '{{ skus }}'
        foreach: sku
        execute_mode: parallel
        do:
          task_name: price-one
          workflow:
            function: lookup_price
            input:
              sku: '{{ sku }}'
      output:
        as: lines

    - task_name: discount
      switch:
        value: '{{ tier }}'
        cases:
          - match: gold
            do:
              set:
                - discount@: 0.15
          - match: [silver, partner]
            do:
              set:
                - discount@: 0.05
        default:
          set:
            - discount@: 0.0

    - task_name: total
      set:
        - _subtotal: '{{ sum(l["price"] for l in lines) }}'
        - total#: '{{ round(_subtotal * (1 - discount), 2) }}'

    - task_name: charge
      tasks:
        - task_name: charge-card
          raise:
            if: '{{ fail_payment }}'
            type: error
            error_type: PaymentDeclined
            message: card declined
        - set:
            - payment: charged
      on_error:
        catch: true
        do:
          set:
            - payment: declined
            - payment_error: '{{ _["error_message"] }}'
```

More complete workflows are in the `moco-examples` repository, and each [Tasks](./statements.md)
entry has a short example of its own.

---

## Quick reference

```text
document  := header, context?, input?, output?, functions?, main
header    := schema_version, workflow_name, tags?, metadata?
function  := input?, output?, main

task      := shared keys + exactly one kind
shared    := task_name?, skip_if?, props?, output?, on_error?
output    := set?: [ {target: value}, ... ], data?: value, as?: target
on_error  := catch?: bool, do?: task

kind      := activity | workflow | set | raise | emit_event | wait_for | checkpoint
           | state_machine | rules_engine | tasks | loop | switch | branches | request

tasks     := tasks: [task, ...]                     (props.execute_mode / join_type)
loop      := loop: {in, foreach?, index?, execute_mode?, join_type?, do: task}
switch    := switch: {value, cases: [{match, do: task}, ...], default?: task}
branches  := branches: [{if, do}, {elif, do}..., {else:, do}?]

condition := '{{ expr }}' | {and: [condition...]} | {or: [condition...]} | {not: condition}
target    := [_]name[@][#python|#literal|#jinja|#python_glom...][#]
```

| Name | Meaning |
|---|---|
| `_` | Raw output of the current task, in its `output`; the error, in `on_error.do` |
| `__context__` | Merged view of every visible variable |
| `x` / `x@` / `_x` | Context / container scope / task-local |
| `x#` | Log the stored value |
