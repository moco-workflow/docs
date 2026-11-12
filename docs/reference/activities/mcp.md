---
sidebar_label: MCP
---

# MCP Activities

Two activities talk to a remote [Model Context Protocol](https://modelcontextprotocol.io) server.
`mcp.call_tool` invokes a tool and returns its result; progress notifications the tool emits along
the way are relayed into the workflow as events, so a long tool call can be followed while it runs.
`mcp.list_tools` returns the tools the server exposes, with hashes that make a changed tool easy to
spot.

This is the outbound direction — a moco workflow calling someone else's MCP tool. Moco also
*serves* MCP (`moco-server` exposes `execute_workflow` as a tool); that is a separate thing, covered
in [Running workflows through the API](../../guides/run-moco-workflow-through-api.md).

## Setup

No configuration. For a bearer token, fetch it with
[`builtin.secret.get`](./secret.md#builtinsecretget), which returns it **still encrypted**, and pass
the blob to `encrypted_auth_token`: the activity decrypts it internally and sends
`Authorization: Bearer <token>`, so the plaintext never enters workflow context. This works the
same for a static API key stored as a secret and for a token a workflow obtained at run time and
stored the same way. See [Authentication](#authentication) below.

:::caution Tokens in `headers` are visible
Anything you put in `headers` passes through workflow context and history in plaintext. Use
`encrypted_auth_token` for bearer credentials.
:::

Only the **streamable-http** transport is supported; stdio servers cannot be reached. The worker
needs the `mcp` package.

## Defaults

`mcp.call_tool`: 86400 s (1 day) timeout, 1 attempt, heartbeating every 20 s against a 60 s
timeout. The activity ends when the tool call completes, so the one-day timeout is a ceiling rather
than a duration.

`mcp.list_tools`: 60 s timeout, 3 attempts, no heartbeat. Listing is read-only, so a retry is
safe.

---

## `mcp.call_tool`

Opens a session, initializes it, calls one tool, and returns the result. Each
`notifications/progress` message the tool sends is relayed as a workflow event.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `endpoint` | str | yes | — | Streamable-http MCP endpoint URL |
| `tool_name` | str | yes | — | Name of the tool to call |
| `arguments` | dict | no | `null` | Arguments passed to the tool |
| `headers` | dict[str, str] | no | `null` | HTTP headers for the connection |
| `encrypted_auth_token` | [EncryptedData](./http.md#encrypteddata) | no | `null` | Encrypted bearer token, decrypted inside the activity and sent as `Authorization: Bearer <token>`; overrides an `Authorization` key in `headers` |
| `relay_topic` | str | no | `"default"` | Event topic progress is relayed on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |
| `result` | object \| null | The MCP `CallToolResult` as JSON, or `null` if the call did not produce one |

**Relayed event data**

Each event's `data` is a progress notification from the tool.

**Examples**

Called synchronously, for the result only — the common case:

```yaml
- task_name: run-remote-tool
  activity:
    type: mcp.call_tool
    input:
      endpoint: "https://tools.example.com/mcp"
      tool_name: "summarize_document"
      arguments:
        document_id: "{{ doc_id }}"
      encrypted_auth_token: "{{ mcp_token }}"    # output of builtin.secret.get
    options:
      retry_policy:
        timeout_sec: 600
  output:
    as: tool_run     # -> stopped, result

- task_name: check-result
  raise:
    if: "{{ tool_run['result'] is None }}"
    type: error
    message: "MCP tool call produced no result"
```

Started asynchronously so the workflow can react to progress:

```yaml
- task_name: start-tool-call
  activity:
    type: mcp.call_tool
    input:
      endpoint: "{{ endpoint }}"
      tool_name: "{{ tool_name }}"
      arguments:
        count: "{{ max_count }}"
      relay_topic: mcp.msg
      relay_event_type: mcp_progress
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    options:
      async_mode: true
      retry_policy:
        heartbeat_interval_sec: 0.5
  output:
    as: call_token
```

---

## `mcp.list_tools`

Opens a session, initializes it, and lists every tool the server exposes, following pagination.
Use it to discover what a server offers, or to check on a schedule that a server's tools have not
changed since you last reviewed them.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `endpoint` | str | yes | — | Streamable-http MCP endpoint URL |
| `headers` | dict[str, str] | no | `null` | HTTP headers for the connection |
| `encrypted_auth_token` | [EncryptedData](./http.md#encrypteddata) | no | `null` | Encrypted bearer token, as for `mcp.call_tool` |
| `include` | list[str] | no | `null` (all) | Return only the tools with these names; names the server lacks are ignored |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `server` | object | `name`, `version` and `protocol_version` the server reported at initialization |
| `tools` | list | One entry per tool, sorted by `name`: `name`, `title`, `description`, `input_schema`, `output_schema`, `annotations`, `hash` |
| `hash` | str | Hash of the whole listing (every returned tool's name and `hash`) |

A tool's `hash` is a SHA-256 over its `name`, `description`, `input_schema` and `output_schema`,
independent of key order. It changes when any of those change and is unaffected by `title` and
`annotations`. The top-level `hash` also changes when a tool is added or removed. With `include`,
both cover only the returned tools.

The description is part of the hash on purpose: it is text a model reads, so a server that quietly
changes it can change what an agent does. Store the hashes you reviewed and treat a mismatch as
something to look at, not something to accept automatically.

**Example**

```yaml
- task_name: list-remote-tools
  activity:
    type: mcp.list_tools
    input:
      endpoint: "https://tools.example.com/mcp"
      encrypted_auth_token: "{{ mcp_token }}"    # output of builtin.secret.get
      include: ["search", "get_issue"]
  output:
    as: listing     # -> server, tools, hash

- task_name: check-drift
  raise:
    if: "{{ listing['hash'] != reviewed_hash }}"
    type: error
    message: "MCP tools changed since review: {{ [t['name'] for t in listing['tools']] }}"
```

:::note Errors raise
Unlike `mcp.call_tool`, a connection or protocol failure fails the activity. An empty `tools` list
always means the server has no (matching) tools, never that it could not be reached.
:::

## Authentication

Both activities authenticate the same way. The example uses `mcp.call_tool`.

```yaml
- task_name: get-token
  activity:
    type: builtin.secret.get
    input:
      secret_name: TOOLS_MCP_TOKEN
  output:
    as: mcp_token

- task_name: run-remote-tool
  activity:
    type: mcp.call_tool
    input:
      endpoint: "https://tools.example.com/mcp"
      tool_name: "summarize_document"
      arguments:
        document_id: "{{ doc_id }}"
      encrypted_auth_token: "{{ mcp_token }}"
  output:
    as: tool_run
```

`builtin.secret.get` returns a copy that expires (60 s by default), so fetch it right before the
call. A server that wants its key in some other header (`X-API-Key`) still needs `headers`, with
the plaintext caveat above.

:::caution A failed tool call is not an activity failure
For `mcp.call_tool`, an exception inside the streamer is logged and swallowed: the activity returns `stopped: true` with
`result: null`. Always check `result` explicitly rather than assuming a successful activity means a
successful tool call.
:::

:::note Async mode is only for progress
With `options.async_mode: true` the workflow continues while the tool runs, and the task's result
is only a token string. The activity's own output (`stopped`, `result`) is published later as an
event on `options.async_event_topic` (default `default`) whose `event_type` is that token — collect
it with `wait_for` if you need it. Run the call synchronously when you just want the answer.
:::

:::caution At-most-once progress
Progress pushed while the connection is down is not replayed, and with `max_attempts: 1` there is
no retry. Treat progress events as advisory, never as the record of what happened.
:::
