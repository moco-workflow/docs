---
sidebar_label: WebSocket
---

# WebSocket Activities

One activity, `websocket.subscribe`, holds a WebSocket connection open and feeds each inbound frame
into the running workflow as an event.

Use it for a plain WebSocket feed — a market data stream, a vendor's push API. When the server
speaks the `graphql-transport-ws` protocol, use [`graphql.subscribe`](./graphql.md) instead; this
provider does no protocol negotiation beyond advertising subprotocols.

## Setup

No configuration and no secret-store integration: authentication is whatever the server expects —
handshake `headers`, or an auth frame sent as the first `init_messages` entry.

:::caution Tokens are visible
A credential in `headers` or `init_messages` passes through workflow context and history in
plaintext.
:::

The worker needs the `websockets` package.

## Defaults

86400 s (1 day) timeout, 1 attempt, heartbeating every 20 s against a 60 s timeout.

---

## `websocket.subscribe`

Connects, optionally sends one or more opening frames, then relays every inbound frame as a
workflow event that `wait_for` receives. It runs until the activity is cancelled.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | str | yes | — | WebSocket URL, e.g. `wss://stream.example.com/v1` |
| `headers` | dict[str, str] | no | `null` | Handshake headers |
| `subprotocols` | list[str] | no | `null` | Subprotocols offered during the handshake |
| `init_messages` | list[any] | no | `null` | Frames sent immediately after connecting — a subscribe or auth frame. A string is sent verbatim; anything else is JSON-encoded |
| `parse_json` | bool | no | `true` | Parse each inbound frame as JSON, falling back to the raw string when it is not valid JSON |
| `relay_topic` | str | no | `"default"` | Event topic the workflow listens on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |

The frames themselves arrive as events, not in the output.

**Relayed event data**

Each event's `data` is the frame: a parsed object when `parse_json` is true and the frame is valid
JSON, otherwise the decoded string.

**Example**

Adapted from the provider's integration test:

```yaml
- task_name: start-subscription
  activity:
    type: websocket.subscribe
    input:
      url: "wss://stream.example.com/v1"
      init_messages:
        - action: subscribe
          symbol: AAPL
      relay_topic: ws.msg
      relay_event_type: ws_payload
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    options:
      async_mode: true
      retry_policy:
        heartbeat_interval_sec: 0.5
```

```yaml
- task_name: next-frame
  wait_for:
    event:
      topic: ws.msg
      event_type: ws_payload
    timeout_sec: 120
  output:
    as: frame
```

:::note Handle both shapes
With `parse_json: true` (the default), a frame that is not valid JSON is relayed as a plain string
rather than failing. A `wait_for` consumer that assumes a dict will break on a server's
`"pong"` keepalive — guard with `{{ isinstance(frame['data'], dict) }}` or set `parse_json: false` and
parse it yourself.
:::

:::caution Start it asynchronously
Without `options.async_mode: true` (or a parallel `tasks` container) this activity blocks the workflow for a full day.
:::

:::caution A closed connection looks like success
A server-side close or an exception in the subscriber ends the activity **successfully** with
`stopped: true`, and `max_attempts: 1` means no retry. Detect a dead feed through a `wait_for`
timeout rather than an activity failure.
:::

:::caution At-most-once delivery
Frames pushed while the connection is down are never replayed. On the Temporal runtime each relayed
frame is also a workflow signal and a history entry, with at most 1000 unmatched events retained
per topic — so this suits low-rate feeds, not a full market data firehose.
:::
