---
sidebar_label: Activity Catalog
sidebar_position: 3
---

# Activity Catalog

An **activity** is a unit of work a workflow performs outside itself: an HTTP call, a database
query, a shell command, an LLM completion. Activities are grouped into **providers**, and an
activity's type is `<provider>.<name>` — `http.request`, `builtin.state.set_state`,
`llama_index.query`.

This page indexes every activity the platform ships. Each provider has its own reference page with
the input and output contract of each of its activities, and worked examples.

For what an activity *is* and how to write one into a workflow, see
[Activity System](../concepts/activities.md) and the
[`activity` task](./statements.md#activity).

## How to read this reference

Every activity is invoked the same way, as an `activity` task:

```yaml
- task_name: fetch-user
  activity:
    type: http.request            # the activity type
    input:                        # the activity's input fields, documented per page
      method: GET
      url: 'https://api.example.com/users/{{ user_id }}'
      output_json: true
    options:                      # optional: retry_policy, execute_locally, enable_cache, async_mode ...
      retry_policy:
        max_attempts: 5
  output:
    data: '{{ _["json"] }}'       # `_` is the activity's raw result
    as: user
```

The task-level keys — `options` (`retry_policy`, `execute_locally`, `enable_cache`, `async_mode`)
and the task's `output` (`set`, `data`, `as`) and `on_error` — are documented once in
[Activity System](../concepts/activities.md) rather than repeated on each page. The provider pages
cover only what is specific to an activity:

- **Description** — what it does and when to reach for it.
- **Input** — the fields of `activity.input`, with types, defaults and which are required.
- **Output** — the shape of the result, which the task sees as `_` in its `output`.
- **Examples** — real YAML, drawn from `moco-examples/` wherever an example exists.

## Conventions across providers

### Secrets are named, not inlined

A field ending `_secret_key` holds the **name of a secret**, never the secret itself:
`apikey_secret_key`, `connection_string_secret_key`, `password_secret_key`,
`auth.credentials_secret_key`. The activity resolves and decrypts it internally, so plaintext never
enters workflow context. A bare `NAME` resolves a user-scoped secret; `global/NAME` resolves a
global one. See [Secret Activities](./activities/secret.md).

Four exceptions are worth knowing:

- [`http.request`](./activities/http.md#authentication) and the [MCP activities](./activities/mcp.md#authentication)
  take `encrypted_auth_token` — the still-encrypted blob from `builtin.secret.get` — rather than a
  secret name, so the same field carries a static API key or a token obtained at run time.
- [`graphql.subscribe`](./activities/graphql.md) and [`websocket.subscribe`](./activities/websocket.md)
  authenticate with a plain `headers` dict, which passes through workflow context in plaintext.
- [`langfuse.*`](./activities/langfuse.md) takes raw credentials inline; prefer configuring them as
  environment variables on the worker.
- [`k8s.*`](./activities/k8s.md#setup) names its token and client key through `token_secret_key` and
  `client_key_secret_key` as usual, but also accepts an inline `ca_cert` — a CA certificate is public
  material, so routing it through the secret store buys nothing.

### Retry and timeout defaults

The platform default is **60 seconds and 3 attempts**. Activities whose work is not idempotent —
writes, sends, spend — ship `max_attempts: 1` instead, and the exceptions are called out on each
page. Override either per call with `options.retry_policy`.

Only the Temporal runtime honours retry, timeout and heartbeat settings; the in-memory runtime
ignores them.

### Long-running activities and the relay pattern

Six activities run for as long as their source keeps producing, and deliver what they receive as
**workflow events** rather than as a return value:

| Activity | Delivers |
| --- | --- |
| [`kafka.consume`](./activities/kafka.md#kafkaconsume) | Each Kafka message |
| [`rabbit.receive`](./activities/rabbit.md#rabbitreceive) | Each RabbitMQ message |
| [`graphql.subscribe`](./activities/graphql.md#graphqlsubscribe) | Each subscription payload |
| [`websocket.subscribe`](./activities/websocket.md#websocketsubscribe) | Each inbound frame |
| [`mcp.call_tool`](./activities/mcp.md#mcpcall_tool) | Each progress notification |
| [`claude_agent.query`](./activities/claude-agent.md#claude_agentquery) | Agent progress |

They all share the same three fields — `relay_topic`, `relay_event_type` and `target_workflow_id` —
and the workflow consumes what they publish with `wait_for`.

Two things follow. First, **start them asynchronously**: set `options.async_mode: true` or run them in a
parallel `tasks` container, or they block the workflow for their whole timeout, which is usually a day. Only
`rabbit.receive` defaults to async mode. Second, on the Temporal runtime **each relayed payload is a
workflow signal and a history entry**, and the engine retains at most 1000 unmatched events per
topic — so these suit low-rate control streams, not high-throughput data feeds.

[`k8s.wait`](./activities/k8s.md#k8swait) also runs long and heartbeats, but is not part of this
pattern: it polls until its condition holds and then returns normally, rather than relaying events.
Its result is the point, so it blocks by design.

### Where activities run

Every activity runs on the `base` worker (task queue `default`) except
[`claude_agent.query`](./activities/claude-agent.md), which runs on the `agent` worker (task queue
`agent`). Routing is automatic; nothing in the wfspec changes. An activity served by a
different worker type cannot run locally, so `execute_locally` has no effect on it.

Conversely, the browser activities ([Playwright](./activities/playwright.md),
[Selenium](./activities/selenium.md)) and the short built-ins `builtin.now` and `builtin.delay`
default to `execute_locally: true`. For the browser activities this is load-bearing — it pins a
browser session to one worker — and must not be overridden.

---

## Providers

| Provider | Activities | What it's for |
| --- | --- | --- |
| [Built-in Core](./activities/builtin-core.md) | 3 | Clock, delay, and running a workflow inside an activity |
| [State Store](./activities/state.md) | 8 | Durable key/value storage that outlives a run |
| [Secrets](./activities/secret.md) | 4 | The secret store behind every `*_secret_key` field |
| [Events & Metrics](./activities/event.md) | 2 | Debug events and metrics for observability |
| [Schedules](./activities/schedule.md) | 9 | Managing a workflow's recurring runs from a workflow |
| [HTTP](./activities/http.md) | 1 | Calling any HTTP service |
| [Shell](./activities/shell.md) | 1 | Running a command on the worker |
| [SQL](./activities/sql.md) | 2 | Parameterized queries and writes against PostgreSQL |
| [Email](./activities/email.md) | 1 | Sending mail over SMTP |
| [Google Drive](./activities/gdrive.md) | 6 | Reading and writing Drive files |
| [Kubernetes](./activities/k8s.md) | 8 | Applying, inspecting and operating cluster resources |
| [Kafka](./activities/kafka.md) | 2 | Publishing to and consuming from Kafka |
| [RabbitMQ](./activities/rabbit.md) | 2 | Publishing to and subscribing to RabbitMQ |
| [GraphQL](./activities/graphql.md) | 1 | GraphQL subscriptions |
| [WebSocket](./activities/websocket.md) | 1 | Generic WebSocket feeds |
| [MCP](./activities/mcp.md) | 2 | Listing and calling a remote MCP server's tools |
| [OpenAI](./activities/openai.md) | 1 | Chat completions against any OpenAI-compatible endpoint |
| [Claude Agent](./activities/claude-agent.md) | 1 | An autonomous agent loop with granted tools |
| [LlamaIndex](./activities/llama-index.md) | 7 | Building and querying a vector index — RAG |
| [Langfuse](./activities/langfuse.md) | 2 | Online and offline LLM evaluation |
| [TypeSafe](./activities/typesafe.md) | 1 | Typed yes/no, choice and score decisions (TypeSafe System One or Laya) |
| [Playwright](./activities/playwright.md) | 26 | Browser automation |
| [Selenium](./activities/selenium.md) | 23 | Browser automation via WebDriver |
| [Authorization](./activities/authz.md) | 4 | Evaluating authorization policy from a workflow |
| [Deployment & Admin](./activities/deploy.md) | 75 | The control plane: namespaces, packages, deployments, users, RBAC |

---

## All activity types

### Built-in core

| Activity | Description |
| --- | --- |
| [`builtin.now`](./activities/builtin-core.md#builtinnow) | Current timestamp on the worker |
| [`builtin.delay`](./activities/builtin-core.md#builtindelay) | Pause for a duration |
| [`builtin.execute_workflow`](./activities/builtin-core.md#builtinexecute_workflow) | Run a whole workflow in memory inside one activity |

### State store

| Activity | Description |
| --- | --- |
| [`builtin.state.set_state`](./activities/state.md#builtinstateset_state) | Write a value |
| [`builtin.state.get_state`](./activities/state.md#builtinstateget_state) | Read a value |
| [`builtin.state.get_state_with_ts`](./activities/state.md#builtinstateget_state_with_ts) | Read a value with its last-update time |
| [`builtin.state.del_state`](./activities/state.md#builtinstatedel_state) | Delete one entry |
| [`builtin.state.list_states`](./activities/state.md#builtinstatelist_states) | List keys in a namespace, filtered and paged |
| [`builtin.state.list_namespaces`](./activities/state.md#builtinstatelist_namespaces) | List namespaces holding data |
| [`builtin.state.update_topic`](./activities/state.md#builtinstateupdate_topic) | Retag an entry without rewriting it |
| [`builtin.state.delete_by_topic`](./activities/state.md#builtinstatedelete_by_topic) | Delete every entry matching a topic pattern |
| [`builtin.state.delete_namespace`](./activities/state.md#builtinstatedelete_namespace) | Delete every entry in a namespace |

### Secrets

| Activity | Description |
| --- | --- |
| [`builtin.secret.upload`](./activities/secret.md#builtinsecretupload) | Store an encrypted secret |
| [`builtin.secret.get`](./activities/secret.md#builtinsecretget) | Fetch a secret, still encrypted and short-lived |
| [`builtin.secret.list`](./activities/secret.md#builtinsecretlist) | List secret names |
| [`builtin.secret.delete`](./activities/secret.md#builtinsecretdelete) | Remove a secret |

### Schedules

| Activity | Description |
| --- | --- |
| [`builtin.schedule.create`](./activities/schedule.md#builtinschedulecreate) | Create a schedule, or replace one with the same name |
| [`builtin.schedule.update`](./activities/schedule.md#builtinscheduleupdate) | Replace a schedule's workflow, timing and input |
| [`builtin.schedule.describe`](./activities/schedule.md#builtinscheduledescribe) | A schedule's settings, next fires and recent runs |
| [`builtin.schedule.list`](./activities/schedule.md#builtinschedulelist) | List the schedules the caller may see |
| [`builtin.schedule.list_declared`](./activities/schedule.md#builtinschedulelist_declared) | The schedules a deployed workflow declares in its header |
| [`builtin.schedule.pause`](./activities/schedule.md#builtinschedulepause--builtinscheduleunpause) | Pause a schedule |
| [`builtin.schedule.unpause`](./activities/schedule.md#builtinschedulepause--builtinscheduleunpause) | Resume a paused schedule |
| [`builtin.schedule.trigger`](./activities/schedule.md#builtinscheduletrigger) | Run a schedule once now |
| [`builtin.schedule.delete`](./activities/schedule.md#builtinscheduledelete) | Delete a schedule |

### Events and metrics

| Activity | Description |
| --- | --- |
| [`builtin.event.emit_debug_event`](./activities/event.md#builtineventemit_debug_event) | Publish a debug event, streamed live to the client |
| [`builtin.event.emit_metric_event`](./activities/event.md#builtineventemit_metric_event) | Publish a metric to Kafka |

### HTTP, shell, SQL and email

| Activity | Description |
| --- | --- |
| [`http.request`](./activities/http.md#httprequest) | Make an HTTP request |
| [`shell.run`](./activities/shell.md#shellrun) | Execute a command on the worker |
| [`sql.query`](./activities/sql.md#sqlquery) | Run a SELECT and return the rows |
| [`sql.execute`](./activities/sql.md#sqlexecute) | Run a write or DDL statement |
| [`email.send`](./activities/email.md#emailsend) | Send an email over SMTP |

### Google Drive

| Activity | Description |
| --- | --- |
| [`gdrive.list`](./activities/gdrive.md#gdrivelist) | List files, by folder, name or Drive query |
| [`gdrive.download`](./activities/gdrive.md#gdrivedownload) | Download a file, inline or to disk |
| [`gdrive.upload`](./activities/gdrive.md#gdriveupload) | Upload or replace a file |
| [`gdrive.get_metadata`](./activities/gdrive.md#gdriveget_metadata) | Read one file's metadata |
| [`gdrive.create_folder`](./activities/gdrive.md#gdrivecreate_folder) | Create a folder, optionally reusing an existing one |
| [`gdrive.delete`](./activities/gdrive.md#gdrivedelete) | Trash or permanently delete a file |

### Kubernetes

| Activity | Description |
| --- | --- |
| [`k8s.apply`](./activities/k8s.md#k8sapply) | Server-side apply one or more manifests |
| [`k8s.get`](./activities/k8s.md#k8sget) | Fetch a single resource |
| [`k8s.list`](./activities/k8s.md#k8slist) | List resources by label or field selector |
| [`k8s.delete`](./activities/k8s.md#k8sdelete) | Delete a resource, or a set of them |
| [`k8s.scale`](./activities/k8s.md#k8sscale) | Set a workload's replica count |
| [`k8s.logs`](./activities/k8s.md#k8slogs) | Read a bounded tail of a pod's log |
| [`k8s.wait`](./activities/k8s.md#k8swait) | Poll until a condition holds, or the resource is gone |
| [`k8s.exec`](./activities/k8s.md#k8sexec) | Run a command in a container |

### Messaging and streaming

| Activity | Description |
| --- | --- |
| [`kafka.publish`](./activities/kafka.md#kafkapublish) | Publish messages to a Kafka topic |
| [`kafka.consume`](./activities/kafka.md#kafkaconsume) | Consume a topic, relaying each message as an event |
| [`rabbit.publish`](./activities/rabbit.md#rabbitpublish) | Publish a message to a RabbitMQ topic |
| [`rabbit.receive`](./activities/rabbit.md#rabbitreceive) | Subscribe to a topic, relaying each message as an event |
| [`graphql.subscribe`](./activities/graphql.md#graphqlsubscribe) | Hold a GraphQL subscription, relaying each payload |
| [`websocket.subscribe`](./activities/websocket.md#websocketsubscribe) | Hold a WebSocket connection, relaying each frame |
| [`mcp.call_tool`](./activities/mcp.md#mcpcall_tool) | Call a remote MCP tool, relaying its progress |
| [`mcp.list_tools`](./activities/mcp.md#mcplist_tools) | List a remote MCP server's tools, with hashes for drift detection |

### AI

| Activity | Description |
| --- | --- |
| [`openai.chat.completions`](./activities/openai.md#openaichatcompletions) | One chat completion, with tools and structured output |
| [`claude_agent.query`](./activities/claude-agent.md#claude_agentquery) | An autonomous multi-turn agent loop |
| [`llama_index.index_web`](./activities/llama-index.md#llama_indexindex_web) | Index a list of URLs |
| [`llama_index.index_site`](./activities/llama-index.md#llama_indexindex_site) | Index a site from one seed — sitemap, feed or crawl |
| [`llama_index.index_github`](./activities/llama-index.md#llama_indexindex_github) | Index a GitHub repository |
| [`llama_index.index_gdrive`](./activities/llama-index.md#llama_indexindex_gdrive) | Index a Google Drive folder or file list |
| [`llama_index.index_files`](./activities/llama-index.md#llama_indexindex_files) | Index files on the worker's disk |
| [`llama_index.index_docs`](./activities/llama-index.md#llama_indexindex_docs) | **Deprecated** — use `llama_index.index_web` |
| [`llama_index.query`](./activities/llama-index.md#llama_indexquery) | Semantic search, retrieving chunks or synthesizing an answer |
| [`llama_index.drop_table`](./activities/llama-index.md#llama_indexdrop_table) | Drop an index's table and all its chunks |
| [`langfuse.run_experiment`](./activities/langfuse.md#langfuserun_experiment) | Offline evaluation over a Langfuse dataset |
| [`langfuse.create_score`](./activities/langfuse.md#langfusecreate_score) | Attach scores to the running workflow's trace |
| [`typesafe.system_one`](./activities/typesafe.md#typesafesystem_one) | Answer named noul/choice/score questions about text or JSON |

### Browser automation — Playwright

| Activity | Description |
| --- | --- |
| [`playwright.browser.create`](./activities/playwright.md#playwrightbrowsercreate) | Launch a browser and get a session id |
| [`playwright.browser.close`](./activities/playwright.md#playwrightbrowserclose) | Close the session |
| [`playwright.browser.get_info`](./activities/playwright.md#playwrightbrowserget_info) | Report on a live session |
| [`playwright.page.goto`](./activities/playwright.md#playwrightpagegoto) | Navigate to a URL |
| [`playwright.page.back`](./activities/playwright.md#playwrightpageback--playwrightpageforward--playwrightpagereload) | Go back in history |
| [`playwright.page.forward`](./activities/playwright.md#playwrightpageback--playwrightpageforward--playwrightpagereload) | Go forward in history |
| [`playwright.page.reload`](./activities/playwright.md#playwrightpageback--playwrightpageforward--playwrightpagereload) | Reload the page |
| [`playwright.element.click`](./activities/playwright.md#playwrightelementclick) | Click an element |
| [`playwright.element.fill`](./activities/playwright.md#playwrightelementfill) | Set an input's value |
| [`playwright.element.type`](./activities/playwright.md#playwrightelementtype) | Type text with keyboard events |
| [`playwright.element.clear`](./activities/playwright.md#playwrightelementclear) | Empty an input |
| [`playwright.element.select`](./activities/playwright.md#playwrightelementselect) | Choose a dropdown option |
| [`playwright.element.get_text`](./activities/playwright.md#playwrightelementget_text) | Read an element's text |
| [`playwright.element.get_attribute`](./activities/playwright.md#playwrightelementget_attribute) | Read an element attribute |
| [`playwright.element.is_visible`](./activities/playwright.md#playwrightelementis_visible) | Whether an element is visible |
| [`playwright.element.is_enabled`](./activities/playwright.md#playwrightelementis_enabled) | Whether an element is enabled |
| [`playwright.element.query_selector`](./activities/playwright.md#playwrightelementquery_selector) | Whether one element matches |
| [`playwright.element.query_selector_all`](./activities/playwright.md#playwrightelementquery_selector_all) | Count matching elements |
| [`playwright.page.content`](./activities/playwright.md#playwrightpagecontent) | Get the rendered HTML |
| [`playwright.page.title`](./activities/playwright.md#playwrightpagetitle) | Get the page title |
| [`playwright.page.url`](./activities/playwright.md#playwrightpageurl) | Get the current URL |
| [`playwright.page.screenshot`](./activities/playwright.md#playwrightpagescreenshot) | Capture a screenshot |
| [`playwright.page.evaluate`](./activities/playwright.md#playwrightpageevaluate) | Run JavaScript in the page |
| [`playwright.page.wait_for_selector`](./activities/playwright.md#playwrightpagewait_for_selector) | Wait for an element to reach a state |
| [`playwright.page.wait_for_url`](./activities/playwright.md#playwrightpagewait_for_url) | Wait for the URL to match |
| [`playwright.page.wait_for_timeout`](./activities/playwright.md#playwrightpagewait_for_timeout) | Wait a fixed time |

### Browser automation — Selenium

| Activity | Description |
| --- | --- |
| [`selenium.browser.create`](./activities/selenium.md#seleniumbrowsercreate) | Launch Chrome and get a session id |
| [`selenium.browser.close`](./activities/selenium.md#seleniumbrowserclose) | Close the session |
| [`selenium.browser.get_info`](./activities/selenium.md#seleniumbrowserget_info) | Report on a live session |
| [`selenium.nav.goto`](./activities/selenium.md#seleniumnavgoto) | Navigate to a URL |
| [`selenium.nav.back`](./activities/selenium.md#seleniumnavback--seleniumnavforward--seleniumnavrefresh) | Go back in history |
| [`selenium.nav.forward`](./activities/selenium.md#seleniumnavback--seleniumnavforward--seleniumnavrefresh) | Go forward in history |
| [`selenium.nav.refresh`](./activities/selenium.md#seleniumnavback--seleniumnavforward--seleniumnavrefresh) | Reload the page |
| [`selenium.element.click`](./activities/selenium.md#seleniumelementclick) | Click an element |
| [`selenium.element.type`](./activities/selenium.md#seleniumelementtype) | Type text into an element |
| [`selenium.element.clear`](./activities/selenium.md#seleniumelementclear) | Empty an input |
| [`selenium.element.find`](./activities/selenium.md#seleniumelementfind) | Find one or many elements |
| [`selenium.element.get_text`](./activities/selenium.md#seleniumelementget_text) | Read an element's text |
| [`selenium.element.get_attribute`](./activities/selenium.md#seleniumelementget_attribute) | Read an HTML attribute |
| [`selenium.element.get_property`](./activities/selenium.md#seleniumelementget_property) | Read a live DOM property |
| [`selenium.element.is_visible`](./activities/selenium.md#seleniumelementis_visible) | Whether an element is visible |
| [`selenium.element.is_enabled`](./activities/selenium.md#seleniumelementis_enabled) | Whether an element is enabled |
| [`selenium.page.get_html`](./activities/selenium.md#seleniumpageget_html) | Get the rendered page source |
| [`selenium.page.get_title`](./activities/selenium.md#seleniumpageget_title) | Get the page title |
| [`selenium.page.get_url`](./activities/selenium.md#seleniumpageget_url) | Get the current URL |
| [`selenium.page.screenshot`](./activities/selenium.md#seleniumpagescreenshot) | Capture the page or one element |
| [`selenium.page.execute_script`](./activities/selenium.md#seleniumpageexecute_script) | Run JavaScript in the page |
| [`selenium.wait.element`](./activities/selenium.md#seleniumwaitelement) | Wait for an element condition |
| [`selenium.wait.time`](./activities/selenium.md#seleniumwaittime) | Wait a fixed time |

### Authorization

| Activity | Description |
| --- | --- |
| [`authz.list_resources`](./activities/authz.md#authzlist_resources) | List resources that have policies |
| [`authz.get_resource_policy`](./activities/authz.md#authzget_resource_policy) | Fetch a resource's policy |
| [`authz.check_privilege`](./activities/authz.md#authzcheck_privilege) | Evaluate whether the caller may perform an action |
| [`authz.impersonate_user`](./activities/authz.md#authzimpersonate_user) | Obtain an identity for another user |

### Deployment and administration

Seventy-five activities, documented by family on the
[Deployment & Admin](./activities/deploy.md) page.

| Family | Activities | Covers |
| --- | --- | --- |
| [Namespaces](./activities/deploy.md#namespaces) | `builtin.deploy.namespace.*` (5) | Create, read and delete namespaces |
| [Workflowspecs](./activities/deploy.md#workflowspecs) | `builtin.deploy.wfspec.*` (4) | Register and list wfspecs |
| [Packages and files](./activities/deploy.md#packages-and-files) | `builtin.deploy.package.*` (9) | Versioned packages and their YAML files |
| [Stages, deployments and targeting](./activities/deploy.md#stages-deployments-and-targeting) | `builtin.deploy.stage.*`, `deployment.*`, `target.*`, `deploy_package`, `undeploy_package` (11) | Rolling a package out to a stage and an audience |
| [Deployment queries](./activities/deploy.md#deployment-queries) | `builtin.deploy.query.*` (6) | Which version a user resolves to, and why |
| [Users](./activities/deploy.md#users) | `builtin.deploy.user.*` (5) | User accounts |
| [Groups](./activities/deploy.md#groups) | `builtin.deploy.group.*` (7) | Groups and nested membership |
| [Roles and privileges](./activities/deploy.md#roles-and-privileges) | `builtin.deploy.auth.*` (21) | Stored RBAC: resources, privileges, roles, members |
| [API keys](./activities/deploy.md#api-keys) | `builtin.deploy.apikey.*` (6) | The calling user's API keys |
| [Audit log](./activities/deploy.md#audit-log) | `builtin.deploy.audit.get_logs` (1) | Querying deployment history |
