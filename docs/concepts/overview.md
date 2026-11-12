---
sidebar_position: 1
---

# Core Concepts Overview

This page is the map. It introduces every concept you need to build a Moco workflow and links to the
page that covers each one properly.

Three ideas hold the platform together:

**A workflow is a document.** A **workflowspec** (or **wfspec**) is a YAML file that expresses your
logic as a mix of imperative steps, an event-driven state machine, and a declarative rules engine —
with sandboxed Python expressions in `{{ }}` wherever a value needs to be computed. One language
covers a wide range of workflows, and it stays readable by the people who own the process.

**A workflow is released like data, not like software.** Because a wfspec is a document rather than
code compiled into the runtime, you publish and deploy it yourself, on demand, through the CLI or
the web console. Versioning, access control, and staged rollout are properties of the published
package, so workflows can be shared and composed without a backend deployment for every change.

**Durability is the platform's problem.** Workflows run durably on Temporal — surviving crashes,
restarts, and multi-day waits — without you writing any state-management or checkpointing logic. The
same wfspec also runs in-memory with no infrastructure at all when you want speed over durability.

## Workflowspec

A **workflowspec** is a YAML document that defines a complete workflow. It specifies:

- Workflow identity (`header.workflow_name`; the version comes from the package it is published in)
- Input parameters and their defaults
- Initial context variables
- The main task (execution logic)
- The workflow result

```yaml
header:
  schema_version: 2.0.0
  workflow_name: my-workflow
context:
  status: pending
input:
  user_id:
output:
  user_id: '{{ user_id }}'
  status: '{{ status }}'
main:
  tasks:
    - set:
        - status: done
```

See [Workflowspec Structure](./workflowspec.md).

## Tasks

Tasks are the building blocks of workflows. Every task has exactly one **kind** key, plus optional
shared keys: `task_name`, `skip_if`, `props`, `output` and `on_error`.

### Primitive tasks
Leaf tasks that perform one action:
- **set**: Assign variables
- **activity**: Execute an activity — the bridge to the outside world
- **workflow**: Execute a child workflow, or a `function` defined in the same wfspec
- **raise**: Fail, stop the workflow early, or leave a container or loop
- **wait_for**: Wait for an event or a timeout
- **emit_event**: Send an event to the event bus
- **checkpoint**: Let a long-running workflow continue as new with a fresh history
- **state_machine**: Event-driven finite state machine
- **rules_engine**: Declarative rule evaluation over a working memory of facts

### Containers and control flow
Tasks that run other tasks:
- **tasks**: Run child tasks, sequentially or in parallel
- **loop**: Run a task for each item of a collection, sequentially or in parallel
- **branches**: if / elif / else
- **switch**: Match one value against cases

## Expressions

Expressions provide dynamic behavior using Python syntax:

```yaml
- set:
    # Simple expression
    - total: '{{ price * quantity }}'

    # Complex expression with a comprehension
    - result: '{{ sum(item["price"] for item in items) }}'

    # Conditional expression
    - discount: '{{ price * 0.1 if price > 100 else 0 }}'
```

A value that is exactly one `{{ }}` keeps its type; text mixed with `{{ }}` becomes a string.

### Evaluation modifiers
- **python**: Standard Python evaluation (default)
- **python_glom**: Path-based data extraction
- **literal**: No evaluation, treat as string
- **jinja**: Jinja2 template rendering

## Activities

Activities are external functions or services that workflows can invoke:

```yaml
- task_name: fetch-data
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.example.com/data
      output_json: true
    options:
      retry_policy:
        timeout_sec: 30
        max_attempts: 3
  output:
    data: '{{ _["json"] }}'
    as: api_result
```

Moco ships activities for HTTP and GraphQL, shell commands, SQL, email, Kafka and RabbitMQ, Google
Drive, Kubernetes, browser automation, OpenAI and Claude agents, vector search, and the platform's
own secret, state, and deployment operations. The
[Activity Catalog](../reference/activity-catalog.md) lists every one with its input and output
contract.

## Context and Variables

Workflows maintain a context (variable store) throughout execution:

- **Context**: Initial variables defined in the workflowspec
- **Input**: Parameters passed when starting the workflow, over their declared defaults
- **Task results**: Stored with `set`, or with a task's `output` (`set` / `data` / `as`)
- **Special Variables**:
  - `_`: The current task's raw result, inside its `output`
  - `__context__`: A merged view of every visible variable
  - `__user_info__`: User information
  - `__sys_info__`: System info (workflow_id, trace_id, etc.)
  - a loop's `foreach` and `index` variables

### Variable Modifiers

Control how variables are evaluated and stored:

```yaml
- set:
    # Task-local: discarded when the task ends
    - _subtotal: '{{ quantity * unit_price }}'

    # Container scope: lives until the enclosing container or loop iteration ends
    - temp@: '{{ _subtotal * 1.08 }}'

    # Debug logging
    - value#: '{{ temp }}'

    # Force an evaluation type
    - template#literal: '{{ not_evaluated }}'
    - first_dept#python_glom: '"people.0.dept"'
```

## Runtimes and Execute Modes

The same wfspec runs two ways: durably and distributed on **Temporal**, or entirely **in-memory**
with no infrastructure. You pick per run, not per workflow — `moco run --in-memory`, or
`execute_mode` through the API. A third mode, `standalone-activity`, runs the whole spec as one
durable unit for data-heavy work.

See [Runtimes](./dual-runtime.md) for the trade-offs and
[How Workflows Run](./how-to-run-workflow.md) for the execute modes and their options.

## Events

Workflows can communicate via events:

### Emitting Events
```yaml
- emit_event:
    topic: notifications
    event_type: task-complete
    data:
      message: Task complete
      result: '{{ result }}'
```

### Waiting for Events
```yaml
- wait_for:
    event:
      topic: notifications
      match_expression: '{{ event["data"].get("id") == task_id }}'
    timeout_sec: 60
  output:
    as: received_event        # null on timeout
```

Events enable:
- Parent-child workflow communication
- Multi-agent coordination
- State machine transitions
- Asynchronous notifications

## Child Workflows

Workflows can execute other workflows, in one of four modes:

- **inline** (default): Runs in the parent's process as part of its execution
- **sync**: Runs as a separate workflow; the parent waits for the result
- **async**: Runs as a separate workflow; the parent waits only for it to start, and gets a `workflow_id`
- **detached**: Runs completely independently, and outlives the parent

A child always starts with a fresh context built from its `input`; it sees nothing of the parent's
variables.

```yaml
- workflow:
    ref: child-workflow
    mode: sync
    input:
      param: '{{ value }}'
  output:
    as: child_result
```

## State Machines

For complex event-driven workflows, use state machines:

```yaml
- state_machine:
    initial_state: pending
    states:
      - name: pending
      - name: processing
      - name: completed
        is_terminal: true
    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_type: start
      - from_state: processing
        to_state: completed
        trigger:
          event_type: done
```

State machines provide:
- Explicit state management
- Event-driven transitions
- State-specific timeouts
- Entry/exit callbacks
- Global transitions

## Where to go next

**Writing a workflow**

- [Workflowspec Structure](./workflowspec.md) — the anatomy of a spec
- [Expressions](./expressions.md) — the `{{ }}` language and variable modifiers
- [Activities](./activities.md) — calling the outside world
- [Writing Workflows](../guides/writing-workflows.md) — practical authoring patterns

**Beyond straight-line logic**

- [State Machines](./state-machines.md) — event-driven and human-in-the-loop workflows
- [Rules Engine](./rules-engine.md) — declarative rules over a working memory of facts
- [Events](./events.md) — `emit_event`, `wait_for`, and workflow-to-workflow messaging
- [Composing Workflows](./child-workflows.md) — functions, child workflows, and child modes

**Running and shipping it**

- [Runtimes](./dual-runtime.md) — in-memory versus durable execution
- [How Workflows Run](./how-to-run-workflow.md) — execute modes, entity workflows, run options
- [Using the Moco CLI](../guides/use-moco-cli.md) — run, test, publish
- [Running Workflows Through the API](../guides/run-moco-workflow-through-api.md) — REST and MCP
- [Testing Workflows](../guides/testing.md) — `*.test.yaml` suites
- [Releasing and Sharing](./release-and-sharing.md) — packages, stages, targets, access control

**Looking something up**

- [Tasks Reference](../reference/statements.md)
- [Workflowspec Reference](../reference/workflowspec-reference.md)
- [Activity Catalog](../reference/activity-catalog.md)
