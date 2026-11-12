---
sidebar_label: Running Workflows Through the API
sidebar_position: 6
---

# Running Workflows Through the API

The Moco service exposes the same workflow operations through two transports:

- a **REST / OpenAPI** surface under `/api`, for ordinary application code
- an **MCP** endpoint at `/mcp`, for AI agents and for the `moco` CLI

Both are served by the same process, authenticate the same way, and are backed by the same engine.
Which you reach for depends on the caller: a service integration wants REST, an LLM agent wants MCP.

For the conceptual model behind the `options` field used throughout this guide — execute modes,
entity workflows, retry policies — see [How Workflows Run](../concepts/how-to-run-workflow.md).

---

## Authentication

Every endpoint requires an `Authorization` header. Two credential types are accepted:

```http
Authorization: Bearer <oauth2-jwt>
Authorization: ApiKey <moco-api-key>
```

API keys may also be sent as `Bearer <moco-api-key>` — the server recognizes the key format
regardless of scheme, which matters because the MCP transport only accepts `Bearer`.

Create an API key with the CLI:

```bash
moco apikey create my-service --expires-in 90d
```

A request with a missing, malformed, or expired credential gets `401` with a `WWW-Authenticate:
Bearer` header. On a deployment with `MOCO_AUTH_ENABLED` turned off, every request runs as the
`admin` user (or `MOCO_AUTH_DISABLED_USER_ID`) whatever credential it carries; only run that way
on a machine nobody else can reach.

---

## OpenAPI

The service publishes its own schema and interactive documentation:

| Path | Contents |
|------|----------|
| `/api/openapi.json` | OpenAPI 3 schema — feed this to your client generator |
| `/api/docs` | Swagger UI |
| `/api/redoc` | ReDoc |

Generating a client from `/api/openapi.json` is the recommended integration path; the tables below
describe the endpoints you will get.

### Workflow endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflow/execute` | Run a workflow and wait for the result |
| `POST` | `/api/workflow/start` | Start a workflow, return its `workflow_id` |
| `POST` | `/api/workflow/cancel` | Cancel gracefully (the workflow can run cleanup) |
| `POST` | `/api/workflow/terminate` | Terminate forcefully (no cleanup) |
| `GET` | `/api/workflow/status/{workflow_id}` | Current status and result or error |
| `GET` | `/api/workflow/history/{workflow_id}` | Chronological execution history |
| `GET` | `/api/workflow/executions?wfspec_name=…` | List runs for a wfspec |

### Executing a deployed workflow

```bash
curl -X POST https://www.my-moco.com/api/workflow/execute \
  -H "Authorization: ApiKey $MOCO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "wfspec_info": { "name": "hello-moco", "version": "1.0.0" },
    "input_data": { "owner": "python", "repo": "cpython" },
    "options": { "tier": "prod" }
  }'
```

The response body is the workflow's result — what its `output` evaluated to — encoded as JSON.

`wfspec_info` identifies the workflow three ways:

| Field | Meaning |
|-------|---------|
| `name` | A deployed wfspec name, resolved through the deployment for the caller and tier |
| `version` | Optional. Omit it to take the version the stage resolves to |
| `content` | The wfspec YAML itself, as a string — or an array of strings for a multi-file bundle |

### Executing an undeployed spec

Pass the YAML directly in `content`. Nothing needs to be published, which is how the CLI runs local
files and how dynamically generated workflows are executed:

```bash
curl -X POST https://www.my-moco.com/api/workflow/execute \
  -H "Authorization: ApiKey $MOCO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "wfspec_info": {
      "content": "header:\n  schema_version: 2.0.0\n  workflow_name: adhoc\noutput: \"{{ answer }}\"\nmain:\n  set:\n    - answer: \"{{ 6 * 7 }}\"\n"
    }
  }'
```

For a bundle, pass `content` as an array — the first element is the entry point and the rest are
child workflows it may reference by `ref`, using their `workflow_name`.

### Starting and managing a long run

```bash
# start
curl -X POST https://www.my-moco.com/api/workflow/start \
  -H "Authorization: ApiKey $MOCO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wfspec_info": {"name": "order-monitor"}, "input_data": {"order_id": "ORD-1"}}'
# -> {"workflow_id": "order-monitor:1.0.0:alice:6f1c…", "status": "started"}

# poll
curl -H "Authorization: ApiKey $MOCO_API_KEY" \
  "https://www.my-moco.com/api/workflow/status/order-monitor:1.0.0:alice:6f1c…"

# stop
curl -X POST https://www.my-moco.com/api/workflow/cancel \
  -H "Authorization: ApiKey $MOCO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "order-monitor:1.0.0:alice:6f1c…"}'
```

A generated ID has the form `{workflow_name}:{version}:{user_id}:{trace_id}`, where `version` is
the package version, so a run is identifiable at a glance. Supply your own `workflow_id` in `options` when you need a specific
address — see [entity workflows](#entity_workflow_args).

`status` reports `running`, `completed`, `failed`, `cancelled`, `terminated`, or `unknown`, along
with `start_time`, `close_time`, and the result or error.

These four operations need a durable handle, so they are unavailable under
`execute_mode: "in-memory"` — that combination returns `400` rather than failing silently.

### Activity endpoints

The same shape exists for running a single activity outside any workflow — useful for smoke-testing
an integration or reusing Moco's connectors without authoring a spec:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/activity/execute` | Run one activity and wait |
| `POST` | `/api/activity/start` | Start one activity, return its `activity_id` |
| `GET` | `/api/activity/result/{activity_id}` | Status and `output_data` |
| `POST` | `/api/activity/cancel` | Cancel gracefully |
| `POST` | `/api/activity/terminate` | Terminate forcefully |

```bash
curl -X POST https://www.my-moco.com/api/activity/execute \
  -H "Authorization: ApiKey $MOCO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "activity_type": "http.request",
    "input_data": { "method": "GET", "url": "https://api.github.com" },
    "options": { "execute_mode": "in-memory" }
  }'
```

### Error responses

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Invalid request — an unrecognized `execute_mode`, or an async operation on a runtime that cannot support it |
| `401` | Missing, malformed, expired, or revoked credential |
| `500` | Execution failed. The body carries the error detail |

A workflow that stops early with `raise` `type: terminate` is a successful HTTP call — the
`terminate_message` is reported in the result, not the status code.

---

## MCP

The MCP endpoint is mounted at `/mcp` and speaks streamable HTTP. It exists so that AI agents can
run Moco workflows as tools, and it is what the `moco` CLI itself uses.

Authenticate with the same credentials, always using the `Bearer` scheme:

```
https://www.my-moco.com/mcp
Authorization: Bearer <token-or-api-key>
```

### Tools

| Tool | Arguments | Purpose |
|------|-----------|---------|
| `execute_workflow` | `wfspec_info`, `input_data`, `options` | Run synchronously, return the result |
| `start_workflow` | `wfspec_info`, `input_data`, `options` | Start, return `workflow_id` |
| `cancel_workflow` | `workflow_id` | Cancel gracefully |
| `terminate_workflow` | `workflow_id`, `reason` | Terminate forcefully |
| `get_workflow_status` | `workflow_id` | Status, times, result or error |
| `get_workflow_history` | `workflow_id` | Chronological event list |
| `list_executions` | `wfspec_name`, `wfspec_version`, `max_results` | Runs for a wfspec |
| `execute_activity` | `activity_type`, `input_data`, `config_data`, `options` | Run one activity |
| `start_activity` | `activity_type`, `input_data`, `config_data`, `options` | Start one activity |
| `get_activity_result` | `activity_id` | Activity status and output |
| `cancel_activity` / `terminate_activity` | `activity_id` | Stop an activity |

Arguments mirror the REST bodies exactly. Every tool returns a JSON string with a `success` flag —
failures come back as `{"success": false, "error": …, "error_type": …}` rather than as a protocol
error, so an agent can read and reason about them.

### Streaming progress

`execute_workflow` is the one tool that streams. While the workflow runs, it reports MCP **progress
notifications**, each carrying a serialized debug event: task boundaries, activity dispatches,
and the value of any variable marked with the `#` modifier. This is what produces the live output
you see from `moco run`, and it lets an agent narrate a long workflow instead of blocking silently.

Streaming requires the server to have a debug event bus configured (`MOCO_RMQ_CONNECTION_URL`). When
it is absent the tool still works — it simply returns the final result with no intermediate
notifications.

### Registering Moco with an MCP client

```json
{
  "mcpServers": {
    "moco": {
      "type": "http",
      "url": "https://www.my-moco.com/mcp",
      "headers": { "Authorization": "Bearer ${MOCO_API_KEY}" }
    }
  }
}
```

An agent connected this way can discover your deployed workflows and call them as tools — which is
the point of publishing a workflow rather than keeping it in a file.

---

## execute_options

`options` is the third argument of every execute/start call, on both transports. It configures *how*
the run is dispatched, never *what* it does — the workflow's own inputs go in `input_data`.

| Option | Type | Purpose |
|--------|------|---------|
| `execute_mode` | `"workflow"` \| `"standalone-activity"` \| `"in-memory"` | How the run is dispatched. Default `"workflow"` |
| `tier` | string | Execution stage — `dev`, `beta`, `prod`. Selects which deployed version a name resolves to |
| `workflow_id` | string | Caller-supplied ID. Generated when omitted; required for entity workflows |
| `trace_id` | string | Correlation ID shared by the run and all its children. Generated when omitted |
| `debug_mode` | bool | Emit debug events, including `#`-marked variables |
| `debug_info` | any | Arbitrary payload echoed into debug events |
| `enable_otel_trace` | bool | Emit OpenTelemetry spans for the run |
| `catch_exception` | bool | Return the error as a result instead of failing the run |
| `retry_policy` | object | Timeout and retry configuration for the run |
| `entity_workflow_args` | object | Entity-workflow / signal-with-start configuration |

### execute_mode

```json
{ "options": { "execute_mode": "standalone-activity" } }
```

- `"workflow"` (default) — a durable Temporal workflow; every activity is dispatched and recorded
  separately, so the run survives worker restarts.
- `"standalone-activity"` — the whole wfspec runs as a single Temporal activity. Durable at the top
  level only, but it avoids per-step marshalling and the activity payload size limit, so it suits
  large-data and CPU-bound workflows.
- `"in-memory"` — runs in the server process with no Temporal involvement. Lowest latency, no
  durability, and no `start` / `cancel` / `terminate` / `status`.

The trade-offs are covered in [How Workflows Run](../concepts/how-to-run-workflow.md).

### retry_policy

```json
{
  "options": {
    "retry_policy": {
      "timeout_sec": 600,
      "max_attempts": 3,
      "initial_interval_sec": 1,
      "backoff_coefficient": 2.0,
      "maximum_interval_sec": 60,
      "non_retryable_error_types": ["ValidationError"]
    }
  }
}
```

For a workflow run, `timeout_sec` is the overall run timeout — 24 hours when unset. Workflows
default to a **single attempt**: Moco does not retry a whole workflow unless you ask it to, because
activity-level retries are usually what you want. Only the Temporal runtime honors these settings;
the in-memory runtime ignores them.

Values here are plain JSON numbers: the API does not evaluate `{{ }}` expressions in run options.
To compute a policy from the run's data, write it in the spec instead — see
[Computed retry policies](../reference/workflowspec-reference.md#computed-retry-policies).

Under `execute_mode: "standalone-activity"` the same object also carries `heartbeat_timeout_sec` and
`heartbeat_interval_sec`, which default to 60 s and 20 s so Temporal can detect a dead worker.

### entity_workflow_args

Addresses a long-lived workflow instance by ID, starting it if it is not already running and
delivering an event either way:

```json
{
  "options": {
    "workflow_id": "order-entity:ORD-001",
    "entity_workflow_args": {
      "is_entity_workflow": true,
      "signal_name": "order_events",
      "signal_input": {
        "event_type": "add_item",
        "data": { "sku": "WIDGET-A", "price": 10 }
      }
    }
  }
}
```

`workflow_id` must be set explicitly — it is the entity's address. `signal_name` is the topic the
workflow's state machine listens on, and `signal_input` is the event delivered atomically with the
start. See [How Workflows Run](../concepts/how-to-run-workflow.md#entity-workflows).

### trace_id and workflow_id

Both are generated if you omit them. Supply them when you need to correlate a Moco run with a
request in your own system:

- `trace_id` is shared by the workflow and every child it spawns — the key to use when searching
  logs or traces for one logical operation.
- `workflow_id` is unique per instance and is the handle for `status`, `cancel`, and `terminate`.
  Supplying a deterministic one also gives you idempotency: starting twice with the same ID is
  rejected by Temporal unless the run is an entity workflow.

---

## Next steps

- [How Workflows Run](../concepts/how-to-run-workflow.md) — execute modes in depth
- [Using the Moco CLI](./use-moco-cli.md) — the same operations from a terminal
- [Activity Catalog](../reference/activity-catalog.md) — activity types for `/api/activity/execute`
