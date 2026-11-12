---
sidebar_label: State Machines
sidebar_position: 3
---

# State Machines

The `state_machine` task implements an event-driven finite state machine (FSM) inside a workflow. Use it when your workflow needs to wait for external events and transition between named states based on those events.

For full workflowspec context, see the [Workflowspec Reference](../reference/workflowspec-reference.md).

---

## Basic Structure

```yaml
- task_name: order-fsm
  state_machine:
    initial_state: pending
    timeout_sec: 300
    event_source_topic: order_events

    states:
      - name: pending
      - name: processing
      - name: completed
        is_terminal: true
      - name: failed
        is_terminal: true

    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_type: start_processing

      - from_state: processing
        to_state: completed
        trigger:
          event_type: processing_complete

      - from_state: processing
        to_state: failed
        trigger:
          event_type: processing_failed
  output:
    as: final_state            # the name of the terminal state reached
```

Like any task, a state machine is named with `task_name`, and its result is available as `_` in its
`output`: the **name of the terminal state** the machine ended in.

### Top-Level Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial_state` | string | State to start in |
| `states` | list | State definitions |
| `transitions` | list | Transition rules between states |
| `event_source_topic` | string | Event topic the machine listens on. Defaults to `default` |
| `timeout_sec` | number | Maximum total runtime before the machine times out |

`initial_state`, and every `from_state` and `to_state`, must name a declared state.

---

## States

### State Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique state name |
| `description` | string | Documentation only |
| `is_terminal` | boolean | Mark as a final state; reaching it ends the machine |
| `on_enter` | task | Run when entering this state |
| `on_exit` | task | Run when leaving this state |
| `timeout_sec` | number or expression | Arm a timer on entry; it emits `sys.timer` (see [Timers](#timers)) |
| `max_timeout_attempts` | integer | How many times that timer fires before `sys.timer.final` |
| `timers` | list | Named timers (see [Timers](#timers)) |
| `checkpoint_policy` | object | Let the runtime continue-as-new while in this state (see [Long-running machines](#long-running-machines)) |

### State Callbacks

`on_enter` and `on_exit` each take one task — use a `tasks` container for several:

```yaml
states:
  - name: processing
    on_enter:
      tasks:
        - set:
            - entered_at: "{{ now() }}"
        - task_name: process-order
          activity:
            type: http.request
            input:
              method: POST
              url: "{{ orders_url }}/{{ order_id }}/process"
              output_json: true
          output:
            as: process_result
        - task_name: report-processing
          emit_event:
            topic: order_events
            event_type: '{{ "processing_complete" if process_result.get("success") else "processing_failed" }}'

    on_exit:
      set:
        - exited_at: "{{ now() }}"
```

The `on_enter` callback typically does the work for a state and then emits an event to trigger the
next transition.

Callbacks, transition actions and conditions run against the **workflow context**, plus `event`
where there is one. Variables they `set` without a marker go to the context, so later states — and
the tasks after the machine — can read them. Container-scope (`@`) variables of the tasks around the
machine are not visible inside it.

---

## Transitions

| Field | Description |
|-------|-------------|
| `from_state` | A state name, a list of names, or omitted for "any state" |
| `to_state` | The target state. Omit it (or leave it empty) for an [internal transition](#internal-transitions) |
| `trigger.event_type` | The event that fires the transition. Omit it for an [automatic transition](#automatic-transitions) |
| `trigger.condition` | A condition that must also be true |
| `trigger.action` | A task run when the transition fires, with `event` in scope |

### Basic Transition

```yaml
transitions:
  - from_state: pending
    to_state: approved
    trigger:
      event_type: approve
```

### Transition with Condition

Only fire the transition if the event data meets a condition:

```yaml
transitions:
  - from_state: pending
    to_state: processing
    trigger:
      event_type: start_processing
      condition:
        and:
          - '{{ event["data"].get("price", 0) > 0 }}'
          - '{{ event["data"].get("inventory_available") == True }}'
```

A condition is an expression that evaluates to a boolean, or an `and` / `or` / `not` tree of them.
The `event` variable inside conditions and actions contains the full event object:

```python
{
  "data": {...},          # Event payload
  "topic": "...",         # Event topic
  "event_type": "...",    # Event type
  "event_id": "...",      # Unique event id
  "source": "...",        # Workflow that emitted the event
  "timestamp": ...,       # When the event was published
  "metadata": {...}       # Event metadata
}
```

### Transition Actions

`trigger.action` is a task that runs as the transition fires — after the old state's `on_exit` and
before the new state's `on_enter`. It is the place to copy data out of the event:

```yaml
transitions:
  - from_state: awaiting_approval
    to_state: approved
    trigger:
      event_type: approve
      action:
        set:
          - approver: '{{ event["data"].get("by", "unknown") }}'
```

### Multiple Transitions from One State

```yaml
transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_type: success

  - from_state: processing
    to_state: failed
    trigger:
      event_type: error

  - from_state: processing
    to_state: pending
    trigger:
      event_type: retry
```

### Automatic Transitions

A transition with no `event_type` fires as soon as the machine enters `from_state` (after
`on_enter`) and its condition, if any, holds. It must name a `to_state`. Use it for routing:

```yaml
transitions:
  - from_state: received
    to_state: auto_approved
    trigger:
      condition: "{{ amount <= auto_approve_limit }}"

  - from_state: received
    to_state: manager_review
    trigger:
      condition: "{{ amount > auto_approve_limit }}"

  - from_state: auto_approved      # no trigger at all: always moves on
    to_state: completed
```

### Internal Transitions

A transition with no `to_state` handles an event **without leaving the state**: its action runs, but
`on_exit` and `on_enter` do not. Use it to record something while waiting:

```yaml
transitions:
  - from_state: awaiting_approval
    to_state:
    trigger:
      event_type: add_comment
      action:
        set:
          - _c: '{{ comments.append(event["data"].get("comment")) }}'
```

---

## Global Triggers

A transition that omits `from_state` is a **wildcard**: it can fire from any state. Useful for
cancellation or error escalation. State-specific transitions are matched first; wildcard
transitions are the fallback.

```yaml
- task_name: order-fsm
  state_machine:
    initial_state: pending
    event_source_topic: order_events

    states:
      - name: pending
      - name: processing
      - name: cancelled
        is_terminal: true
      - name: failed
        is_terminal: true

    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_type: start

      # No from_state -> fires from any state
      - to_state: cancelled
        trigger:
          event_type: cancel

      - to_state: failed
        trigger:
          event_type: critical_error
```

`from_state` also accepts a list to scope a transition to specific states (an empty list is
equivalent to omitting it):

```yaml
    - from_state: [pending, processing]
      to_state: cancelled
      trigger:
        event_type: cancel
```

---

## Event Source Configuration

A state machine listens on one topic, `event_source_topic` (default `default`), and every
event-driven transition matches events arriving there. Send events to it with `emit_event`, setting
`target_workflow_id` to the machine's workflow id when the sender is another workflow.

```yaml
- task_name: order-fsm
  state_machine:
    event_source_topic: order_events
    initial_state: pending
    states:
      - name: pending
      - name: processing
        is_terminal: true
    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_type: start        # matches events on "order_events" whose event_type is "start"
```

`trigger.event_type` is matched against the incoming event's own `event_type` field — the one set
by `emit_event`'s `event_type`, not something inside `data`. To key off a value in the payload
instead, use `trigger.condition`, which has the full `event` in scope.

### Expression Triggers

`trigger.event_type` accepts an embedded expression. It is resolved against the workflow
context on **every incoming event** — not when the machine is built — so it can reference a
value produced after the machine started:

```yaml
transitions:
  - from_state: working
    to_state: ready
    trigger:
      event_type: "{{ work_token }}"
```

The expression is re-evaluated on each event and never cached, so a value that changes between
iterations is picked up. Ordering matters in general: an event that arrives before the
referenced variable is set does not match, and an unmatched event is dropped. Prefer a literal
`event_type` unless the value genuinely cannot be known in advance — the main case where it
cannot is an [async activity token](#triggering-on-an-async-activity), which is unique per
invocation.

### Triggering on an async activity

An activity with `options.async_mode: true` publishes its result as an event when it finishes, so
it can drive a transition. Its token is unique per invocation, so capture it with `output.as` and
use an expression trigger. Point `async_event_topic` at the machine's `event_source_topic`, and
start the activity from a state's `on_enter` — the machine only subscribes when it starts, so a
completion published before that is not seen.

Starting from `on_enter` is also what makes the expression trigger ordering-safe: `on_enter` is
awaited to completion before the event loop dequeues its first event, so the token variable is
always set before a completion can be matched.

```yaml
- task_name: price-fetcher
  state_machine:
    event_source_topic: work_events
    initial_state: fetching
    states:
      - name: fetching
        on_enter:
          task_name: fetch_prices
          activity:
            type: http.request
            input:
              method: GET
              url: "{{ prices_url }}"
              output_json: true
            options:
              async_mode: true
              async_event_topic: work_events
          output:
            as: fetch_token           # the transition below triggers on this
      - name: ready
        is_terminal: true
    transitions:
      - from_state: fetching
        to_state: ready
        trigger:
          event_type: "{{ fetch_token }}"
          action:                     # `event` is in scope in the action and condition
            set:
              - prices: '{{ event["data"] }}'
```

See [Async activity results](./events.md#async-activity-results) for the full event shape and
its limitations.

---

## Timers

A state can arm timers on entry. Each one emits an event on the machine's own topic when it fires,
and transitions handle it like any other event. Timers are cancelled when the state is left.

| Declared as | Emits | After `max_timeout_attempts` |
|-------------|-------|------------------------------|
| `timeout_sec` on the state | `sys.timer` | `sys.timer.final` |
| `timers: [{name: remind, timeout_sec: ...}]` | `sys.timer.remind` | `sys.timer.remind.final` |

A timer that fires without a matching transition re-arms, up to `max_timeout_attempts` times (empty
or `0` means forever), then emits its `.final` event. That gives a natural escalation path — remind
on every lapse, give up after the last:

```yaml
states:
  - name: awaiting_approval
    timers:
      - name: reminder
        timeout_sec: 3600
        max_timeout_attempts: 3
  - name: expired
    is_terminal: true

transitions:
  # internal transition: nag, keep waiting
  - from_state: awaiting_approval
    to_state:
    trigger:
      event_type: sys.timer.reminder
      action:
        set:
          - _log#: "still waiting for a decision"

  - from_state: awaiting_approval
    to_state: expired
    trigger:
      event_type: sys.timer.reminder.final
```

A state may declare several named timers and route each one differently.

---

## Long-running machines

A machine that waits for days accumulates event history. When the state machine is the workflow's
whole `main`, a state can carry a `checkpoint_policy`: while the machine sits in that state, the
runtime continues the workflow as new — serializing the context — and resumes it in the same state,
without re-running `on_enter`.

```yaml
main:
  state_machine:
    initial_state: waiting
    states:
      - name: waiting
        checkpoint_policy:
          event_count: 500        # or timeout_sec: time spent in the state
      - name: done
        is_terminal: true
    transitions:
      - from_state: waiting
        to_state: done
        trigger:
          event_type: finish
```

`event_count` and `timeout_sec` say *when to check*; at each check the workflow continues as new if
the runtime suggests it (its event history is getting large), or always with `enforce: true`.

| Field | Description |
|-------|-------------|
| `event_count` | Check after this many events handled while staying in the state |
| `timeout_sec` | Check after this much time in the state. Accepts an expression |
| `serialize_context` | Carry the context over (default true) |
| `auto_resume` | Resume in this state, skipping `on_enter` (default true). Set false to restart at `initial_state` |
| `enforce` | Checkpoint even when the runtime does not suggest it — for demos and tests |

At least one of `event_count` or `timeout_sec` is required. Checkpointing applies only on the
Temporal runtime.

---

## Complete Example

A three-step order processor with validation, payment, and fulfillment stages:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: order-processor

context:
  status: new

input:
  order_id:
  order_data: {}
  orders_url: https://orders.example.com

output:
  order_id: "{{ order_id }}"
  final_state: "{{ final_state }}"
  status: "{{ status }}"

main:
  task_name: order-processor
  state_machine:
    initial_state: validating
    timeout_sec: 600
    event_source_topic: order_events

    states:
      - name: validating
        on_enter:
          tasks:
            - task_name: validate-order
              activity:
                type: http.request
                input:
                  method: POST
                  url: "{{ orders_url }}/validate"
                  json_data: "{{ order_data }}"
                  output_json: true
              output:
                as: validation_result
            - task_name: report-validation
              emit_event:
                topic: order_events
                event_type: '{{ "validated" if validation_result.get("valid") else "validation_failed" }}'
                data:
                  order_id: "{{ order_id }}"

      - name: processing
        on_enter:
          tasks:
            - task_name: process-payment
              activity:
                type: http.request
                input:
                  method: POST
                  url: "{{ orders_url }}/pay"
                  json_data: "{{ order_data }}"
                  output_json: true
              output:
                as: payment_result
            - task_name: report-payment
              emit_event:
                topic: order_events
                event_type: '{{ "payment_complete" if payment_result.get("success") else "payment_failed" }}'

      - name: completed
        is_terminal: true
        on_enter:
          set:
            - status: completed
            - completed_at: "{{ now() }}"

      - name: failed
        is_terminal: true
        on_enter:
          set:
            - status: failed

    transitions:
      - from_state: validating
        to_state: processing
        trigger:
          event_type: validated

      - from_state: validating
        to_state: failed
        trigger:
          event_type: validation_failed

      - from_state: processing
        to_state: completed
        trigger:
          event_type: payment_complete

      - from_state: processing
        to_state: failed
        trigger:
          event_type: payment_failed

      # No from_state -> fires from any state
      - to_state: failed
        trigger:
          event_type: cancel
  output:
    as: final_state
```

The `moco-examples` project's `state-machine` folder has runnable machines, including a
human-in-the-loop approval with reminder timers.

---

## Next Steps

- [Events](./events.md) — how to emit and receive events
- [Tasks Reference](../reference/statements.md) — all task kinds, including `emit_event` and `wait_for`
- [Workflowspec Reference](../reference/workflowspec-reference.md) — full technical reference
