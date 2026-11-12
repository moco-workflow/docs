---
sidebar_label: Events
sidebar_position: 4
---

# Events

Moco supports event-driven workflows through two complementary tasks: `emit_event` (send) and `wait_for` (receive), plus `request`, which sends and waits for the reply in one task. Events enable coordination between concurrent workflows, signal state machine transitions, and implement multi-agent patterns.

For full workflowspec context, see the [Workflowspec Reference](../reference/workflowspec-reference.md).

---

## emit_event

Sends an event to the event bus. The fields sit directly under `emit_event`:

```yaml
- task_name: announce-order
  emit_event:
    topic: notification_events
    event_type: order_created
    data:
      order_id: "{{ order_id }}"
      timestamp: "{{ now() }}"
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | No | Event topic. Defaults to `default` |
| `event_type` | string | No | Event type for filtering and routing |
| `data` | any | No | Event payload |
| `metadata` | object | No | Additional event metadata |
| `target_workflow_id` | string | No | Workflow to deliver to. Defaults to the current workflow |
| `entity_workflow` | object | No | Start the target if it is not running (see [below](#starting-an-entity-workflow-signal-with-start)) |

`emit_event` has no result of its own: its `_` is `null`.

If delivery fails, for example because the target workflow is no longer running, the task fails
with a `PublishError`. To log the failure and carry on instead, add `on_error: {catch: true}` to the
task.

### Targeting a Specific Workflow

Use `target_workflow_id` to send an event to another workflow instance — a parent, a child, or any
workflow whose id you know:

```yaml
- task_name: notify-parent
  emit_event:
    topic: child_events
    event_type: child_complete
    target_workflow_id: "{{ parent_workflow_id }}"
    data:
      result: "{{ processing_result }}"
```

The target must be listening on the same topic with a matching `wait_for` or state machine
transition. Put the discriminator in `event_type` (not inside `data`) — that is the field both
`wait_for`'s `event.event_type` filter and a transition trigger match on.

A workflow learns its own id from `__sys_info__`, so to receive replies it passes
`'{{ __sys_info__.get("workflow_id") }}'` to whoever will emit back.

### Starting an entity workflow (signal-with-start)

Add `entity_workflow` to make sure the target is running before the event is delivered. If no
workflow with `target_workflow_id` is running, it is started under that id first; if one is, the
event goes straight to it. Callers never have to check whether the entity is alive.

```yaml
- task_name: add-item
  emit_event:
    topic: order_events
    event_type: add_item
    target_workflow_id: "order-entity:{{ order_id }}"
    data:
      sku: "{{ item_sku }}"
    entity_workflow:
      ref: order-entity             # or contents / contents_yaml, as in a workflow task
      mode: async                   # async (default) or detached
      input:                        # passed to the entity when it is started
        order_id: "{{ order_id }}"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ref` / `contents` / `contents_yaml` | — | required (one) | The entity's wfspec, given as in a [`workflow` task](./child-workflows.md#where-the-child-comes-from) |
| `mode` | string | `async` | `async` or `detached` |
| `input` | object | null | Input for the entity when it is started |

`target_workflow_id` is required with `entity_workflow` — it is the entity's address. This needs the
Temporal runtime. See [Entity workflows](./how-to-run-workflow.md#entity-workflows) for the pattern.

### Event Metadata

```yaml
- task_name: track-page-view
  emit_event:
    topic: analytics_events
    event_type: page_view
    data:
      page: /products
    metadata:
      priority: low
      source: web_app
```

---

## wait_for

Waits until an event matching the filter arrives, or until the timeout expires.

```yaml
- task_name: await-order
  wait_for:
    event:
      topic: order_events
      event_type: order_created
      match_expression: '{{ event["data"].get("order_id") == order_id }}'
    timeout_sec: 60
  output:
    as: received_event              # null on timeout
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event.topic` | string | No | Event topic to listen on. Defaults to `default` |
| `event.event_type` | string or expression | No | Only events with this exact type match. Evaluated when the wait starts. Also used to collect an [async activity result](#async-activity-results) |
| `event.match_expression` | condition | No | Must be true for an event to match. `event` is bound to the candidate |
| `timeout_sec` | number | No | Maximum wait time in seconds. Required when `event` is omitted |

### The result

`wait_for`'s raw output `_` is the matched event — or `null` if the timeout expired first. **A
timeout is not an error.** Test `_` in the task's own `output`, and keep `on_error` for real
failures:

```yaml
- task_name: await-approval
  wait_for:
    event:
      topic: approvals
      event_type: decision
    timeout_sec: 3600
  output:
    data:
      timed_out: "{{ _ is None }}"
      decision: '{{ _["data"] if _ else None }}'
    as: approval
```

An event is consumed by the **first** waiter it matches. A second `wait_for` on the same event will
time out.

### Event Object Structure

Inside `match_expression`, and as the result of `wait_for`, the event looks like this:

```python
{
  "data": {...},          # Event payload (from emit_event data)
  "topic": "...",         # Event topic
  "event_type": "...",    # Event type
  "event_id": "...",      # Unique event id
  "source": "...",        # Workflow that emitted the event
  "timestamp": ...,       # When the event was published
  "metadata": {...}       # Event metadata
}
```

### Filtering Events

Use `match_expression` to select only events that meet specific criteria. It is a
[condition](./expressions.md): an expression that evaluates to a boolean, or an `and` / `or` /
`not` tree of them.

```yaml
- task_name: await-payment
  wait_for:
    event:
      topic: payment_events
      match_expression:
        and:
          - '{{ event["data"].get("transaction_id") == transaction_id }}'
          - '{{ event["data"].get("status") == "completed" }}'
    timeout_sec: 120
  output:
    as: payment_event
```

### Timeout Only

Omit `event` to use `wait_for` as a simple durable sleep:

```yaml
- task_name: cool-down
  wait_for:
    timeout_sec: 30
```

### Ordering

A `wait_for` whose `topic` is written out literally is listening from the moment the workflow
starts. An event that arrives before the `wait_for` is reached is kept and handed to it, so the
producer can be started before or after the consumer.

A topic computed by an expression (`topic: "{{ ... }}"`) is only known at runtime, so the workflow
starts listening on it at its first `wait_for`. An event published before then can be dropped; start
the producer after that, or have it wait a moment before emitting. From then on the workflow keeps
listening, so nothing between later waits is lost.

An event that no current waiter matches is kept for later `wait_for` tasks on the same topic.
Waiters can therefore pick events out in any order.

---

## Request / Reply

When one workflow needs an answer from another, use `request`. It sends the event and waits for the
reply in one task:

```yaml
- task_name: get-quote
  request:
    target_workflow_id: "{{ pricing_id }}"   # required
    topic: pricing                           # default "default"
    event_type: get_quote
    data:
      sku: "{{ sku }}"
    timeout_sec: 30
  output:
    data: "{{ _['data'] }}"                  # _ is the reply event
    as: quote
  on_error:
    catch: true
    do:
      set:
        - quote: null
```

The receiver, often a state machine, answers with `emit_event` and `reply_to`, passing the request
event it received:

```yaml
trigger:
  event_type: get_quote
  action:
    emit_event:
      reply_to: "{{ event }}"                # the request event, or its metadata
      event_type: quote
      data:
        price: 12
```

How it works:

- **Correlation is automatic.** `request` adds a unique `correlation_id`, its own workflow id
  (`reply_to`) and the reply topic (`reply_topic`, default `moco.reply`) to the request's
  `metadata`. `reply_to` reads them back to address the reply. The requester waits for that
  correlation id alone, so several requests can be in flight at once, a parallel loop for example,
  and each gets its own reply in any order. You do not need a `match_expression`.
- **A missing reply is an error.** Unlike `wait_for`, which gives `null` on timeout, a `request`
  with no reply within `timeout_sec` raises `RequestTimeoutError`. Catch it with `on_error`. A
  request without `timeout_sec` waits forever, and the validator warns about it.
- **`reply_to` does the routing.** It cannot be combined with `target_workflow_id`, `topic` or
  `entity_workflow`. Passing something that is not a request event raises `ReplyError`.
- **Late replies are dropped.** A reply that arrives after its request timed out is discarded.
- The receiver must be running to get the request. To start it on demand, make it an
  [entity workflow](#starting-an-entity-workflow-signal-with-start).

See `moco-examples/basics/25-request-reply.yaml` for a runnable example.

---

## Async Activity Results

An activity with `options.async_mode: true` is started without blocking. Instead of its result it
returns a **token**, and when it finishes the engine publishes its result to the event bus as an
ordinary event whose `event_type` is that token. This lets a long-running activity overlap with
the rest of the workflow, and its result be collected later.

The token is `async-activity:<task name>:<run id>` — unique per invocation, so starting the same
activity twice yields two tokens whose completions cannot be confused. Because it is not knowable
in advance, capture it with `output.as` and reference it as an expression.

```yaml
- task_name: fetch_prices                 # token: "async-activity:fetch_prices:<run id>"
  activity:
    type: http.request
    input:
      method: GET
      url: "{{ prices_url }}"
      output_json: true
    options:
      async_mode: true
      async_event_topic: default          # optional; where the completion is published
  output:
    as: fetch_token
```

### The completion event

```python
{
  "topic": "default",                            # async_event_topic
  "event_type": "async-activity:fetch_prices:6f1c0f2a-...",   # the token
  "data": {...},                                 # activity output (None if it failed)
  "source": "...",                               # the workflow id
  "metadata": {
    "workflow_id": "...",
    "async_activity": True,
    "activity_type": "http.request",
    "activity_name": "fetch_prices",             # the task_name
    "run_id": "6f1c0f2a-...",                    # the token's suffix
    "status": "completed",                       # or "failed"
    "error": "...",                              # only when status is "failed"
  },
}
```

### Collecting it with `wait_for`

```yaml
- task_name: await-prices
  wait_for:
    event:
      event_type: "{{ fetch_token }}"
    timeout_sec: 30
  output:
    data: '{{ _["data"] if _ else None }}'    # the activity output
    as: prices
```

### Driving a state machine transition

Because the completion is a normal event, it can trigger a transition. The token is unique per
invocation, so the trigger references it as an
[expression](./state-machines.md#expression-triggers) — `event_type` is re-resolved against the
workflow context on every incoming event.

This is ordering-safe as long as the activity is started from the machine's `on_enter`: the
machine subscribes its topic before starting, and `on_enter` is awaited to completion before the
event loop dequeues its first event, so `fetch_token` is set before the completion can arrive.

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
              async_event_topic: work_events   # == event_source_topic
          output:
            as: fetch_token                    # capture the token
      - name: ready
        is_terminal: true
    transitions:
      - from_state: fetching
        to_state: ready
        trigger:
          event_type: "{{ fetch_token }}"
          action:                              # `event` is in scope here
            set:
              - prices: '{{ event["data"] }}'
```

### Notes and limitations

- **Waiting is optional.** Ignore the token and `async_mode` is plain fire-and-forget.
- **Failure does not raise.** Check `event["metadata"]["status"]` and branch on it; `wait_for`
  returns `null` on timeout as usual.
- **Consume-once.** The first matching waiter takes the event; a second `wait_for` on the same
  token times out.
- **Start inside the machine.** A state machine subscribes to its topic only when it starts, so
  start async activities from `on_enter`, not before the machine.
- **Not durable across a checkpoint.** In-flight completions are lost when the workflow continues
  as new.
- **Temporal.** An activity still running when the workflow completes is cancelled. For work
  that must outlive the workflow, use `emit_event` or a `detached` child workflow.

---

## State Machine Events

Events are the primary trigger mechanism for [state machines](./state-machines.md). A state machine
listens on its `event_source_topic` (default `default`). A state's `on_enter` typically does work
and emits an event that drives the next transition:

```yaml
states:
  - name: processing
    on_enter:
      tasks:
        - task_name: charge
          activity:
            type: http.request
            input:
              method: POST
              url: "{{ payments_url }}"
              json_data: "{{ order_data }}"
              output_json: true
          output:
            as: payment_result
        - task_name: report-payment
          emit_event:
            topic: order_events
            event_type: '{{ "payment_complete" if payment_result.get("success") else "payment_failed" }}'

transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_type: payment_complete

  - from_state: processing
    to_state: failed
    trigger:
      event_type: payment_failed
```

---

## Multi-Agent Pattern

Coordinate multiple child workflows using events.

**Parent workflow** — starts one `async` child per agent, then collects one reply from each:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: parent-orchestrator

input:
  agent_configs:
    - {agent_id: researcher}
    - {agent_id: reviewer}

output:
  results: "{{ results }}"

main:
  tasks:
    - task_name: start-agents
      loop:
        in: "{{ agent_configs }}"
        foreach: agent
        execute_mode: parallel
        do:
          workflow:
            ref: child-agent
            mode: async
            input:
              config: "{{ agent }}"
              parent_workflow_id: '{{ __sys_info__.get("workflow_id") }}'
      output:
        as: child_ids                 # one workflow_id per agent

    - task_name: collect-replies
      loop:
        in: "{{ agent_configs }}"
        foreach: agent
        do:
          task_name: await-agent
          wait_for:
            event:
              topic: child_events
              event_type: complete
              match_expression: '{{ event["data"]["agent_id"] == agent["agent_id"] }}'
            timeout_sec: 300
          output:
            data: '{{ _["data"]["result"] if _ else None }}'   # null if the agent timed out
      output:
        as: results
```

**Child workflow** — does work and signals the parent:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: child-agent

input:
  config:
  parent_workflow_id:

main:
  tasks:
    - task_name: do-work
      activity:
        type: http.request
        input:
          method: POST
          url: https://agents.example.com/run
          json_data: "{{ config }}"
          output_json: true
      output:
        as: result

    - task_name: report-back
      emit_event:
        topic: child_events
        event_type: complete
        target_workflow_id: "{{ parent_workflow_id }}"
        data:
          agent_id: '{{ config["agent_id"] }}'
          result: "{{ result }}"
```

Each reply carries the agent's id in `data`, so the parent's `match_expression` takes each reply
exactly once, whatever order the children finish in: a reply that arrives while the parent is
waiting for a different agent is kept for that agent's `wait_for`. Because `child_events` is a
literal topic, a reply sent before the parent's first `wait_for` begins is kept too (see
[Ordering](#ordering)).

---

## Next Steps

- [State Machines](./state-machines.md) — event-driven FSM patterns
- [Composing Workflows](./child-workflows.md) — `async` children and how they report back
- [Tasks Reference](../reference/statements.md) — full `emit_event`, `wait_for` and `request` parameter reference
- [Workflowspec Reference](../reference/workflowspec-reference.md) — complete technical reference
