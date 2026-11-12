---
sidebar_label: Built-in Core
---

# Built-in Core Activities

Three activities with no external dependency: read the clock, pause, and run a whole workflow
inside a single activity.

The rest of the `builtin.*` namespace is documented separately —
[state](./state.md), [secret](./secret.md), [event](./event.md) and [deploy](./deploy.md).

## Defaults

| Activity | Timeout | Max attempts | Local |
| --- | --- | --- | --- |
| `builtin.now` | — | 1 | yes |
| `builtin.delay` | — | 1 | yes |
| `builtin.execute_workflow` | 86400 s (1 day) | 1 | no |

`builtin.now` and `builtin.delay` run locally by default because a trip to a worker queue would
cost more than the work itself.

---

## `builtin.now`

Returns the current timestamp on the worker.

**Input**

None.

**Output**

A `datetime` value (not an object with fields). Store it with `output.as` and use it directly.

**Example**

```yaml
- task_name: get-timestamp
  activity:
    type: builtin.now
  output:
    as: started_at

# ... later
- task_name: summarise-run
  set:
    - run_label: '{{ started_at.strftime("%Y-%m-%d") }}'
    - elapsed_sec: '{{ (finished_at - started_at).total_seconds() }}'
```

:::note Determinism
`builtin.now` reads the worker's clock at execution time. On the Temporal runtime the value is
recorded in workflow history, so a replay sees the original timestamp rather than the clock of the
replaying worker.
:::

---

## `builtin.delay`

Pauses the workflow for a given duration.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `duration` | str \| number | no | `null` | How long to wait. A number is seconds; a string is a pandas-style interval such as `5s`, `10min`, `1h30m`. Omitting it is a no-op |

**Output**

`true` when a delay was performed, `null` when `duration` was omitted.

**Example**

```yaml
- task_name: wait-5-seconds
  activity:
    type: builtin.delay
    input:
      duration: 5s
```

A polling loop — `raise: break` leaves the loop once the job is done:

```yaml
- task_name: poll-status
  loop:
    in: '{{ range(max_polls) }}'
    do:
      tasks:
        - task_name: check-status
          activity:
            type: http.request
            input:
              method: GET
              url: '{{ status_url }}'
              output_json: true
          output:
            set:
              - status: '{{ _["json"] }}'
        - task_name: stop-when-done
          raise:
            if: '{{ status["state"] == "done" }}'
            type: break
        - task_name: wait-before-next-poll
          activity:
            type: builtin.delay
            input:
              duration: 30s
```

:::note Long waits belong in `wait_for`
`builtin.delay` holds an activity slot for its whole duration. To pause for hours or days, or
until something happens, use a `wait_for` task or a state machine instead — see
[Events](../../concepts/events.md).
:::

---

## `builtin.execute_workflow`

Runs an entire workflow **in memory, inside one activity**, using an embedded engine.

Reach for it when a workflow moves large data between tasks. On the Temporal runtime every
activity input and output crosses the wire and is capped at 2 MB; an embedded run keeps
intermediate data in the worker's process, so neither limit nor marshalling cost applies.

The trade is observability: tasks inside the embedded workflow are not individual Temporal
activities, so they get no per-task history and no per-task retry. The whole embedded run
succeeds or fails as one unit.

For an ordinary child workflow, use the [`workflow` task](../statements.md#workflow) instead.
This activity is the lower-level alternative: the spec to run is resolved when the activity runs,
so it can be picked from data — a name held in a variable, or YAML generated at runtime.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `wfspec` | [WorkflowSpecInfo](#workflowspecinfo) | yes | — | Which workflow to run |
| `input_data` | any | no | `null` | Input passed to that workflow; it becomes the embedded workflow's `input` |
| `options` | [WorkflowExecuteOptions](#workflowexecuteoptions) | no | `null` | Execution options |

#### WorkflowSpecInfo

Identify a deployed workflow by `name` (plus optional `version`), **or** supply the spec inline as
`content`. Inline content is how a dynamically generated workflow is run without deploying it.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | no | `null` | Name of a deployed wfspec |
| `version` | str | no | latest | Version to run |
| `content` | str \| list[str] | no | `null` | The wfspec YAML itself — a complete document with `header` and `main`. With a list, item 0 is the entry point |

#### WorkflowExecuteOptions

The commonly used fields; all are optional.

| Field | Type | Description |
| --- | --- | --- |
| `debug_mode` | bool | Publish debug events for the embedded run |
| `catch_exception` | bool | Return the error instead of failing the activity |
| `trace_id` | str | Correlate the embedded run with the caller's trace |
| `workflow_id` | str | Identifier for the embedded run |
| `tier` | str | Execution tier |
| `execute_mode` | str | `in-memory`, `standalone-activity` or `workflow` |
| `retry_policy` | dict | Timeout and retry settings for the embedded run |
| `enable_otel_trace` | bool | Emit OpenTelemetry spans |

**Output**

The embedded workflow's own output, unchanged.

**Examples**

Running a deployed spec by name:

```yaml
- task_name: run-signal-analysis
  activity:
    type: builtin.execute_workflow
    input:
      wfspec:
        name: multi-timeframe-trading-signal
      input_data:
        symbol: '{{ symbol }}'
        confluence_threshold: '{{ confluence_threshold }}'
        hourly_prices: '{{ hist_candles }}'
  output:
    as: last_result
```

Running an inline spec. The `#literal` modifier keeps the embedded document's `{{ }}`
expressions from being evaluated by the caller; they run inside the embedded workflow:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: run-embedded-sum

context:
  summing_child#literal: |
    header:
      schema_version: 2.0.0
      workflow_name: embedded-sum
    input:
      numbers: []
    output:
      count: '{{ len(numbers) }}'
      total: '{{ sum(numbers) }}'
    main:
      set: []

input:
  numbers: [3, 4, 5]

output: '{{ result }}'

main:
  task_name: run-inline-child
  activity:
    type: builtin.execute_workflow
    input:
      wfspec:
        content: '{{ summing_child }}'
      input_data:
        numbers: '{{ numbers }}'
      options:
        catch_exception: true     # a failing child comes back as data
  output:
    as: result
```

A complete example, including a spec chosen at runtime, is in
`moco-examples/activities/builtin-execute-workflow.yaml`.

:::note What the embedded workflow can call
It sees the activities of the worker it runs on. On the base worker that is the core provider set;
on the agent worker it additionally includes `claude_agent.*`. It cannot reach activities served
by a *different* worker type.
:::

:::caution Not retried
`builtin.execute_workflow` ships `max_attempts: 1` — a retry would re-run every side effect inside
the embedded workflow. It heartbeats every 20 seconds so Temporal detects a dead worker within a
minute rather than waiting out the one-day timeout.
:::
