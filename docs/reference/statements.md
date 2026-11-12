---
sidebar_label: Tasks
sidebar_position: 2
---

# Tasks Reference

A **task** is the unit a workflow is built from: `main` is one task, and containers and control
flow hold more tasks. Every task has **exactly one kind key**, which says what it does, plus any
of the shared keys `task_name`, `skip_if`, `props`, `output` and `on_error`.

This page documents every task kind. For the shared keys, expressions, scopes and error handling,
see the [Workflowspec Reference](./workflowspec-reference.md). For the activities an `activity`
task can call, see the [Activity Catalog](./activity-catalog.md).

## Kinds at a glance

| Kind | Category | Result `_` |
|---|---|---|
| [`activity`](#activity) | primitive | The activity's result; a token with `async_mode` |
| [`workflow`](#workflow) | primitive | The child's `output`; its `workflow_id` for `async` / `detached` |
| [`set`](#set) | primitive | A mapping of the values it stored (task-locals excluded) |
| [`raise`](#raise) | primitive | `null` when its `if` is false; otherwise it does not complete |
| [`emit_event`](#emit_event) | primitive | `null` |
| [`wait_for`](#wait_for) | primitive | The event, or `null` on timeout |
| [`request`](#request) | primitive | The reply event; `RequestTimeoutError` when none arrives |
| [`checkpoint`](#checkpoint) | primitive | `null` |
| [`state_machine`](#state_machine) | primitive | The name of the terminal state reached |
| [`rules_engine`](#rules_engine) | primitive | The derived facts |
| [`tasks`](#tasks) | container | The list of child results; the winner's result with `join_type: any` |
| [`loop`](#loop) | control flow | The list of iteration results; the winner's result with `join_type: any` |
| [`switch`](#switch) | control flow | The result of the case that ran, or `null` |
| [`branches`](#branches) | control flow | The result of the branch that ran, or `null` |

`_` is the task's **raw output**. It is visible in the task's `output`, where `output.data`
(default `_`) becomes the task's result and `output.as` stores it:

```yaml
- task_name: get-user
  activity:
    type: http.request
    input:
      method: GET
      url: https://httpbin.org/json
      output_json: true
  output:
    data: '{{ _["json"] }}'
    as: user
```

## Shared keys

| Key | Description |
|---|---|
| `task_name` | Identifies the task in logs, traces and tests. Unique within the document |
| `skip_if` | A [condition](./workflowspec-reference.md#conditions). When true, the task does not run and its result is `null` |
| `props` | Options. `execute_mode` and `join_type` configure a [`tasks`](#tasks) container |
| `output` | `set` (ordered writes), `data` (the result, default `_`), `as` (where to store it) |
| `on_error` | `catch` and `do`: handle an error raised by this task |

Details in [Shared task keys](./workflowspec-reference.md#shared-task-keys).

---

## Primitive tasks

### activity

Calls an activity: an HTTP request, a SQL query, a shell command, an LLM call, and so on.

```text
activity:
  type: <activity type>
  input: <mapping>
  options:
    retry_policy: <retry policy>
    execute_locally: <bool>
    enable_cache: <bool>
    cache_policy: {expire_in_seconds, disable}
    async_mode: <bool>
    async_event_topic: <topic>
```

| Field | Description |
|---|---|
| `type` | Activity type, such as `http.request` (required). See the [Activity Catalog](./activity-catalog.md) |
| `input` | The activity's input fields. Evaluated each time the task runs |
| `options.retry_policy` | Timeouts and retries, laid over the header's `default_activity_retry_policy`. Field values may be expressions, evaluated each time the task runs. See [Retry policy](./workflowspec-reference.md#retry-policy) |
| `options.execute_locally` | Run the activity in the workflow's own process. Overrides the activity's default only when set |
| `options.enable_cache` | Cache the activity's result |
| `options.cache_policy` | `expire_in_seconds` (cache lifetime), `disable` |
| `options.async_mode` | Do not wait: return a token now, and publish the result later as an event |
| `options.async_event_topic` | Topic of that event. Default `default` |

**Result `_`:** the activity's result. With `async_mode`, a token string: the result arrives
later as an event on `async_event_topic` whose `event_type` is that token. Collect it with
[`wait_for`](#wait_for).

```yaml
header:
  schema_version: 2.0.0
  workflow_name: activity-task

output:
  echoed: '{{ echoed }}'

main:
  task_name: post-order
  activity:
    type: http.request
    input:
      method: POST
      url: https://httpbin.org/post
      json_data:
        order_id: ORD-1
      output_json: true
      raise_for_status: true
    options:
      retry_policy:
        max_attempts: 3
        timeout_sec: 30
  output:
    data: '{{ _["json"]["json"] }}'
    as: echoed
```

Some activities already default to local execution, so `execute_locally` is rarely needed. Setting
it to `false` on a `selenium.*` or `playwright.*` activity breaks browser sessions; see
[Activities](../concepts/activities.md).

An asynchronous activity, collected later:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: async-activity-task

output:
  status: '{{ status }}'

main:
  tasks:
    - task_name: slow-lookup
      activity:
        type: builtin.delay
        input:
          duration: 1s
        options:
          async_mode: true
          async_event_topic: lookup_events
      output:
        as: lookup_token

    - task_name: await-lookup
      wait_for:
        event:
          topic: lookup_events
          event_type: '{{ lookup_token }}'
        timeout_sec: 30
      output:
        data: '{{ _["metadata"].get("status") if _ else "timed-out" }}'
        as: status
```

---

### workflow

Runs a child workflow, or a function of the same document.

```text
workflow:
  ref: <reference>            # exactly one of ref, function, contents, contents_yaml
  function: <function name>
  contents: [<wfspec>, ...]
  contents_yaml: <string> | [<string>, ...]
  mode: inline | sync | async | detached
  input: <mapping>
  options:
    retry_policy: <retry policy>
    debug_mode: <bool>
    debug_info: <any>
    enable_otel_trace: <bool>
    execute_mode: workflow | standalone-activity | in-memory
    entity_workflow_args: <any>
```

| Field | Description |
|---|---|
| `ref` | A published workflow, by name. A string or a mapping (below) |
| `function` | A function from this document's `functions` |
| `contents` | Child wfspecs written inline as YAML. The first is the entry point |
| `contents_yaml` | The same as YAML text (a string or a list of strings), for example built or chosen at runtime |
| `mode` | How the child runs. Default `inline` |
| `input` | The child's input. The child's context is built from it, as for a top-level run |
| `options.retry_policy` | Timeouts and retries of a `sync` child. Field values may be expressions. See [Retry policy](./workflowspec-reference.md#computed-retry-policies) |
| `options.debug_mode`, `options.debug_info` | Run the child in debug mode, with optional debug data |
| `options.enable_otel_trace` | Emit OpenTelemetry traces for the child |
| `options.execute_mode` | How the child is dispatched: `workflow` (default; each activity dispatched separately), `standalone-activity` (the whole child runs as one activity, efficient for large-data or CPU-bound work), or `in-memory` |
| `options.entity_workflow_args` | Entity-workflow (signal-with-start) configuration |

| `mode` | Behaviour |
|---|---|
| `inline` | Runs inside the parent's execution: same workflow id, no separate history. The parent waits. The cheapest mode |
| `sync` | A separate workflow with its own id, history, retries and timeouts. The parent waits for the result |
| `async` | Started and not waited for. Cancelled if the parent finishes first |
| `detached` | Started and not waited for. Outlives the parent |

Every mode, `inline` included, gives the child a **fresh context made only of its `input`**: it
cannot see or change the caller's variables. Choose between `inline` and `sync` for cost and
failure isolation, not for data.

**Result `_`:** the child's `output`. For `async` and `detached`, the child's `workflow_id`.
A failing child raises its error in the parent, where `on_error` can handle it.

**References.** A string `ref` is a path of `/`-separated segments: the last is the workflow
name, the one before it may be a version pattern (semver, `*` wildcards allowed), and the rest
name the package. A leading `/` makes the first segment a namespace; without it the caller's
namespace is used. A one-segment `ref` names a workflow in the caller's package.

```yaml
- workflow:
    ref: send-receipt                       # same namespace and package, latest version
- workflow:
    ref: /billing/invoices/2.*/send-receipt # namespace / package / version / name
- workflow:
    ref: {namespace: billing, name: invoices/send-receipt, version: '2.*'}
```

`ref` may be an expression, to pick a published workflow at runtime.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: workflow-task

input:
  x: 21

output:
  doubled: '{{ doubled }}'
  started: '{{ started }}'

main:
  tasks:
    - task_name: double-via-child
      workflow:
        contents:
          - header:
              schema_version: 2.0.0
              workflow_name: doubler
            input:
              x: 0
            output: '{{ x * 2 }}'
            main:
              set: []
        mode: sync
        input:
          x: '{{ x }}'
      output:
        as: doubled                         # 42

    - task_name: start-background-job
      workflow:
        contents:
          - header:
              schema_version: 2.0.0
              workflow_name: background-job
            main:
              activity:
                type: builtin.delay
                input: {duration: 1s}
        mode: async
      output:
        data: '{{ _ is not None }}'         # _ is the child's workflow_id
        as: started
```

#### Calling a function

`function:` runs a function of the same document. It always runs `inline`, so `mode` must be
absent or `inline`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: function-call-task

functions:
  add:
    input: {a: 0, b: 0}
    output: '{{ a + b }}'
    main:
      set: []

output: '{{ total }}'

main:
  task_name: call-add
  workflow:
    function: add
    input: {a: 1, b: 2}
  output:
    as: total                               # 3
```

For composition patterns (data resolvers, parent and child talking through events, entity
workflows), see [Child Workflows](../concepts/child-workflows.md).

---

### set

Assigns variables, without calling anything.

```text
set:
  - <target>: <value>
  - ...
```

Each item is a mapping with one key: a [write target](./workflowspec-reference.md#variable-names-write-targets)
(`name`, `_name`, `name@`, with optional modifiers and a trailing `#`). Items run in order, and
each can read the ones before it. A key written as `'{{ name[...] }}'` assigns into an existing
dict or list ([subscript assignment](./workflowspec-reference.md#subscript-assignment)).

**Result `_`:** a mapping of the values stored by the non-task-local items, keyed by name with
the markers removed. Task-locals written by `set` stay visible in the task's own `output`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: set-task

input:
  first_name: jon
  last_name: doe

output:
  greeting: '{{ greeting }}'
  stored: '{{ stored }}'

main:
  set:
    - _name: '{{ first_name }} {{ last_name }}'    # task-local
    - greeting#: 'Hello, {{ _name.title() }}!'     # context, logged
  output:
    as: stored                                     # {greeting: Hello, Jon Doe!}
```

An empty `set: []` does nothing. It is the usual `main` of a function or child whose result is
computed entirely by its `output`.

---

### raise

Fails the task with an error, or stops early with a control signal.

```text
raise:
  if: <condition>
  type: error | terminate | exit | break | continue
  message: <value>
  error_type: <name>
```

| Field | Description |
|---|---|
| `if` | Raise only when this condition is true. Without it, the task always raises |
| `type` | What to raise. Default `error` |
| `message` | The message. Evaluated |
| `error_type` | The error's type, seen by `on_error` as `error_type`. Only with `type: error`. Default `WorkflowError` |

| `type` | Effect |
|---|---|
| `error` | Fails the task. `on_error` handlers can catch it |
| `terminate` | Stops the whole workflow, which completes **successfully**: its `output` is evaluated and gets `terminate_message` |
| `exit` | Leaves the nearest enclosing `tasks` container; execution continues after it |
| `break` | Leaves the nearest enclosing `loop`, which keeps the results collected so far |
| `continue` | Ends the current loop iteration with result `null` and moves to the next |

`terminate`, `exit`, `break` and `continue` are control signals, not errors: `on_error` never sees
them. `exit` must sit inside a `tasks` container and `break` / `continue` inside a `loop`.

**Result `_`:** `null` when `if` is false. Otherwise the task does not complete normally.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: raise-task

input:
  first_name:
  last_name:

output:
  full_name: '{{ full_name }}'

main:
  tasks:
    - task_name: require-first-name
      raise:
        if: '{{ not first_name }}'
        type: error
        error_type: ValidationError
        message: first_name is missing

    - task_name: stop-without-last-name
      raise:
        if: '{{ not last_name }}'
        type: terminate
        message: no last_name, nothing to do

    - task_name: build-name
      set:
        - full_name: '{{ first_name }} {{ last_name }}'
```

See [Errors and control signals](./workflowspec-reference.md#errors-and-control-signals).

---

### emit_event

Publishes an event, to this workflow or to another one.

```text
emit_event:
  topic: <topic>
  event_type: <name>
  data: <any>
  metadata: <any>
  target_workflow_id: <workflow id>
  entity_workflow:
    ref | contents | contents_yaml: ...
    mode: async | detached
    input: <mapping>
  reply_to: <request event>
```

| Field | Description |
|---|---|
| `topic` | The channel. Default `default` |
| `event_type` | The event's name within the topic |
| `data` | The payload |
| `metadata` | Extra information about the event |
| `target_workflow_id` | The workflow that receives the event. Default: this workflow |
| `entity_workflow` | Start the target workflow if it is not running, then deliver (signal-with-start). Takes a source (`ref`, `contents` or `contents_yaml`), a `mode` and an `input`, as in [`workflow`](#workflow) |
| `reply_to` | Answer a [`request`](#request): the request event (`event` in a transition, `_` after a `wait_for`) or its `metadata`. The event goes back to the requester on its reply topic, carrying its correlation id. Cannot be combined with `target_workflow_id`, `topic` or `entity_workflow`; a value that is not a request event raises `ReplyError` |

**Result `_`:** `null`.

A failed delivery raises `PublishError`. To log it and carry on, put `on_error: {catch: true}` on the task.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: emit-event-task

input:
  order_id: ORD-1
  notify_workflow_id:

main:
  task_name: publish-order-created
  emit_event:
    topic: order_events
    event_type: order_created
    target_workflow_id: '{{ notify_workflow_id or __sys_info__.get("workflow_id") }}'
    data:
      order_id: '{{ order_id }}'
    metadata:
      priority: high
```

See [Events](../concepts/events.md) for how events flow between workflows, activities and
clients.

---

### wait_for

Waits for an event, or sleeps.

```text
wait_for:
  event:
    topic: <topic>
    event_type: <name>
    match_expression: <condition>
  timeout_sec: <seconds>
```

| Field | Description |
|---|---|
| `event.topic` | The topic to listen on. Default `default` |
| `event.event_type` | Only events with this type match. May be an expression, evaluated when the wait starts |
| `event.match_expression` | A [condition](./workflowspec-reference.md#conditions) evaluated for each candidate event, with `event` bound to it |
| `timeout_sec` | How long to wait. Required when there is no `event` |

- An event is consumed by the **first** waiter it matches; a second `wait_for` will not see it.
- With a literal `event.topic`, an event that arrives before the `wait_for` is reached is kept for
  it. An expression topic is only listened to from its first `wait_for` on.
- Without `event`, `wait_for` is a durable sleep of `timeout_sec`.

**Result `_`:** the matched event, a mapping with `topic`, `event_type`, `data`, `metadata`
and more. On timeout, `null`. A timeout is not an error; test `_` in the task's `output`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: wait-for-task

input:
  order_id: ORD-1

output: '{{ result }}'

main:
  tasks:
    - task_name: await-order-shipped
      wait_for:
        event:
          topic: order_events
          event_type: shipped
          match_expression: '{{ event["data"].get("order_id") == order_id }}'
        timeout_sec: 5
      output:
        data:
          timed_out: '{{ _ is None }}'
          shipment: '{{ _["data"] if _ else None }}'
        as: result

    - task_name: pause
      wait_for:
        timeout_sec: 1
```

---

### request

Sends an event to another workflow and waits for its reply.

```text
request:
  target_workflow_id: <workflow id>
  topic: <topic>
  event_type: <name>
  data: <any>
  metadata: <any>
  reply_topic: <topic>
  timeout_sec: <seconds>
```

| Field | Description |
|---|---|
| `target_workflow_id` | The workflow to ask. Required |
| `topic` | The topic the request is sent on. Default `default` |
| `event_type` | The request's name within the topic |
| `data` | The payload |
| `metadata` | Extra information. `correlation_id`, `reply_to` and `reply_topic` are added to it |
| `reply_topic` | The topic the reply is awaited on. Default `moco.reply` |
| `timeout_sec` | How long to wait for the reply. Without it the request waits forever (validator warning) |

- The reply is matched by the correlation id the engine adds, so no `match_expression` is needed
  and concurrent requests each get their own reply.
- The receiver answers with [`emit_event`](#emit_event) and `reply_to`.

**Result `_`:** the reply event, a mapping with `topic`, `event_type`, `data`, `metadata` and
more. With no reply within `timeout_sec` the task raises `RequestTimeoutError`; catch it with
`on_error`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: request-task

input:
  pricing_id:
  sku: A-1

output: '{{ quote }}'

main:
  task_name: get-quote
  request:
    target_workflow_id: '{{ pricing_id }}'
    topic: pricing
    event_type: get_quote
    data:
      sku: '{{ sku }}'
    timeout_sec: 30
  output:
    data: '{{ _["data"] }}'
    as: quote
  on_error:
    catch: true
    do:
      set:
        - quote: null
```

See [Request / Reply](../concepts/events.md#request--reply) for the whole exchange.

---

### checkpoint

Restarts the run with its state saved (continue-as-new), when the runtime suggests it. On
Temporal, a long-running workflow's event history grows with every step; a checkpoint starts a
fresh history before it gets too large.

```text
checkpoint:
  serialize_context: <bool>   # default true
  enforce: <bool>             # default false
```

| Field | Description |
|---|---|
| `serialize_context` | Save the workflow context, so the restarted run starts with it. Default `true` |
| `enforce` | Restart even if the runtime has not suggested it. For testing |

After the restart, `main` runs again **from the beginning** with the saved context, so the spec
must skip work that is already done. Container-scoped and task-local values are not saved.
`checkpoint` does nothing on the in-memory runtime. If `main` is a single `state_machine`, use a
state's [`checkpoint_policy`](#checkpoint_policy) instead: the machine resumes in the right state
by itself.

**Result `_`:** `null`.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: checkpoint-task

context:
  processed: 0

input:
  total: 1000

output:
  processed: '{{ processed }}'

main:
  loop:
    in: '{{ range(processed, total) }}'    # resumes where the previous run stopped
    foreach: n
    do:
      tasks:
        - task_name: process
          set:
            - processed: '{{ n + 1 }}'
        - task_name: maybe-continue-as-new
          skip_if: '{{ processed % 100 != 0 }}'
          checkpoint:
            serialize_context: true
```

---

### state_machine

An event-driven finite state machine: states, and transitions between them triggered by events,
timers or conditions. See [State Machines](../concepts/state-machines.md) for a full guide.

```text
state_machine:
  initial_state: <state name>
  states: [<state>, ...]
  transitions: [<transition>, ...]
  event_source_topic: <topic>
  timeout_sec: <seconds>

state:
  name: <name>
  description: <text>
  is_terminal: <bool>
  on_enter: <task>
  on_exit: <task>
  timeout_sec: <seconds>
  max_timeout_attempts: <int>
  timers: [{name, timeout_sec, max_timeout_attempts}, ...]
  checkpoint_policy: {timeout_sec, event_count, serialize_context, auto_resume, enforce}

transition:
  from_state: <state name> | [<state name>, ...] | null
  to_state: <state name> | null
  trigger:
    event_type: <name>
    condition: <condition>
    action: <task>
```

| Field | Description |
|---|---|
| `initial_state` | The state the machine starts in (required) |
| `states` | The states (required) |
| `transitions` | The transitions |
| `event_source_topic` | The topic the machine reads events from |
| `timeout_sec` | Time limit for the whole machine |

| State field | Description |
|---|---|
| `name` | The state's name (required) |
| `is_terminal` | The machine stops when it enters this state |
| `on_enter` / `on_exit` | A task run when the state is entered / left |
| `timeout_sec`, `max_timeout_attempts` | An unnamed timer: fires `sys.timer` after `timeout_sec`, up to `max_timeout_attempts` times |
| `timers` | Named timers: each fires `sys.timer.<name>`, and `sys.timer.<name>.final` when its attempts run out |
| `checkpoint_policy` | Checkpoint while the machine waits in this state. See [below](#checkpoint_policy) |

| Transition field | Description |
|---|---|
| `from_state` | The state(s) it leaves from. `null` or omitted: any state (a global trigger) |
| `to_state` | The state it enters. `null`: an internal transition, which runs `action` without leaving the state (no `on_exit` / `on_enter`) |
| `trigger.event_type` | The event that fires it. May be an expression. Without it, the transition is **automatic**: checked as soon as the state is entered, and it must have a `to_state` |
| `trigger.condition` | A [condition](./workflowspec-reference.md#conditions) that must also hold |
| `trigger.action` | A task run when the transition fires |

Inside `on_enter`, `on_exit`, `action` and `condition`, the workflow context and `event` (the
triggering event) are visible; container scopes around the state machine are not.
`__sys_info__["state_machine"]` holds `name` (the task's `task_name`), `current_state`, and the
checkpoint fields below.

**Result `_`:** the name of the terminal state reached.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: state-machine-task

context:
  approver: ''

input:
  amount: 800

output:
  final_state: '{{ final_state }}'
  approver: '{{ approver }}'

main:
  task_name: approval
  state_machine:
    initial_state: routing
    timeout_sec: 86400
    states:
      - name: routing
      - name: manager_review
        timers:
          - name: remind
            timeout_sec: 3600
            max_timeout_attempts: 24
      - name: approved
        is_terminal: true
        on_enter:
          set:
            - _log#: 'approved by {{ approver }}'
      - name: rejected
        is_terminal: true
    transitions:
      # automatic: no event_type; the first satisfied one wins
      - from_state: routing
        to_state: approved
        trigger:
          condition: '{{ amount < 1000 }}'
          action:
            set:
              - approver: system
      - from_state: routing
        to_state: manager_review

      # internal transition: stay in the state, run the action on each timer tick
      - from_state: manager_review
        to_state:
        trigger:
          event_type: sys.timer.remind
          action:
            set:
              - _log#: 'reminder: {{ amount }} awaits a manager'

      # event-driven
      - from_state: manager_review
        to_state: approved
        trigger:
          event_type: approve
          action:
            set:
              - approver: '{{ event["data"].get("by", "manager") }}'
      - to_state: rejected                    # from any state
        trigger:
          event_type: reject
  output:
    as: final_state
```

#### checkpoint_policy

Declared on a **state**. The runtime checkpoints while the machine sits in that state and resumes
it there afterwards, so the spec does not have to describe recovery. Allowed only when `main` is
the `state_machine` task.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: checkpoint-policy-task

main:
  task_name: monitor
  state_machine:
    initial_state: idle
    states:
      - name: idle
        checkpoint_policy:
          timeout_sec: 300
          event_count: 100
      - name: done
        is_terminal: true
    transitions:
      - from_state: idle
        to_state: done
        trigger:
          event_type: stop
```

| Field | Default | Description |
|---|---|---|
| `timeout_sec` | none | Checkpoint after this long in the state |
| `event_count` | none | Checkpoint after this many events handled in the state |
| `serialize_context` | `true` | Save the workflow context |
| `auto_resume` | `true` | Resume in this state, skipping its `on_enter`. `false` restarts the machine at `initial_state` |
| `enforce` | `false` | Checkpoint even if the runtime has not suggested it. For testing |

At least one of `timeout_sec` and `event_count` is required; with both, whichever trips first
wins. An event counts toward `event_count` when a transition matched it in this state and the
state did not change: internal transitions, self-transitions, and events whose condition was
false. Unmatched events do not count, and moving to another state resets the count. On resume
the state's `on_enter` is skipped (it already ran) and its timers restart from their full
duration.

**Opting out of auto-resume.** `auto_resume: false` keeps the checkpoint but restarts the
machine at `initial_state`, with `on_enter` running normally. Use it when an earlier state has a
side effect the new run needs again, typically an `init` state that starts an `async_mode`
activity feeding the machine's topic: activity handles do not survive a checkpoint. The state the
checkpoint fired in stays readable, so `init` can redo its side effect and route straight back:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: checkpoint-auto-resume-task

main:
  task_name: price-monitor
  state_machine:
    initial_state: init
    event_source_topic: monitor_events
    states:
      - name: init
        on_enter:
          task_name: subscriber              # restarted on every run
          activity:
            type: builtin.delay
            input: {duration: 1s}
            options:
              async_mode: true
              async_event_topic: monitor_events
      - name: warmup
      - name: monitoring
        checkpoint_policy:
          event_count: 100
          auto_resume: false
      - name: done
        is_terminal: true
    transitions:
      # Listed first: the first satisfied automatic transition wins.
      - from_state: init
        to_state: monitoring
        trigger:
          condition: '{{ __sys_info__.get("state_machine", {}).get("checkpointed_from_state") == "monitoring" }}'
      - from_state: init
        to_state: warmup
      - from_state: warmup
        to_state: monitoring
      - from_state: monitoring
        to_state: done
        trigger:
          event_type: stop
```

| `__sys_info__["state_machine"]` key | Description |
|---|---|
| `name` | The state machine task's `task_name`, or `unnamed_state_machine` |
| `current_state` | The state the machine is in. Updated before a state's `on_enter` runs; during a transition's `action` it is still the source state |
| `checkpointed_from_state` | The state the last checkpoint fired in, whether or not the machine resumed there |
| `resumed_from_state` | The state the machine jumped back into after a checkpoint. `null` under `auto_resume: false` |

Both checkpoint keys are `null` on a first run. The `state_machine` key is removed when the
machine completes, and a nested machine restores the outer values when it exits.

---

### rules_engine

Evaluates rules over a working memory of facts, either forward (data-driven) or backward
(goal-driven). See [Rules Engine](../concepts/rules-engine.md) for a full guide, including live
mode.

```text
rules_engine:
  input:
    facts: <mapping>
    run_mode: forward | backward
    fact_resolvers: {<fact name>: <task>, ...}
    terminate_facts: [<fact name>, ...]
    keep_alive: <bool>
    fact_source_topic: <topic>
    timeout_sec: <seconds>
    max_iterations: <int>
  rules:
    - id: <id>
      name: <text>
      description: <text>
      if:
        with_facts: [<fact name>, ...]
        expression: <condition>
      then:
        set_facts: [{<fact name>: <value or task>}, ...]
        actions: [<task>, ...]
```

| Field | Description |
|---|---|
| `input.facts` | The initial facts. Evaluated. In `backward` mode, give a goal fact the value `null` |
| `input.run_mode` | `forward` (default) or `backward` |
| `input.fact_resolvers` | A task per fact that produces the fact on demand |
| `input.terminate_facts` | Stop once all of these facts are derived |
| `input.keep_alive` | Live mode: keep the session open and re-evaluate as facts arrive as events |
| `input.fact_source_topic` | In live mode, the topic carrying `set_facts` events. Default `default` |
| `input.timeout_sec` | Time limit of a live session |
| `input.max_iterations` | Safety limit on evaluation cycles in live mode. Default 1000 |
| `rules[].id` | Unique rule id (required) |
| `rules[].if.with_facts` | The facts the rule reads |
| `rules[].if.expression` | A [condition](./workflowspec-reference.md#conditions) over the facts, which are bound as bare names (a `.` in a fact name becomes `_`) |
| `rules[].then.set_facts` | Facts to assert. A plain value is asserted as written, **not evaluated**; a task value is run and its result asserted |
| `rules[].then.actions` | Tasks to run when the rule fires. They run against the workflow context, not the facts |

**Result `_`:** the derived facts, those asserted by rules. The seeded facts are not included.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: rules-engine-task

input:
  credit_score: 720
  employment_years: 7

output: '{{ derived }}'

main:
  task_name: classify-applicant
  rules_engine:
    input:
      facts:
        credit_score: '{{ credit_score }}'
        employment_years: '{{ employment_years }}'
      run_mode: forward
    rules:
      - id: credit_tier_good
        if:
          with_facts: [credit_score]
          expression:
            and:
              - '{{ credit_score >= 650 }}'
              - '{{ credit_score < 750 }}'
        then:
          set_facts:
            - credit_tier: good
      - id: stable_employment
        if:
          with_facts: [employment_years]
          expression: '{{ employment_years >= 5 }}'
        then:
          set_facts:
            - employment_stable: true
          actions:
            - set:
                - _log#: stable employment
  output:
    as: derived                 # {credit_tier: good, employment_stable: true}
```

---

## Container

### tasks

Runs a list of child tasks, one after another or all at once.

```text
props:
  execute_mode: sequential | parallel   # default sequential
  join_type: all | any                  # default all; parallel only
tasks:
  - <task>
  - ...
```

| `props` | Behaviour | Result `_` |
|---|---|---|
| `execute_mode: sequential` (default) | Children run in order. An uncaught child error stops the container. A `raise: exit` leaves it | List of child results, in order |
| `execute_mode: parallel`, `join_type: all` (default) | All children start at once. The first uncaught error fails the container and cancels the rest | List of child results, in declaration order |
| `execute_mode: parallel`, `join_type: any` | All children start at once. The first to succeed wins and the rest are cancelled. Fails only if every child fails | The winning child's result |

The container opens a [container scope](./workflowspec-reference.md#scopes-and-name-resolution):
values written as `name@` inside it are visible to later children and vanish when it ends. In
parallel mode, each child works on its own copy of the enclosing container scopes, and writes to
the workflow context are applied as children finish.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: tasks-container

output: '{{ result }}'

main:
  tasks:
    - task_name: start
      set:
        - started_at@: '{{ now() }}'            # visible to later siblings only

    - task_name: fetch-in-parallel
      props:
        execute_mode: parallel
        join_type: all
      tasks:
        - task_name: fast
          activity:
            type: builtin.delay
            input: {duration: 1s}
          output:
            data: fast done
        - task_name: slow
          activity:
            type: builtin.delay
            input: {duration: 2s}
          output:
            data: slow done
      output:
        as: results                             # [fast done, slow done]

    - task_name: summarise
      set:
        - result:
            started_at: '{{ started_at }}'
            results: '{{ results }}'
```

---

## Control flow

### loop

Runs a task once for each item of a collection.

```text
loop:
  in: <iterable>
  foreach: <name>                        # default item
  index: <name>
  execute_mode: sequential | parallel    # default sequential
  join_type: all | any                   # default all; parallel only
  do: <task>
```

| Field | Description |
|---|---|
| `in` | The collection: a list, `range(...)`, `dict.items()`, any iterable. Evaluated once, before the first iteration (required) |
| `foreach` | Name of the loop variable. Default `item` |
| `index` | Name of a 0-based position variable. Optional |
| `execute_mode` | How the **iterations** run. Default `sequential` |
| `join_type` | With parallel iterations: `all` (default) or `any` (the first to succeed wins) |
| `do` | The task run for each item (required) |

- Each iteration opens a fresh container scope holding `foreach` and `index`, so `name@` values
  are private to the iteration, even in parallel.
- `execute_mode` and `join_type` are keys of `loop`, not `props`. If `do` is a `tasks` container,
  its own `props` govern its children within each iteration, independently.
- A nested loop must use different `foreach` / `index` names. The outer loop's variable stays
  visible inside.
- `raise: continue` ends the current iteration (result `null`); `raise: break` ends the loop.
- `foreach` and `index` cannot start with `_` or be reserved names.

**Result `_`:** the list of iteration results, in input order. An iteration's result is the
result of its `do` task, so put an `output` on `do` to choose what each item contributes. With
`join_type: any`, the first successful iteration's result.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: loop-task

input:
  orders:
    - {id: A, units: 2, price: 10.0}
    - {id: B, units: 1, price: 40.0}

output:
  lines: '{{ lines }}'
  grid: '{{ grid }}'

main:
  tasks:
    - task_name: price-each-order
      loop:
        in: '{{ orders }}'
        foreach: order
        index: i
        execute_mode: parallel
        do:
          task_name: price-one
          set:
            - _amount: '{{ order["units"] * order["price"] }}'
          output:
            data:
              line: '{{ i + 1 }}'
              id: '{{ order["id"] }}'
              amount: '{{ _amount }}'
      output:
        as: lines

    - task_name: outer
      loop:
        in: '{{ ["x", "y"] }}'
        foreach: letter
        do:
          task_name: inner
          loop:
            in: '{{ [1, 2] }}'
            foreach: number
            do:
              set: []
              output:
                data: '{{ letter }}{{ number }}'
      output:
        as: grid                              # [[x1, x2], [y1, y2]]
```

---

### switch

Compares one value against a list of cases and runs the first that matches.

```text
switch:
  value: <value>
  cases:
    - match: <value or list>
      do: <task>
  default: <task>
```

| Field | Description |
|---|---|
| `value` | The value to compare. Evaluated once (required) |
| `cases[].match` | Evaluated. A list matches when `value` is `in` it; anything else matches with `==` |
| `cases[].do` | The task to run when this case matches |
| `default` | The task to run when no case matches. Optional |

**Result `_`:** the result of the task that ran, or `null` if none did.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: switch-task

input:
  kind: wholesale
  amount: 1200

output: '{{ discount }}'

main:
  task_name: pick-discount
  switch:
    value: '{{ kind }}'
    cases:
      - match: retail
        do:
          set:
            - discount: 0
      - match: [wholesale, partner]
        do:
          set:
            - discount: '{{ 0.15 if amount > 1000 else 0.10 }}'
    default:
      raise:
        type: error
        error_type: ValidationError
        message: 'unknown order kind {{ kind }}'
```

---

### branches

Runs the first branch whose condition is true: `if`, then any number of `elif`, then an optional
`else`.

```text
branches:
  - if: <condition>
    do: <task>
  - elif: <condition>
    do: <task>
  - else:
    do: <task>
```

| Field | Description |
|---|---|
| `if` | The first item's [condition](./workflowspec-reference.md#conditions) (required on the first item) |
| `elif` | A later item's condition |
| `else` | Written with no value. At most one, and it must be last |
| `do` | The task the item runs |

Conditions are evaluated in order until one is true. Each must evaluate to a `bool`.

**Result `_`:** the result of the branch that ran, or `null` if none did.

```yaml
header:
  schema_version: 2.0.0
  workflow_name: branches-task

input:
  amount: 5000

output: '{{ route }}'

main:
  task_name: route-purchase
  branches:
    - if: '{{ amount < 1000 }}'
      do:
        set:
          - route: auto
    - elif:
        and:
          - '{{ amount >= 1000 }}'
          - '{{ amount <= 10000 }}'
      do:
        set:
          - route: manager
    - else:
      do:
        set:
          - route: executive
```

For a guard on a single task, `skip_if` is shorter than a one-branch `branches`.

---

## Next Steps

- [Workflowspec Reference](./workflowspec-reference.md): document structure, expressions, scopes
  and error handling
- [Activity Catalog](./activity-catalog.md): every activity an `activity` task can call
- [Child Workflows](../concepts/child-workflows.md): composing workflows
- [Events](../concepts/events.md): `emit_event`, `wait_for` and event-driven patterns
- [State Machines](../concepts/state-machines.md): event-driven workflows in depth
- [Rules Engine](../concepts/rules-engine.md): declarative rule evaluation
