---
sidebar_label: Events & Metrics
---

# Event Activities

Two activities publish observability signals out of a workflow: a **debug event** streamed live to
whoever is watching the run, and a **metric event** written to Kafka for aggregation.

Both are infrastructure-facing. The engine already emits them for you — task boundaries, activity
progress, activity start/end/error metrics — so a workflow only calls them directly to add its own
signals.

Neither has anything to do with the workflow *events* used by `emit_event`, `wait_for` and state
machines. Those coordinate execution and are covered in [Events](../../concepts/events.md).

## Defaults

| Activity | Timeout | Max attempts | Local |
| --- | --- | --- | --- |
| `builtin.event.emit_debug_event` | — | 1 | yes |
| `builtin.event.emit_metric_event` | — | 1 | yes |

Both run locally and are not retried: a dropped observability signal is not worth failing or
delaying a workflow over.

---

## `builtin.event.emit_debug_event`

Publishes a debug event on the debug bus, under the topic `<trace_id>:debug`.

This is the channel behind live run output. `moco-server` subscribes to it and forwards each event
to the caller as an MCP progress notification, which the `moco` CLI prints as the run proceeds —
so a `data_log` event emitted here shows up in the user's terminal immediately, rather than at the
end with the result.

**Input**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_type` | enum | yes | One of `workflow_start`, `workflow_end`, `workflow_error`, `step_start`, `step_end`, `step_error`, `data_log`, `activity_progress` |
| `workflow_id` | str | yes | The workflow this event belongs to |
| `event_data` | any | yes | The payload; shape depends on `event_type` |

**Output**

None.

**Example**

Reporting progress from inside a long loop:

```yaml
- task_name: report-progress
  activity:
    type: builtin.event.emit_debug_event
    input:
      event_type: data_log
      workflow_id: '{{ __sys_info__["workflow_id"] }}'
      event_data:
        message: "Processed {{ done }} of {{ total }} records"
        done: "{{ done }}"
        total: "{{ total }}"
```

To log a value you are already storing, there is a shorter way: end the variable name with `#`
in `set`, `output.set` or `output.as`, and the engine emits a `data_log` event carrying the stored
value:

```yaml
- task_name: count-processed
  set:
    - done#: '{{ done + len(batch) }}'     # stored as `done`, and logged
```

:::note Debug mode only, and best effort
Nothing is published unless the run is in debug mode — `moco run` on a local YAML file enables it
automatically; a deployed workflow needs `--debug`. If the debug bus is not configured
(`MOCO_RMQ_CONNECTION_URL` unset) the activity quietly does nothing.

Debug events are **not** Temporal signals: they cost no workflow history and are not subject to the
unmatched-event retention cap, so emitting them liberally is cheap.
:::

---

## `builtin.event.emit_metric_event`

Publishes a metric to Kafka for downstream aggregation and dashboards.

Most fields are filled in for you from the running activity's context — `timestamp`, `trace_id`,
`wfspec_name`, `wfspec_version`, `activity_type`, `user_id`, `debug_mode` and `tier` — so a
workflow normally supplies only `event_type`, `event_value` and `properties`.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `event_type` | str | yes | — | Metric name, e.g. `order.processed` |
| `event_value` | number | no | `null` | The measurement |
| `properties` | dict | no | `null` | Extra dimensions to slice by |
| `wfspec_name` | str | no | auto | Workflow name |
| `wfspec_version` | str | no | auto | Workflow (package) version |
| `activity_type` | str | no | auto | Activity type |
| `user_id` | str | no | auto | Calling user |
| `trace_id` | str | no | auto | Trace the run belongs to |
| `span_id` | str | no | `null` | Span within the trace |
| `tier` | str | no | auto | Execution tier |
| `debug_mode` | bool | no | auto | Whether the run is in debug mode |
| `timestamp` | str | no | now (UTC ISO) | Event time |

**Output**

None.

**Example**

```yaml
- task_name: record-batch-size
  activity:
    type: builtin.event.emit_metric_event
    input:
      event_type: "orders.batch_processed"
      event_value: "{{ len(orders) }}"
      properties:
        region: "{{ region }}"
        channel: "{{ channel }}"
```

:::note Requires Kafka configuration
Nothing is published unless both a topic (`MOCO_METRICS_TOPIC`) and a broker
(`MOCO_METRICS_BROKER`, falling back to `MOCO_KAFKA_BROKER`) are configured; otherwise the activity
returns quietly. The engine's own automatic `activity.start` / `activity.end` / `activity.error`
metrics additionally require `MOCO_ENABLE_METRICS=true`.
:::
