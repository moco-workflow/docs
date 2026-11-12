---
sidebar_position: 5
---

# Activity System

Activities are external functions or services that workflows can execute. They enable workflows to interact with databases, APIs, message queues, and other systems.

## What are Activities?

An **activity** is:
- A reusable piece of logic
- Executed outside the workflow logic
- Potentially long-running or unreliable
- Subject to retries and timeouts
- Isolated from workflow state

Activities allow you to:
- Make HTTP requests
- Query databases
- Send emails or SMS
- Process files
- Call external APIs
- Perform complex calculations
- Integrate with third-party services

## Calling an activity

An `activity` task names the activity type, gives it an `input`, and optionally sets `options`. Its
`output` decides what to keep from the result:

```yaml
- task_name: fetch-user                  # names the task in traces; needed to mock it in tests
  activity:
    type: http.request                   # activity type identifier
    input:                               # evaluated each time the task runs
      method: GET
      url: 'https://api.example.com/users/{{ user_id }}'
      output_json: true
    options:
      retry_policy:                      # timeout and retry (Temporal runtime only)
        timeout_sec: 30                  # per-attempt execution timeout
        max_attempts: 3                  # total attempts (initial + retries)
  output:
    data: '{{ _["json"] }}'              # `_` is the activity's output
    as: user
```

### Activity fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | **Required.** Activity type identifier, e.g. `http.request` |
| `input` | mapping | The activity's input, evaluated each time the task runs. Its fields are the activity's input contract in the [Activity Catalog](../reference/activity-catalog.md) |
| `options.retry_policy` | mapping | Timeout and retry policy, laid over the workflow's default. See [Retry and Timeout](#retry-and-timeout) |
| `options.execute_locally` | bool | Run in the workflow's process instead of on a worker. Overrides the activity's own default. See [Local Execution](#local-execution) |
| `options.enable_cache` | bool | Reuse a stored result for identical input. See [Caching](#caching) |
| `options.cache_policy` | mapping | `expire_in_seconds`, `disable` |
| `options.async_mode` | bool | Start the activity and continue without waiting. See [`async_mode`](#fire-and-forget-async_mode) |
| `options.async_event_topic` | string | Topic the completion event is published to in `async_mode` (default: `default`) |

Like every task, an activity task also takes the shared keys: `task_name`, `skip_if` (skip it when a
condition is true), `output` and `on_error`. See
[Workflowspec Structure](./workflowspec.md#tasks).

## Built-in Activities

Moco ships 183 activities across 20 providers — HTTP, shell, SQL, email, Kafka, RabbitMQ, Google
Drive, Kubernetes, browser automation, LLM and RAG activities, and the platform's own state,
secret and deployment activities. The [Activity Catalog](../reference/activity-catalog.md) indexes every one
of them, and each provider has a reference page giving the input and output contract of its
activities with worked examples.

A few you will reach for constantly:

### HTTP Request

Make HTTP requests to external APIs — see [HTTP Activities](../reference/activities/http.md):

```yaml
# GET request
- task_name: list-data
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.example.com/data?limit=10&offset=0
      headers:
        Accept: application/json
      output_json: true
    options:
      retry_policy:
        timeout_sec: 30
  output:
    as: api_response           # {status_code, is_success, headers, json}
```

```yaml
# POST request with JSON body
- task_name: create-order
  activity:
    type: http.request
    input:
      method: POST
      url: https://api.example.com/orders
      json_data:
        order_id: '{{ order_id }}'
        items: '{{ items }}'
        total: '{{ total }}'
      raise_for_status: true   # fail the task on a 4xx/5xx response
  output:
    as: create_response
```

### Delay

Pause workflow execution — see [Built-in Core](../reference/activities/builtin-core.md):

```yaml
- activity:
    type: builtin.delay
    input:
      duration: 5s      # seconds: 5s, minutes: 5min, hours: 1h30m
```

### State Persistence

Store and retrieve values that outlive a single run — see
[State Store](../reference/activities/state.md):

```yaml
# Save state
- task_name: save-preferences
  activity:
    type: builtin.state.set_state
    input:
      namespace: user-preferences
      key: '{{ user_id }}'
      value:
        theme: dark
        notifications: true

# Load state
- task_name: load-preferences
  activity:
    type: builtin.state.get_state
    input:
      namespace: user-preferences
      key: '{{ user_id }}'
  output:
    as: preferences
```

### Secret Management

Access secrets securely. Plaintext secrets never travel between activities.

Most activities that need a secret take a **secret key** instead of the secret itself — for
example `openai.chat.completions.apikey_secret_key`, `email.send.password_secret_key` or
`sql.query.connection_string_secret_key`. The activity looks the secret up and decrypts it
internally, so nothing sensitive touches workflow context at all. A bare `NAME` resolves a
user-scoped secret; `global/NAME` resolves a global one.

```yaml
- task_name: load-order
  activity:
    type: sql.query
    input:
      connection_string_secret_key: ANALYTICS_DB      # a secret name, not the secret
      query: SELECT * FROM orders WHERE id = :order_id
      parameters:
        order_id: '{{ order_id }}'
  output:
    as: rows
```

Where an activity does not yet support that (for example `http.request.encrypted_auth_token`), use
`builtin.secret.get`, which returns the secret **still encrypted** — pass that value straight to the
activity, which decrypts it internally.

```yaml
- task_name: get-token
  activity:
    type: builtin.secret.get
    input:
      secret_name: api_token
      in_global_ns: false      # optional; true reads the shared global namespace
      expiration_seconds: 60   # optional; defaults to 60
  output:
    as: api_token

- task_name: call-api
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.example.com/me
      encrypted_auth_token: '{{ api_token }}'
```

The returned secret **expires after `expiration_seconds`**, so a long-running workflow must re-run
`builtin.secret.get` rather than holding the result. The full list of secret-bearing fields, the
encryption model and the reserved-namespace rules are in
[Secret Activities](../reference/activities/secret.md).

### AI and retrieval

`openai.chat.completions` runs a single prompt-and-response; `claude_agent.query` runs an
autonomous multi-turn agent with explicitly granted tools; the `llama_index.*` activities build and
query a vector index over your own documents so an LLM can answer from them. See
[OpenAI](../reference/activities/openai.md),
[Claude Agent](../reference/activities/claude-agent.md) and
[LlamaIndex](../reference/activities/llama-index.md).

### Files, messaging and browsers

`gdrive.*` reads and writes Google Drive files; `kafka.*`, `rabbit.*`, `graphql.subscribe` and
`websocket.subscribe` connect a workflow to message buses and live feeds; `playwright.*` and
`selenium.*` drive a real browser. See
[Google Drive](../reference/activities/gdrive.md),
[Kafka](../reference/activities/kafka.md), [RabbitMQ](../reference/activities/rabbit.md) and
[Playwright](../reference/activities/playwright.md).

## Input

`input` is evaluated every time the task runs, so expressions in it see the current values — a
different item on each loop iteration, for example:

```yaml
- task_name: fetch-each-user
  loop:
    in: '{{ user_ids }}'
    foreach: user_id
    do:
      task_name: fetch-user
      activity:
        type: http.request
        input:
          method: GET
          url: 'https://api.example.com/users/{{ user_id }}'   # different each iteration
          output_json: true
      output:
        data: '{{ _["json"] }}'
  output:
    as: users                  # one result per user, in order
```

Values that never change go in `input` too, written as plain values. Credentials never do: pass a
secret key, as in [Secret Management](#secret-management).

## Shaping the result

Inside the task's `output`, `_` is the activity's output. Keep only what later tasks need:

```yaml
- task_name: list-users
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.example.com/users
      output_json: true
  output:
    set:
      - _users: '{{ _["json"] }}'                       # task-local
      - user_count: '{{ len(_users) }}'                 # written to the context
    data:
      users: '{{ _users }}'
      first_user: '{{ _users[0] if _users else None }}'
    as: result                                          # {users: [...], first_user: {...}}
```

`output.set` writes individual variables, `output.data` builds the task's result, and `output.as`
stores that result. Without `output`, the activity's output is the task's result but is not stored
anywhere. See [Workflowspec Structure](./workflowspec.md#a-tasks-result-_-and-output).

## Retry and Timeout

An activity's effective retry policy is the workflow's default,
`header.metadata.default_activity_retry_policy`, with the activity's own `options.retry_policy`
laid over it field by field:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: resilient-fetch
  metadata:
    default_activity_retry_policy:     # every activity starts from this
      max_attempts: 3
      initial_interval_sec: 1
      timeout_sec: 60

main:
  task_name: fetch-data
  activity:
    type: http.request
    input:
      method: GET
      url: https://unreliable-api.example.com/data
      raise_for_status: true
    options:
      retry_policy:                    # overrides max_attempts and timeout_sec;
        max_attempts: 5                # initial_interval_sec is inherited
        timeout_sec: 10
  output:
    as: result
```

| Field | Description |
|---|---|
| `timeout_sec` | Per-attempt execution timeout |
| `schedule_to_close_timeout_sec` | Overall limit across all attempts, including waiting in the queue |
| `heartbeat_timeout_sec` | Fail an attempt that stops heartbeating for this long |
| `heartbeat_interval_sec` | Heartbeat cadence. Heartbeating is enabled only when both heartbeat fields are set |
| `max_attempts` | Total attempts (initial + retries). `0` means unlimited |
| `initial_interval_sec` | Wait before the first retry |
| `backoff_coefficient` | Multiplier applied to the wait after each retry |
| `maximum_interval_sec` | Upper bound on the wait between retries |
| `non_retryable_error_types` | Error types that fail immediately, without retrying |

Every field except `non_retryable_error_types` may also be an expression that evaluates to a
number. It is evaluated each time the task runs, in the task's scope, so a policy can follow the
input, the environment, or the item a loop is on:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: sized-uploads
  metadata:
    default_activity_retry_policy:
      max_attempts: '{{ 3 if environment == "prod" else 1 }}'   # fail fast outside prod
      timeout_sec: 60

input:
  environment: prod
  files: [{name: a.csv, size_mb: 1}, {name: b.csv, size_mb: 40}]

main:
  task_name: upload-files
  loop:
    in: '{{ files }}'
    foreach: file
    do:
      activity:
        type: http.request
        input:
          method: PUT
          url: 'https://storage.example.com/{{ file["name"] }}'
        options:
          retry_policy:
            timeout_sec: '{{ 10 + file["size_mb"] * 3 }}'      # bigger file, longer timeout
```

The header default is evaluated in the scope of each activity that uses it, so keep it to names
every activity can see, such as inputs and context variables. See
[Computed retry policies](../reference/workflowspec-reference.md#computed-retry-policies).

Retry behavior:
- Initial attempt + retries = total attempts
- Exponential backoff between retries
- Only the final failure reaches the workflow, where `on_error` can handle it
- Retry policies apply on the Temporal runtime only; the in-memory runtime makes one attempt (see
  [Runtimes](./dual-runtime.md))

## Handling failure

When an activity fails after its retries, the task fails. Handle it with `on_error`; inside `do`,
`_` is the error, `{error_type, error_message, error_detail}`:

```yaml
- task_name: fetch-rates
  activity:
    type: http.request
    input:
      method: GET
      url: https://rates.example.com/latest
      output_json: true
      raise_for_status: true
  output:
    data: '{{ _["json"] }}'
    as: rates
  on_error:
    catch: true                        # consume the error; the task's `output` is skipped
    do:
      set:
        - rates: '{{ fallback_rates }}'
        - rates_error#: '{{ _["error_message"] }}'
```

With `catch: false` (the default), `do` runs as a cleanup step and the error keeps propagating to
the parent task. An activity that reports failure in its output rather than failing — an HTTP 4xx
without `raise_for_status`, a shell command's non-zero `return_code` — does not reach `on_error`.
Check the output and `raise` yourself:

```yaml
- task_name: run-report
  activity:
    type: shell.run
    input:
      command: ./build-report.sh
  output:
    as: report

- task_name: check-report
  raise:
    if: '{{ report["return_code"] != 0 }}'
    type: error
    error_type: ReportFailed
    message: 'report failed: {{ report["stderr"] }}'
```

## Caching

Enable caching to avoid redundant executions:

```yaml
- task_name: load-reference-data
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.example.com/reference-data
      output_json: true
    options:
      enable_cache: true
      cache_policy:
        expire_in_seconds: 3600       # reuse the result for 1 hour
  output:
    as: reference_data
```

The cache key is the activity type together with its evaluated input, stored per user, so a call
with the same input reuses the stored result and a call with different input runs the activity.
Without `expire_in_seconds` a cached result does not expire. Setting `cache_policy` alone also
enables caching; `enable_cache: false` or `cache_policy.disable: true` turns it off. State
activities (`builtin.state.*`) and `async_mode` activities are never cached.

**Cache benefits:**
- Reduce API calls
- Improve performance
- Lower costs
- Consistent data within the expiry window

## Local Execution

Force activities to run in the workflow process (bypass Temporal workers):

```yaml
- activity:
    type: builtin.delay
    input:
      duration: 1s
    options:
      execute_locally: true    # run in the workflow process
```

**Use for:**
- Very fast operations (< 1ms)
- Operations that don't benefit from retries
- Reducing worker overhead
- Testing/debugging

**Caution:** Local activities:
- Don't get automatic retries
- Run in workflow process (blocking)
- Can impact workflow performance

### Activities that are already local by default

Some activities set `execute_locally` for you, so you don't have to write it. Short built-ins
like `builtin.now` and `builtin.delay` do it because a queue round trip would cost more than
the work itself.

**All browser automation activities — every `selenium.*` and `playwright.*` type — default to
local execution**, and for a different reason: they need to stay on the same worker as the
workflow.

A browser session belongs to the process that opened it. The `session_id` you get back from
`browser.create` is only meaningful there, so if `nav.goto` or `element.click` ran somewhere
else, they would not find the browser. Running these activities locally keeps a whole
session — from `browser.create` to `browser.close` — on one worker, so a multi-step browser
script works the way you'd expect.

**Don't set `execute_locally: false` on a browser activity.** The workflow will still validate
and start, but the session will no longer be pinned to one worker and any step after
`browser.create` can fail with an unknown session. See
[Playwright](../reference/activities/playwright.md) and
[Selenium](../reference/activities/selenium.md) for the full session model.

Conversely, an activity served by a *different* worker type can never run locally.
[`claude_agent.query`](../reference/activities/claude-agent.md) is the only one today: it runs on
the `agent` worker, so `execute_locally` has no effect on it.

## Fire-and-forget: `async_mode`

By default a workflow waits for each activity to finish. Set `async_mode: true` and it starts the
activity and moves on:

```yaml
- task_name: slow-report
  activity:
    type: shell.run
    input:
      command: ./build-report.sh
    options:
      async_mode: true
  output:
    as: report_token
```

The activity's output (`_`) is immediately a **token** string, not the result. Later — possibly
much later, possibly in a different branch — you collect the real result by waiting for an event
whose type is that token:

```yaml
- task_name: await-report
  wait_for:
    event:
      event_type: '{{ report_token }}'
    timeout_sec: 600
  output:
    as: report                 # the completion event, or null on timeout
```

The token is unique per invocation, so the same activity running in a loop or a re-entered state
never collides with itself. The event's `data` is the activity's output, and its metadata carries
`status` (`completed` or `failed`), `error`, and the activity name and run ID.

Point `async_event_topic` at a state machine's `event_source_topic` and the activity's completion
drives a transition directly — the usual way to let slow work advance an event-driven workflow.
When you set `async_event_topic`, wait on that `topic` too.

Waiting is optional: ignoring the token is plain fire-and-forget. Two caveats, though. A completion
event is consumed by the first matching waiter, and in-flight completions do not survive a
`checkpoint` that continues as new. And an activity still running when the workflow completes is
cancelled — for work that must outlive the workflow, use a detached child workflow instead.

## What if no built-in activity fits?

The [Activity Catalog](../reference/activity-catalog.md) covers most integration needs, and it is
worth checking before concluding it does not. In particular:

- `http.request` and `graphql.query` reach any HTTP or GraphQL service
- `shell.run` runs a command on the worker
- `sql.query` talks to any database with a connection string
- `mcp.*` calls tools on an MCP server

Between them, most "I need a custom activity" cases turn out to be an HTTP call. Wrapping that call
in a child workflow gives you a named, reusable unit that other workflows can compose —
usually a better answer than new platform code, because you can release it yourself.

When you genuinely need a new activity type in the platform — a new protocol, a native SDK, or
something that must run inside a worker — that is a change to Moco itself, not to a workflow. It is
documented for platform developers in `moco-core/docs/creating-activity-providers.md`.

## Activity Best Practices

### Give Every Call a Timeout

Set a workflow-wide default in `header.metadata.default_activity_retry_policy`, then override it
where an activity is unusually fast or slow:

```yaml
# Fast operations
- activity:
    type: builtin.delay
    input:
      duration: 1s
    options:
      retry_policy:
        timeout_sec: 2

# Slow operations
- activity:
    type: shell.run
    input:
      command: './process-large-file.sh {{ file }}'
    options:
      retry_policy:
        timeout_sec: 300      # 5 minutes
```

### Assume Activities Can Run Twice

With `max_attempts` above 1, a retried activity runs again — and a transient failure can happen
*after* the work succeeded but before the result got back. Prefer operations that tolerate that:

```yaml
# Safer: PUT is idempotent, the same call twice leaves the same state
- activity:
    type: http.request
    input:
      method: PUT
      url: 'https://api.example.com/orders/{{ order_id }}'
      json_data: '{{ order }}'
    options:
      retry_policy:
        max_attempts: 3

# Riskier: POST may create two orders. Send an idempotency key, or set max_attempts: 1
- activity:
    type: http.request
    input:
      method: POST
      url: https://api.example.com/orders
      headers:
        Idempotency-Key: '{{ order_id }}'
      json_data: '{{ order }}'
    options:
      retry_policy:
        max_attempts: 3
```

### Fail Loudly

Prefer an activity that fails (`raise_for_status: true` on `http.request`) over one that returns an
error you might forget to check. A failure is retried, and it is visible to `on_error`.

### Keep Only What You Need

Use `output` to store the fields later tasks read, not the whole response. Everything in the
context is carried for the rest of the run, into child workflow results and checkpoints.

## Next Steps

- [Activity Catalog](../reference/activity-catalog.md) — every activity, by provider
- [Tasks Reference](../reference/statements.md) — the `activity` task's full field list
- [State Machines](./state-machines.md)
- [Events](./events.md)
