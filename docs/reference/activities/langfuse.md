---
sidebar_label: Langfuse
---

# Langfuse Activities

Two activities connect a workflow to [Langfuse](https://langfuse.com) for LLM evaluation:

- **`langfuse.run_experiment`** — *offline* evaluation. Replays a Langfuse dataset where the task
  and each evaluator are themselves moco workflows.
- **`langfuse.create_score`** — *online* evaluation. Attaches scores to the trace of the workflow
  that is running right now.

## Setup

Credentials come from the activity input or, when omitted, from the environment:

| Input field | Environment variable |
| --- | --- |
| `public_key` | `LANGFUSE_PUBLIC_KEY` |
| `secret_key` | `LANGFUSE_SECRET_KEY` |
| `base_url` | `LANGFUSE_BASE_URL` |

A missing value is a hard error, not a silent fallback. The worker needs the `langfuse` package.

:::caution These are raw credentials, not secret names
This is the only provider that takes credentials inline rather than as a `*_secret_key`. A key
written into a wfspec passes through workflow context and history in plaintext — prefer
configuring the environment variables on the worker and omitting the fields entirely.
:::

Scoring also relies on tracing: `langfuse.create_score` uses the run's `trace_id` as the Langfuse
trace id, which is correct when the deployment exports OpenTelemetry traces to Langfuse
(`MOCO_OTEL_ENABLE_LANGFUSE=true`).

## Defaults

| Activity | Timeout | Max attempts |
| --- | --- | --- |
| `langfuse.run_experiment` | 3600 s | **1** — an experiment must not be replayed |
| `langfuse.create_score` | 30 s | 3 — safe, thanks to the deterministic score id |

---

## `langfuse.run_experiment`

Runs every item of a Langfuse dataset through a **task workflow**, then scores each result with one
or more **evaluator workflows**, and records the run in Langfuse.

Each dataset item's `input` is handed to the task workflow as its input, unchanged — no
schema is imposed, so the dataset must be shaped to match the workflow's inputs. Each evaluator
receives `{input, output, expected_output, metadata}` and must return a dict, or a list of dicts,
carrying `name` and `value`; a missing `name` defaults to the evaluator's workflow name.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `dataset_name` | str | yes | — | Langfuse dataset to run |
| `task` | [WorkflowSpecInfo](#workflowspecinfo) | yes | — | Workflow run for each dataset item |
| `evaluators` | list[[WorkflowSpecInfo](#workflowspecinfo)] | no | `[]` | Workflows that score each result |
| `experiment_name` | str | no | `null` | Experiment name in Langfuse |
| `run_name` | str | no | `null` | Name of this run |
| `description` | str | no | `null` | Run description |
| `metadata` | dict | no | `null` | Metadata attached to the run |
| `max_concurrency` | int | no | `null` | Dataset items processed in parallel |
| `public_key` | str | no | `LANGFUSE_PUBLIC_KEY` | Langfuse public key |
| `secret_key` | str | no | `LANGFUSE_SECRET_KEY` | Langfuse secret key |
| `base_url` | str | no | `LANGFUSE_BASE_URL` | Langfuse endpoint |

#### WorkflowSpecInfo

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | no | `null` | Name of a deployed wfspec |
| `version` | str | no | latest | Version to run |
| `content` | str \| list[str] | no | `null` | The wfspec YAML inline — a complete document with `header` and `main` — instead of a deployed name |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `name` | str \| null | Experiment name |
| `run_name` | str \| null | Run name |
| `description` | str \| null | Run description |
| `experiment_id` | str \| null | Langfuse experiment id |
| `dataset_run_id` | str \| null | Langfuse dataset run id |
| `dataset_run_url` | str \| null | Link to the run in the Langfuse UI |
| `item_results` | list[object] | One per dataset item: `{output, evaluations, trace_id, dataset_run_id}` |
| `run_evaluations` | list[object] | Run-level evaluations, each `{name, value, comment, data_type, metadata}` |

**Example**

Running a deployed task workflow against a dataset, with three deployed evaluators:

```yaml
- task_name: run-experiment
  activity:
    type: langfuse.run_experiment
    input:
      dataset_name: '{{ dataset_name }}'
      task:
        name: moco-agent/moco-agent-cli
      evaluators:
        - name: is_valid-wfspec
        - name: is_runnable-wfspec
        - name: llm-judge
  output:
    as: experiment_result
```

An evaluator is an ordinary workflow. It declares the four inputs it receives and returns its
score as the workflow `output`:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: exact-match

input:
  input:
  output:
  expected_output:
  metadata:

output:
  name: exact_match
  value: '{{ 1.0 if output == expected_output else 0.0 }}'

main:
  set: []
```

:::caution Each dataset item starts a top-level workflow
On the Temporal runtime, every task and evaluator is launched as its own top-level workflow, not as
a child of the caller. A large dataset is therefore a large fan-out — set `max_concurrency` to bound
it, and size the worker fleet accordingly.
:::

---

## `langfuse.create_score`

Attaches one or more scores to the **currently running workflow's trace**. There are no trace,
observation or session fields: the target is always the caller's own trace.

Supply either the single-score shorthand (`name` / `value` / …) **or** a `scores` list — never both.

`data_type` must agree with the value: `CATEGORICAL` and `TEXT` need a string, `NUMERIC` and
`BOOLEAN` a number (booleans are stored as `1.0` / `0.0`). A mismatch is rejected at parse time.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `scores` | list[[ScoreInput](#scoreinput)] | no | `null` | Several scores at once |
| `name` | str | no | `null` | Score name — single-score shorthand |
| `value` | number \| str \| bool | no | `null` | Score value — single-score shorthand |
| `data_type` | enum | no | `null` | `NUMERIC`, `CATEGORICAL`, `BOOLEAN` or `TEXT` |
| `comment` | str | no | `null` | Free-text rationale |
| `metadata` | dict | no | `null` | Extra metadata |
| `config_id` | str | no | `null` | Langfuse score config to validate against |
| `score_id` | str | no | `<trace_id>-<name>` | Explicit score id |
| `public_key` | str | no | `LANGFUSE_PUBLIC_KEY` | Langfuse public key |
| `secret_key` | str | no | `LANGFUSE_SECRET_KEY` | Langfuse secret key |
| `base_url` | str | no | `LANGFUSE_BASE_URL` | Langfuse endpoint |

#### ScoreInput

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | yes | — | Score name |
| `value` | number \| str \| bool | yes | — | Score value |
| `data_type` | enum | no | `null` | `NUMERIC`, `CATEGORICAL`, `BOOLEAN` or `TEXT` |
| `comment` | str | no | `null` | Free-text rationale |
| `metadata` | dict | no | `null` | Extra metadata |
| `config_id` | str | no | `null` | Langfuse score config |
| `score_id` | str | no | `<trace_id>-<name>` | Explicit score id |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `trace_id` | str | Trace the scores were attached to |
| `scores` | list[object] | The scores written, each `{score_id, name}` |

**Example**

Online scoring at the end of a run, skipped when there is no verdict to record:

```yaml
- task_name: record_scores
  skip_if: '{{ not verdict }}'
  activity:
    type: langfuse.create_score
    input:
      scores:
        - name: correctness
          value: "{{ float(verdict.get('correctness', 0.0)) }}"
          data_type: NUMERIC
          comment: "{{ verdict.get('rationale', '') }}"
        - name: tone
          value: "{{ verdict.get('tone', 'unknown') }}"
          data_type: CATEGORICAL
  output:
    as: score_result
```

:::note Retries upsert rather than duplicate
The score id defaults to `<trace_id>-<name>`, so a retry overwrites the previous score instead of
adding a second one. Override `score_id` only if you actually want several scores of the same name
on one trace.
:::

:::caution It needs a trace
`langfuse.create_score` fails when the run has no trace id. Scores also only land where they can be
found if the deployment exports traces to Langfuse.
:::
