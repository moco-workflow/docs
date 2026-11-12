---
sidebar_label: Claude Agent
---

# Claude Agent Activities

One activity, `claude_agent.query`, runs a full Claude Agent SDK loop inside a single activity. The
agent reasons over multiple turns and calls tools autonomously; the activity returns its final
result.

Use it when a task is open-ended enough that you cannot specify it in advance — "investigate why
this job failed and summarise the cause". For a single prompt-and-response, use
[`openai.chat.completions`](./openai.md) instead: an agent loop is slower and more expensive.

## Setup

The Anthropic API key is named, not inlined: `apikey_secret_key` is the name of a secret holding
it. A bare `NAME` resolves a user-scoped secret, `global/NAME` a global one.

`ANTHROPIC_BASE_URL` on the worker points the agent at a gateway.

Deployment-enforced ceilings clamp what a workflow may ask for — and supply the value when the
workflow omits it:

| Variable | Clamps |
| --- | --- |
| `MOCO_CLAUDE_AGENT_MAX_TURNS` | `max_turns` |
| `MOCO_CLAUDE_AGENT_MAX_BUDGET_USD` | `max_budget_usd` |
| `MOCO_CLAUDE_AGENT_MAX_TOOL_CALLS` | `max_tool_calls` |
| `MOCO_CLAUDE_AGENT_WORK_DIR` | Root of each run's private workspace |
| `MOCO_CLAUDE_AGENT_PLUGIN_ROOT` | `:`-separated search path of directories holding installed plugins |

:::note This activity runs on the agent worker
`claude_agent.query` is the only activity served by the `agent` worker type (task queue `agent`)
rather than the base worker — the Claude Agent SDK bundles a large native CLI that does not belong
in the base image. Workflows still run on the base worker and route the activity across
automatically; nothing in the wfspec changes. Because it is remote-queued, `execute_locally`
has no effect.
:::

## Defaults

86400 s (1 day) timeout, **1 attempt**, heartbeating every 20 s against a 60 s timeout.

An agent run has side effects — tool calls and real spend — so it is never retried. Note the
consequence: a missed heartbeat is a permanent failure.

Use `timeout_sec` in the activity's `input`, not `options.retry_policy.timeout_sec`, to bound a run: it stops the agent and
returns a **partial result**, where exhausting the activity timeout just fails the activity.

---

## `claude_agent.query`

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `prompt` | str | yes | — | The task for the agent |
| `apikey_secret_key` | str | yes | — | Secret name holding the Anthropic API key |
| `capabilities` | [ClaudeCapabilities](#capabilities) | no | empty | What the agent may do. Empty means text only |
| `system_prompt` | str | no | `null` | Custom system prompt. Mutually exclusive with `use_claude_code_preset` |
| `use_claude_code_preset` | bool | no | `false` | Use the built-in coding-agent harness prompt |
| `model` | str | no | CLI default | Alias (`opus`, `sonnet`, `haiku`) or a full model ID |
| `effort` | enum | no | `null` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `max_turns` | int | no | deployment ceiling | Maximum agentic turns |
| `max_budget_usd` | number | no | deployment ceiling | Cost ceiling for the run |
| `max_tool_calls` | int | no | deployment ceiling | Ceiling on bridged moco tool calls |
| `timeout_sec` | number | no | `null` | Wall-clock limit; stops the agent and returns a partial result |
| `workspace_subdir` | str | no | `null` | Name of a subdirectory inside the run's private workspace. A name, never a path |
| `env` | dict[str, str] | no | `{}` | Extra environment variables for the agent process. Names that could redirect the client or inject code (`ANTHROPIC_*`, `CLAUDE_*`, `AWS_*`, `PATH`, `NODE_OPTIONS`, `LD_PRELOAD`, …) are rejected |
| `relay_topic` | str | no | `"default"` | Event topic progress is relayed on — see [Watching a run](#watching-a-run) |
| `relay_event_type` | str | no | `null` | `event_type` stamped on relayed events |
| `relay_granularity` | enum | no | `"result"` | `none`, `result`, `turn` or `message` |
| `relay_thinking` | bool | no | `false` | Include thinking blocks in relayed events |
| `target_workflow_id` | str | no | current workflow | Workflow relayed events are delivered to |
| `debug_thinking` | bool | no | `false` | Include thinking blocks in the debug stream |
| `debug_tool_input` | bool | no | `false` | Include tool argument *values* in the debug stream, not just their keys |
| `include_transcript` | bool | no | `false` | Return the full message transcript |
| `max_result_chars` | int | no | `null` | Truncate the returned result text |
| `max_transcript_chars` | int | no | `null` | Truncate the returned transcript |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `result` | str | The agent's final answer |
| `is_error` | bool | Whether the run ended in an error state |
| `subtype` | str \| null | Result subtype reported by the SDK (`success`, `error`, …) |
| `terminal_reason` | str \| null | Why the run ended, e.g. `aborted_tools` |
| `num_turns` | int \| null | Agentic turns used |
| `duration_ms` | int \| null | Run duration |
| `total_cost_usd` | number \| null | Estimated cost |
| `usage` | dict \| null | Token usage |
| `tool_calls` | list[object] | Tools invoked, each `{name, activity_type, is_error}` |
| `denied_tools` | list[str] | Tools the agent tried that the permission gate refused |
| `timed_out` | bool | Whether `timeout_sec` stopped the run |
| `truncated` | bool | Whether `result` or `transcript` was cut to fit its cap |
| `session_id` | str \| null | CLI session id, informational only |
| `transcript` | list[object] \| null | Full message transcript, when `include_transcript` is set |

A successful run with a non-empty `denied_tools` usually means the capability grant was too narrow
for the prompt.

**Example**

Reading the answer and failing the workflow when the agent reports an error:

```yaml
- task_name: plan_the_work
  activity:
    type: claude_agent.query
    input:
      apikey_secret_key: '{{ claude_apikey_secret_key }}'
      prompt: |
        Break the following question into at most three concrete lookup steps.
        Answer with a short numbered list and nothing else.

        Question: {{ question }}
      max_turns: 2
      effort: low
  output:
    set:
      - plan: '{{ _["result"] }}'
      - plan_failed: '{{ _["is_error"] }}'

- task_name: check-plan
  raise:
    if: '{{ plan_failed }}'
    type: error
    error_type: AgentError
    message: 'agent failed: {{ plan }}'
```

With tools granted:

```yaml
- task_name: investigate
  activity:
    type: claude_agent.query
    input:
      apikey_secret_key: global/ANTHROPIC_API_KEY
      prompt: |
        Find out what https://api.github.com/zen returns and summarise it.
      capabilities:
        # Moco activities exposed to the agent as tools. They run through the normal
        # providers under the calling user, so the agent can never exceed that user's
        # own privileges.
        moco_tools:
          - http.request
      max_turns: 8
      max_tool_calls: 5
      timeout_sec: 300
      relay_topic: agent.progress      # optional: stream progress as workflow events
      relay_granularity: turn
  output:
    as: investigation
```

A runnable example lives in `moco-examples/activities/claude-agent-query.yaml`.

---

## Capabilities

:::warning Deny by default
The agent starts with **no capabilities**. Every tool must be granted explicitly under
`capabilities`.

This matters because the agent reads content you do not control — web pages, documents, tool
output — and then acts with the *calling user's* privileges. Grant the smallest set of tools the
task needs.
:::

| Field | Type | Purpose |
| --- | --- | --- |
| `builtin_tools` | list[str] | Claude Code built-ins, e.g. `["Read", "Grep", "Glob"]`. Tools not listed do not exist in the agent's context |
| `moco_tools` | list[str] | Moco activity types exposed as `mcp__moco__<type>` tools |
| `mcp_servers` | dict[str, object] | External MCP servers, keyed by name |
| `mcp_tools` | list[str] | Tool names allowed from those servers; a trailing wildcard per server is supported (`"mcp__github__*"`) |
| `plugins` | list[str] | Claude Agent plugins to load, by name |
| `skills` | list[str] | Skills to enable, as `<plugin>:<skill>` |

**Bridged moco tools** run through the normal activity providers under the caller's identity, so
the agent can never exceed the calling user's own privileges. Secret, state, deploy, shell,
workflow-execution and re-entrant agent activities are on a hard denylist and can never be bridged,
at any privilege level. Tools named in `moco_tools` are allowed automatically and need not be
repeated in `mcp_tools`.

**External MCP servers** must be remote — `{"type": "http"|"sse", "url": ...}`. Stdio servers
(`{"command": ..., "args": [...]}`) are rejected: they are an unguarded process-spawn primitive
with none of the checks that gate `shell.run`. Supply credentials with `headers_secret_key`, naming
a secret that holds a JSON object of headers, rather than an inline `headers` dict.

### Elevated capabilities

Granting `Bash`, `Write`, `Edit` or `NotebookEdit`, **or loading any plugin**, escalates the
authorization check from `run_agent` to `run_agent_elevated` against
`internal.claude_agent_activities`.

:::danger Granting `Bash` exposes the API key
The agent can read its own process environment, which holds the resolved Anthropic key. `Write`
and `Edit` similarly make the workspace boundary decorative.
:::

:::caution The authz gate fails open
If `internal.claude_agent_activities` is not deployed, the check passes. A deployment that wants
this activity restricted must actually deploy the policy — see [Authz Activities](./authz.md).
:::

### Plugins

A [Claude Agent plugin](https://code.claude.com/docs/en/plugins) bundles skills, commands,
subagents and hooks. Plugins are baked into the worker image and discovered from
`MOCO_CLAUDE_AGENT_PLUGIN_ROOT` — every immediate subdirectory of every root on that search path
is one available plugin. A workflow selects among them **by name**; it can never supply a path.

```yaml
capabilities:
  plugins:
    - deployment-tools          # name from the deployment's catalog
  skills:
    - deployment-tools:rollback # <plugin-name>:<skill-name>
```

The plugin's name is the `name` in its `.claude-plugin/plugin.json`, falling back to its directory
name. Naming one that is not installed produces an error listing what is available.

#### What ships by default

The `moco-agent` image prepackages [moco-devkit](https://github.com/moco-workflow/moco/tree/main/moco-devkit)
at `/moco/plugins`, so an agent can be pointed at Moco workflow authoring without any operator
setup:

| Plugin | Skills |
| --- | --- |
| `moco-workflow-dev` | `moco-planning-workflows`, `moco-developing-workflows`, `moco-validating-workflows`, `moco-testing-workflows`, `moco-executing-workflows` |
| `moco-knowledge` | `moco-consulting-kb` |

```yaml
capabilities:
  plugins:
    - moco-workflow-dev
  skills:
    - moco-workflow-dev:moco-developing-workflows
```

Two caveats on `moco-knowledge`: its knowledge base is **read-only** in the worker, because its
curation loop writes to `${CLAUDE_PLUGIN_DATA}`, which lives on the per-run workspace that is
deleted when the run ends. And its `reconcile-examples-index.sh` needs a `moco-examples` checkout
that is not in the image. Ask your operator whether they have added or removed plugins — the set
above is the chart default, not a guarantee.

Granting a skill implies the `Skill` tool, so you do not need to add it to `builtin_tools`.

:::danger Plugins run code on the worker
A plugin's hooks execute shell commands on lifecycle events, **outside the tool permission
system** — they fire even for an agent granted no tools at all. Loading a plugin is therefore
equivalent to granting code execution, and requires the same elevated authorization as `Bash`.

Select no plugins (the default) and no plugin code runs.
:::

:::note Plugin MCP servers are not available
MCP servers declared inside a plugin's `.mcp.json` are deliberately suppressed: surfacing them
would require handing the agent the complete built-in tool set, including `Bash`. Declare the
server under `capabilities.mcp_servers` instead.
:::

---

## Watching a run

An agent run is minutes of otherwise-silent work. Two independent channels report on it.

**Relayed events** go to the workflow, on `relay_topic`, consumed with `wait_for`. Use them when
the *workflow* needs to react to progress.

| `relay_granularity` | Relays |
| --- | --- |
| `none` | Nothing |
| `result` *(default)* | The final result only |
| `turn` | One event per assistant turn |
| `message` | One event per text or tool-use block |

Each relayed event is a Temporal signal and therefore a workflow-history entry, and the engine
retains at most 1000 unmatched events per topic — a 200-tool-call run at `message` granularity is
200 signals. Relayed text is capped at 8000 characters, and a relay failure never fails the run.

To keep the workflow responsive while the agent works, start the activity with
`options.async_mode: true` and wait for the relayed result:

```yaml
- task_name: start-agent
  activity:
    type: claude_agent.query
    input:
      apikey_secret_key: global/ANTHROPIC_API_KEY
      prompt: '{{ task_description }}'
      relay_topic: agent.progress
      relay_event_type: agent_result
      relay_granularity: result
    options:
      async_mode: true            # do not block; `_` is a token, not the result

- task_name: wait-for-agent
  wait_for:
    event:
      topic: agent.progress
      event_type: agent_result
    timeout_sec: 3600
  output:
    as: agent_event               # the event mapping, or null on timeout
```

**Debug progress** goes to the client: session init, each turn, every tool call and its outcome,
refused tools, subagent tasks and a final summary, printed live by the `moco` CLI. It costs no
workflow history and needs no configuration, but is **inert unless the run is in debug mode**.
`debug_thinking` and `debug_tool_input` add thinking blocks and tool argument values; both are off
by default because thinking restates content the agent read, and tool arguments are the file paths,
queries and request bodies themselves.

:::note No session resumption
Each run gets a private temporary working directory that is deleted afterwards, and the CLI keys
its session transcripts to that directory on local disk. Sessions therefore cannot be resumed
across activity runs. Model a multi-turn conversation by looping in the workflow and passing prior
context back through `prompt`.
:::
