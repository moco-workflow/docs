---
sidebar_label: RabbitMQ
---

# RabbitMQ Activities

Two activities: `rabbit.publish` sends a message to a topic, and `rabbit.receive` subscribes to one
and feeds each message into the running workflow as an event.

This is the most convenient way to drive a long-running workflow from an outside system — a
workflow parked in `wait_for` wakes up when something publishes to its topic.

## Setup

The connection URL comes from the `connection_url` input field or, when that is unset, from
`MOCO_RMQ_CONNECTION_URL`. Credentials are embedded in the URL; there is no secret-store
integration for this provider.

:::note The same variable enables debug streaming
`MOCO_RMQ_CONNECTION_URL` also backs the debug event bus. A deployment without it loses live run
output and [`builtin.event.emit_debug_event`](./event.md) as well.
:::

## Defaults

| Activity | Timeout | Max attempts | Heartbeat | Async by default |
| --- | --- | --- | --- | --- |
| `rabbit.publish` | 60 s | 3 | — | no |
| `rabbit.receive` | ~10 years | **0 — unlimited** | 20 s interval / 60 s timeout | **yes** |

---

## `rabbit.publish`

Publishes one message to a topic.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `topic` | str | yes | — | Destination topic |
| `data` | any | yes | — | Message payload |
| `event_type` | str | no | `null` | Event type stamped on the message |
| `source` | str | no | `null` | Free-text origin label |
| `metadata` | dict | no | `null` | Extra metadata carried with the message |
| `connection_url` | str | no | `MOCO_RMQ_CONNECTION_URL` | AMQP connection URL |
| `exchange` | str | no | default exchange | Exchange to publish through |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `published` | bool | Always `true` |
| `topic` | str | The topic published to |

**Example**

```yaml
- task_name: publish
  activity:
    type: rabbit.publish
    input:
      topic: "{{ source_topic }}"
      event_type: "{{ event_type }}"
      data: "{{ message }}"
  output:
    as: publish_result
```

---

## `rabbit.receive`

Subscribes to a topic and **relays each message into the running workflow as an event**, which the
workflow picks up with `wait_for`. It runs until the activity is cancelled.

Unlike every other long-running activity, this one **defaults to async mode** — you do not have to
remember `options.async_mode: true`, and it will not block your workflow.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `topic` | str | yes | — | RabbitMQ topic to subscribe to |
| `connection_url` | str | no | `MOCO_RMQ_CONNECTION_URL` | AMQP connection URL |
| `exchange` | str | no | default exchange | Exchange to bind to |
| `relay_topic` | str | no | `"default"` | Event topic the workflow listens on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

Returned when the activity is cancelled:

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |
| `received` | int | Messages relayed during the run |

**Relayed event data**

Each message arrives at `wait_for` as an event whose `data` is:

| Field | Type | Description |
| --- | --- | --- |
| `topic` | str | Source RabbitMQ topic |
| `data` | any | The published payload |
| `event_type` | str \| null | Event type from the publisher |
| `metadata` | dict \| null | Metadata from the publisher |

**Example**

Start the subscriber, then wait for a message:

```yaml
- task_name: subscribe
  activity:
    type: rabbit.receive
    input:
      topic: "demo_topic"          # RabbitMQ source topic
      relay_topic: "demo_topic"    # the topic wait_for listens on
      relay_event_type: "rmq_message"
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    options:
      async_mode: true   # already the default; shown for clarity

- task_name: next-message
  wait_for:
    event:
      topic: "demo_topic"
      event_type: "rmq_message"
    timeout_sec: 600
  output:
    data: "{{ _['data']['data'] if _ else None }}"   # null on timeout
    as: payload
```

:::caution An unreachable broker retries forever
`rabbit.receive` ships `max_attempts: 0`, meaning unlimited retries, so a subscriber survives a
broker restart without operator action. The flip side: a wrong `connection_url` produces an
infinite retry loop rather than a failure. Liveness comes from the 60-second heartbeat, not from
the ten-year timeout.
:::

:::caution Every message costs workflow history
On the Temporal runtime each relayed message is a workflow signal and a history entry, and the
engine keeps at most 1000 unmatched events per topic. Keep the topic low-rate, and make sure a
`wait_for` is actually consuming the events.
:::
