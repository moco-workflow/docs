---
sidebar_position: 1
---

# Core Concepts Overview


## Overview
Understanding Moco's core concepts will help you build workflows more efficiently.

### **DSL**
A **Workflowspec** (or **wfspec**) is a YAML-based declarative specification that defines workflow logic in Moco.
With Moco workflowspec, your workflow logic can be easily expressed using a mix of **imperative steps**,
event driven **state machine**, or declarative **rules engine** in a very flexible and concise way.
The Yaml-based DSL also allows embedding sandboxed Python expressiones (with Pandas and Jinja2) to support complex dynamic data transformation.

* DSL vs Code-first approach
Compared with code-first approach that normally used for specialized engineering workflows,
the DSL-based approach allows workflows to be released without heavy-lifting backend deployment, allowing open-ended business workflows to be
managed in a much more flexible way.
Workflows implemented with any specific programming language can be considered as a full-blown application, need to be packaged and deployed as typical backend software.
DSL-based approach splits the application vertically - the shared runtime contains a generic workflow engine responsible for interpreting and executing the DSL workflow, and it prepackages the primitive activities that the workflow can use.
Codde first workflows must be deployed as legacy backend components, but the DSL workflows can be deployed in a much light-weight way like documents, with dynamic versioning support.


### **Workflow Deployment**
Moco's DSL approach decouples workflows from the runtime platform.
Unlike other engineering-oriented workflow platforms that require heavy-lifting backend deployment for workflow changes,
Moco is a business workflow platform that allows user-owned workflows to be deployed independently regardless of the runtime platform.
Moco users can deploy their workflows on demand through cli or web console.
Moco supports dynamic workflow versioning, permission control, and flexible targetting so that workflows can be easily shared and composed.

### **Durable Execution**
Moco provides durable workflow execution out of the box, but the complexity of distributed execution and state management are abstracted away from moco developers.
Moco achieved this by binding the generic DSL engine with the Open Source Temporalio platform, through a thin intergration layer on top of its activity dispatcher.
Unlike the common `checkpoint`-based approach for distributed state management (like Langraph), which requires explicit state management logic in workflow,
Temporalio's unqique way of capturing/restoring states through IO event history is systematic and provides an application agnostic way for state menagement.
Alternatively, the DSL engine can also directly run in a desktop app or a micro service to form a light-weight in-process runtime without durability guarantee.

## Workflowspec

A **workflowspec** is a YAML document that defines a complete workflow. It specifies:

- Workflow identity (name and version)
- Input parameters
- Initial context variables
- The workflow body (execution logic)
- Output specification

```yaml
wfspec_name: my-workflow
wfspec_version: 1.0.0
context:
  status: pending
input_data:
  user_id:
output_name: result
body:
  # Workflow logic here
```

## Statements

Statements are the building blocks of workflows. They come in two categories:

### Primitive Statements
Leaf nodes that perform specific actions:
- **transform**: Data transformations and variable assignments
- **abort**: Workflow termination (abort, terminate, break, raise)
- **activity**: Execute external functions/services
- **workflow**: Execute child workflows
- **wait_for**: Wait for events or timeouts
- **emit_event**: Send events to the event bus

### Composite Statements
Containers that orchestrate other statements:
- **sequence**: Execute statements sequentially
- **parallel**: Execute statements concurrently
- **iteration**: Loop over collections
- **state_machine**: Event-driven finite state machines

## Expressions

Expressions provide dynamic behavior using Python syntax:

```yaml
# Simple expression
total: "{{ price * quantity }}"

# Complex expression with list comprehension
result: "{{ sum([item['price'] for item in items]) }}"

# Conditional expression
discount: "{{ price * 0.1 if price > 100 else 0 }}"
```

### Expression Types
- **python**: Standard Python evaluation (default)
- **python_glom**: Path-based data extraction
- **literal**: No evaluation, treat as string
- **jinja**: Jinja2 template rendering

## Activities

Activities are external functions or services that workflows can invoke:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      method: GET
      url: https://api.example.com/data
    retry_policy:
      timeout_sec: 30
      max_attempts: 3
    output_name: api_result
```

Built-in activities include:
- HTTP requests
- Delays
- Event emission
- State persistence
- Secret management
- Workflow execution

Custom activities can be registered via activity providers.

## Context and Variables

Workflows maintain a context (variable store) throughout execution:

- **Context**: Initial variables defined in the workflowspec
- **Input Data**: Parameters passed when starting the workflow
- **Output Data**: Values computed during execution
- **Special Variables**:
  - `_`: Root context (all variables)
  - `__user_info__`: User information
  - `__sys_info__`: System info (workflow_id, trace_id, etc.)
  - `iter_item`: Current item in iteration
  - `iter_items`: All items in iteration

### Variable Modifiers

Control how variables are evaluated and stored:

```yaml
# Container scope (temporary, not persisted)
temp@: "{{ calculation() }}"

# Debug logging
value#: "{{ important_data }}"

# Force expression type
template#literal: "{{ not_evaluated }}"
path#python_glom: "data.nested.field"
```

## Runtime Modes

Moco supports two runtime modes:

### In-Memory Runtime
- Fast, synchronous execution
- Perfect for development and testing
- No external dependencies
- Limited to single-process execution

### Temporal.io Runtime
- Production-grade distributed execution
- Durable workflow state
- Automatic retries and timeouts
- Horizontal scaling
- Workflow history and replay
- Activity isolation

Switch between modes using environment variables - no code changes needed!

## Events

Workflows can communicate via events:

### Emitting Events
```yaml
- emit_event:
    input_data:
      topic: notifications
      data:
        message: "Task complete"
        result: "{{ result }}"
```

### Waiting for Events
```yaml
- wait_for:
    event:
      topic: notifications
      match_expression: "{{ event.data.get('id') == task_id }}"
    timeout_sec: 60
    output_name: received_event
```

Events enable:
- Parent-child workflow communication
- Multi-agent coordination
- State machine transitions
- Asynchronous notifications

## Child Workflows

Workflows can execute other workflows with different execution modes:

- **nested**: Child shares parent's context
- **sync**: Child runs independently, parent waits for result
- **async**: Child runs independently, parent waits for start
- **detached**: Child runs completely independently

```yaml
- workflow:
    wfspec:
      name: child-workflow
      version: 1.0.0
    child_mode: sync
    input_data:
      param: "{{ value }}"
    output_name: child_result
```

## State Machines

For complex event-driven workflows, use state machines:

```yaml
state_machine:
  name: order-fsm
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
```

State machines provide:
- Explicit state management
- Event-driven transitions
- State-specific timeouts
- Entry/exit callbacks
- Global transitions

## Next Steps

Dive deeper into specific topics:

- [Dual Runtime Architecture](./dual-runtime.md)
- [Workflowspec Structure](./workflowspec.md)
- [Expression Syntax](./expressions.md)
- [Activity System](./activities.md)
