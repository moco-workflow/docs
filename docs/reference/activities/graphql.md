---
sidebar_label: GraphQL
---

# GraphQL Activities

One activity, `graphql.subscribe`, opens a GraphQL **subscription** and feeds each payload the
server pushes into the running workflow as an event.

It speaks the `graphql-transport-ws` protocol, so it works with graphql-ws, Apollo Server v3+ and
Hasura. For one-off queries and mutations there is no GraphQL activity — post them with
[`http.request`](./http.md), which is all a GraphQL query over HTTP is.

## Setup

No configuration and no secret-store integration: authentication is whatever headers the server
expects, passed in `headers` on the WebSocket handshake.

:::caution Tokens in `headers` are visible
Unlike providers that take a `*_secret_key`, a token placed in `headers` passes through workflow
context and history in plaintext. Keep that in mind for long-lived credentials.
:::

The worker needs the `gql` package with WebSocket transport.

## Defaults

86400 s (1 day) timeout, 1 attempt, heartbeating every 20 s against a 60 s timeout.

---

## `graphql.subscribe`

Connects, starts the subscription, and relays every payload the server pushes as a workflow event
that `wait_for` receives. It runs until the activity is cancelled.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `endpoint` | str | yes | — | WebSocket endpoint, e.g. `wss://api.example.com/graphql` |
| `subscription` | str | yes | — | The GraphQL subscription document |
| `variables` | dict | no | `null` | Variables bound to the subscription |
| `headers` | dict[str, str] | no | `null` | Handshake headers, typically `Authorization` |
| `relay_topic` | str | no | `"default"` | Event topic the workflow listens on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |

The payloads themselves arrive as events, not in the output.

**Relayed event data**

Each event's `data` is the subscription payload as the server sent it — the object under the
subscription's root field.

**Example**

Adapted from the provider's integration test:

```yaml
- task_name: start-subscription
  activity:
    type: graphql.subscribe
    input:
      endpoint: "wss://api.example.com/graphql"
      subscription: |
        subscription OnPriceTick($symbol: String!) {
          priceTick(symbol: $symbol) { symbol price ts }
        }
      variables:
        symbol: "{{ symbol }}"
      headers:
        Authorization: "Bearer {{ api_token }}"
      relay_topic: graphql.msg
      relay_event_type: graphql_payload
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    options:
      async_mode: true
      retry_policy:
        heartbeat_interval_sec: 0.5
        heartbeat_timeout_sec: 5
```

```yaml
- task_name: next-tick
  wait_for:
    event:
      topic: graphql.msg
      event_type: graphql_payload
    timeout_sec: 300
  output:
    set:
      - price: "{{ _['data']['priceTick']['price'] }}"
```

:::caution Start it asynchronously
Without `options.async_mode: true` (or a parallel `tasks` container) this activity blocks the workflow for a full day.
Unlike [`rabbit.receive`](./rabbit.md#rabbitreceive), it does not default to async mode.
:::

:::caution A dropped connection looks like success
Errors inside the subscriber are logged and end the activity **successfully** with
`stopped: true` — a dead feed is not reported as a failure, and with `max_attempts: 1` there is no
retry. If the subscription must stay up, have the workflow notice the absence of events (a
`wait_for` timeout) rather than relying on the activity to fail.
:::

:::caution At-most-once delivery
Payloads pushed while the connection is down are never replayed. Do not use a GraphQL subscription
as the sole transport for events you cannot afford to miss.
:::

:::note Every payload costs workflow history
On the Temporal runtime each relayed payload is a workflow signal and a history entry, and the
engine retains at most 1000 unmatched events per topic.
:::
