---
sidebar_label: Kafka
---

# Kafka Activities

Two activities: `kafka.publish` sends messages to a topic, and `kafka.consume` subscribes to one
and feeds each message into the running workflow as an event.

## Setup

The broker comes from the `broker` input field or, when that is unset, from `MOCO_KAFKA_BROKER`.
There is no secret-store integration; SASL/SSL settings go in `kafka_config` on
[`kafka.consume`](#kafkaconsume).

The worker needs the `confluent_kafka` package (and its bundled librdkafka).

## Defaults

| Activity | Timeout | Max attempts | Heartbeat |
| --- | --- | --- | --- |
| `kafka.publish` | 60 s | 3 | — |
| `kafka.consume` | 86400 s (1 day) | 1 | 20 s interval / 60 s timeout |

---

## `kafka.publish`

Publishes one or more messages to a topic. Each message is a `[key, value]` pair; the value is a
JSON-serializable object.

By default the activity does **not** wait for broker acknowledgement (`no_wait: true`) — it
enqueues and returns. Set `no_wait: false` when you need to know each message landed.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `messages` | list[[key, value]] | yes | — | Messages as two-element lists: a string key (or `null`) and an object value |
| `topic` | str | no | `null` | Destination topic |
| `broker` | str | no | `MOCO_KAFKA_BROKER` | Bootstrap server list |
| `no_wait` | bool | no | `true` | Return without waiting for delivery acknowledgement |

**Output**

With `no_wait: true` (the default): `null`.

With `no_wait: false`: a list with one entry per message —

| Field | Type | Description |
| --- | --- | --- |
| `result` | str | `"success"` or `"fail"` |
| `message` | str | Delivery details, or the error when the result is `fail` |

**Example**

```yaml
- task_name: publish-orders
  activity:
    type: kafka.publish
    input:
      topic: "orders.enriched"
      broker: "{{ kafka_broker }}"
      no_wait: false          # wait for acknowledgement so failures surface here
      messages: "{{ [ [o['order_id'], o] for o in enriched_orders ] }}"
  output:
    as: publish_result        # -> [{result, message}, ...]

- task_name: check-delivery
  raise:
    if: "{{ any(r['result'] == 'fail' for r in publish_result) }}"
    type: error
    message: "Kafka delivery failed: {{ publish_result }}"
```

:::caution Fire-and-forget is the default
With `no_wait: true` a broker outage is invisible to the workflow — the activity succeeds and the
messages are lost. Use `no_wait: false` for anything you cannot afford to drop.
:::

---

## `kafka.consume`

Subscribes to a topic and **relays each message into the running workflow as an event**, which the
workflow picks up with `wait_for`. It runs until cancelled.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `topic` | str | yes | — | Topic to subscribe to |
| `consumer_group` | str | yes | — | Consumer group id; offsets are tracked per group as usual |
| `broker` | str | no | `MOCO_KAFKA_BROKER` | Bootstrap server list |
| `kafka_config` | dict | no | `null` | Extra librdkafka settings — SASL, SSL, `auto.offset.reset`, … |
| `relay_topic` | str | no | `"default"` | Event topic the workflow listens on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

Returned when the activity is cancelled:

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |
| `last_offsets` | dict[str, int] | Last offset seen, keyed `"<topic>:<partition>"` |

**Relayed event data**

Each message arrives at `wait_for` as an event whose `data` is:

| Field | Type | Description |
| --- | --- | --- |
| `key` | any | Message key — parsed JSON, else a string, else raw bytes |
| `value` | any | Message value, decoded the same way |
| `topic` | str | Source topic |
| `partition` | int | Source partition |
| `offset` | int | Message offset |

**Example**

Start the consumer in the background, then handle messages as they arrive:

```yaml
- task_name: start-consumer
  activity:
    type: kafka.consume
    input:
      topic: "orders.raw"
      consumer_group: "moco-enricher"
      broker: "{{ kafka_broker }}"
      relay_topic: "kafka.msg"
      relay_event_type: "kafka_message"
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    options:
      async_mode: true          # required: otherwise this blocks for a day

- task_name: store-messages
  loop:
    in: "{{ range(max_messages) }}"
    do:
      tasks:
        - task_name: next-message
          wait_for:
            event:
              topic: "kafka.msg"
              event_type: "kafka_message"
            timeout_sec: 300
          output:
            as: msg@
        - task_name: stop-when-idle
          raise:
            if: "{{ msg is None }}"   # wait_for timed out
            type: break
        - task_name: insert-row
          activity:
            type: sql.execute
            input:
              connection_string_secret_key: "ORDERS_DB_CONN"
              statement: "INSERT INTO order_raw (order_id, payload) VALUES (:id, :payload)"
              parameters:
                id: "{{ msg['data']['key'] }}"
                payload: "{{ msg['data']['value'] }}"
```

:::caution Start it asynchronously
`kafka.consume` blocks for its whole timeout — a full day. Set `options.async_mode: true`, or run
it in a parallel `tasks` container alongside the tasks that consume its events. Unlike
[`rabbit.receive`](./rabbit.md#rabbitreceive), it does **not** default to async mode.
:::

:::caution Every message costs workflow history
On the Temporal runtime each relayed message becomes a workflow signal and a history entry, and the
engine keeps at most 1000 unmatched events per topic before evicting the oldest. This activity
suits low-rate control topics, not high-throughput data streams — for those, consume outside the
workflow and start a workflow per batch.
:::

:::note Offsets and delivery
Offsets are committed by the consumer group normally, but relayed events are independent of that:
a workflow that crashes can lose messages already consumed and relayed. The `last_offsets` in the
output, and the same values in the activity's heartbeat details, are what a retry would use to
reason about where it got to.
:::
