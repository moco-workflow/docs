# Moco Workflowspec Technical Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Workflowspec Structure](#workflowspec-structure)
3. [Statement Types](#statement-types)
   - [Primitive Statements](#primitive-statements)
   - [Composite Statements](#composite-statements)
4. [Expression Syntax](#expression-syntax)
5. [Variable Modifiers](#variable-modifiers)
6. [Conditions](#conditions)
7. [Activities](#activities)
8. [State Machines](#state-machines)
9. [Events](#events)
10. [Child Workflows](#child-workflows)
11. [Complete Examples](#complete-examples)

---

## Introduction

Moco is a YAML-based declarative workflow orchestration engine that provides a Python expression-driven DSL for defining complex workflows. It supports both in-memory (development/testing) and Temporal.io (production) runtimes.

### Key Features

- **Declarative YAML syntax** for workflow definitions
- **Python expression evaluation** with sandboxed execution
- **Dual runtime support** (in-memory and Temporal.io)
- **Event-driven state machines** for complex logic
- **Nested and parallel workflows** with multiple execution modes
- **Rich activity system** with pluggable providers
- **Comprehensive condition logic** with and/or/not operations

---

## Workflowspec Structure

A workflowspec is a YAML document that defines a complete workflow. The basic structure includes:

```yaml
wfspec_name: my-workflow           # Unique workflow identifier
wfspec_version: 1.0.0              # Semantic version

context:                            # Initial context variables
  variable1: "default value"
  variable2: 42

input_data:                         # Input parameter definitions
  param1: default_value             # With default
  param2:                           # Required (no default)

output_name: result                 # Variable to return as workflow result

body:                               # Main workflow logic (a statement)
  sequence:
    elements:
      - transform:
          output_data:
            - result: "{{ 'Hello, World!' }}"
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wfspec_name` | string | Yes | Unique workflow identifier |
| `wfspec_version` | string | Yes | Semantic version (e.g., "1.0.0") |
| `context` | object | No | Initial context variables |
| `input_data` | object | No | Input parameter definitions |
| `output_name` | string | No | Variable name to return as result |
| `body` | statement | Yes | Main workflow logic (any statement type) |

---

## Statement Types

Statements are the building blocks of workflows. They come in two categories: **primitives** (leaf nodes) and **composites** (containers for other statements).

### Common Statement Parameters

All statements support these optional parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique identifier for the statement |
| `description` | string | Human-readable description |
| `condition` | expression or list | Condition to execute (skip if false) |
| `output_name` | string | Variable to store statement result |
| `output_data` | list | Data transformations after execution |

---

### Primitive Statements

Primitive statements are leaf nodes that perform specific actions.

#### 1. Transform

Performs data transformations and variable assignments.

```yaml
transform:
  input_data:                       # Optional: input transformations
    - temp_var: "{{ value * 2 }}"
  output_data:                      # Output transformations
    - result: "{{ temp_var + 10 }}"
    - message: "Result is {{ result }}"
```

**Parameters:**
- `input_data`: List of variable assignments (evaluated before body)
- `output_data`: List of variable assignments (main transformation logic)
- `output_name`: Variable to store the last output_data result

**Example: Basic calculation**
```yaml
- transform:
    output_data:
      - price: 100
      - tax: "{{ price * 0.08 }}"
      - total: "{{ price + tax }}"
```

**Example: String manipulation**
```yaml
- transform:
    output_data:
      - name: "John Doe"
      - greeting: "Hello, {{ name }}!"
      - uppercase: "{{ greeting.upper() }}"
```

---

#### 2. Abort

Terminates workflow execution with different behaviors.

```yaml
abort:
  type: terminate                   # abort, terminate, break, break_iteration, raise
  message: "Workflow completed successfully"
```

**Abort Types:**

| Type | Behavior |
|------|----------|
| `abort` | Abort entire workflow |
| `terminate` | Gracefully terminate workflow |
| `break` | Break out of current sequence/parallel block |
| `break_iteration` | Break out of current iteration loop |
| `raise` | Raise error and fail workflow |

**Example: Conditional termination**
```yaml
- abort:
    condition: "{{ price < 0 }}"
    type: raise
    message: "Invalid price: {{ price }}"
```

**Example: Early exit from loop**
```yaml
- iteration:
    input_data: "{{ items }}"
    body:
      sequence:
        elements:
          - transform:
              output_data:
                - current: "{{ iter_item }}"
          - abort:
              condition: "{{ current == 'target' }}"
              type: break_iteration
              message: "Found target item"
```

---

#### 3. Activity

Executes a registered activity (external function/service).

```yaml
activity:
  type: builtin.http_request        # Activity type identifier
  version: 1.0.0                    # Activity version
  config_data:                      # Static configuration
    method: GET
  input_data:                       # Dynamic input parameters
    url: "{{ api_endpoint }}"
  output_name: response             # Store result in variable
  timeout_sec: 30                   # Execution timeout
  max_retry_attempts: 3             # Retry on failure
  enable_cache: true                # Cache result
```

**Parameters:**
- `type`: Activity type identifier (e.g., "builtin.http_request")
- `version`: Activity version (default: "1.0.0")
- `config_data`: Static configuration (evaluated once)
- `input_data`: Dynamic input (evaluated per execution)
- `output_name`: Variable to store activity result
- `output_data`: Transform activity result before storing
- `timeout_sec`: Execution timeout in seconds
- `max_retry_attempts`: Number of retries on failure
- `execute_locally`: Force local execution (bypass Temporal)
- `enable_cache`: Enable result caching
- `cache_policy`: Cache policy configuration

**Example: HTTP request**
```yaml
- activity:
    type: builtin.http_request
    input_data:
      method: POST
      url: https://api.example.com/orders
      headers:
        Content-Type: application/json
      body:
        order_id: "{{ order_id }}"
        total: "{{ total }}"
    output_name: api_response
    timeout_sec: 30
```

**Example: Delay activity**
```yaml
- activity:
    type: builtin.delay
    input_data:
      duration: 5s                  # 5 seconds
```

---

#### 4. Workflow

Executes a child workflow.

```yaml
workflow:
  wfspec:
    name: child-workflow            # Reference by name/version
    version: 1.0.0
  child_mode: sync       # Execution mode
  input_data:                       # Input to child workflow
    param1: "{{ value }}"
  output_name: child_result         # Store child result
```

**Child Modes:**

| Mode | Behavior |
|------|----------|
| `inline` | Child runs in parent's context (shares variables) |
| `sync` | Child runs independently, parent waits for result |
| `async` | Child runs independently, parent waits for start |
| `detached` | Child runs independently, parent doesn't wait |

**Parameters:**
- `wfspec`: Workflow specification
  - `name` + `version`: Reference existing workflow
  - `content`: Inline workflow definition
- `child_mode`: Execution mode (default: "inline")
- `execute_options`: Execution options (workflow_id, task_queue, etc.)
- `input_data`: Input parameters for child
- `output_name`: Variable to store child result
- `output_data`: Transform child result before storing

**Example: Call child workflow by name**
```yaml
- workflow:
    wfspec:
      name: process-order
      version: 2.0.0
    child_mode: sync
    input_data:
      order_id: "{{ order_id }}"
      customer: "{{ customer }}"
    output_name: order_result
```

**Example: Inline child workflow**
```yaml
- workflow:
    wfspec:
      content:
        wfspec_name: inline-child
        wfspec_version: 1.0.0
        input_data:
          x:
        output_name: result
        body:
          transform:
            output_data:
              - result: "{{ x * 2 }}"
    child_mode: inline
    input_data:
      x: 42
    output_name: doubled
```

---

#### 5. Wait For

Waits for an event or timeout.

```yaml
wait_for:
  event:
    topic: order_events              # Event topic to listen to
    match_expression: >              # Filter expression
      {{ event.data.get('order_id') == order_id }}
  timeout_sec: 30                    # Timeout in seconds
  output_name: received_event        # Store received event
```

**Parameters:**
- `event`: Event filter configuration
  - `topic`: Event topic to subscribe to
  - `match_expression`: Python expression to filter events
- `timeout_sec`: Maximum wait time (required)
- `output_name`: Variable to store received event
- `output_data`: Transform event before storing

**Example: Wait for order completion**
```yaml
- wait_for:
    event:
      topic: order_events
      match_expression: >
        {{ event.data.get('order_id') == order_id and
           event.data.get('status') == 'completed' }}
    timeout_sec: 60
    output_name: completion_event
```

**Example: Wait for timeout only**
```yaml
- wait_for:
    timeout_sec: 10                  # Wait 10 seconds
```

---

#### 6. Emit Event

Emits an event to the event bus.

```yaml
emit_event:
  input_data:
    topic: notification_events       # Event topic
    data:                            # Event payload
      message: "Order processed"
      order_id: "{{ order_id }}"
    target_workflow_id: "{{ parent_id }}"  # Optional: target workflow
    metadata:                        # Optional: event metadata
      priority: high
```

**Parameters:**
- `input_data`: Event data
  - `topic`: Event topic (required)
  - `data`: Event payload (required)
  - `target_workflow_id`: Target specific workflow (optional)
  - `metadata`: Additional event metadata (optional)

**Example: Notify parent workflow**
```yaml
- emit_event:
    input_data:
      topic: child_events
      target_workflow_id: "{{ __sys_info__.parent_workflow_id }}"
      data:
        event_name: processing_complete
        result: "{{ processing_result }}"
```

---

### Composite Statements

Composite statements contain and orchestrate other statements.

#### 1. Sequence

Executes statements sequentially (one after another).

```yaml
sequence:
  elements:                          # List of statements
    - transform:
        output_data:
          - step1: "first"
    - transform:
        output_data:
          - step2: "second"
    - transform:
        output_data:
          - step3: "third"
```

**Parameters:**
- `elements`: List of statements to execute in order

**Example: Multi-step process**
```yaml
- sequence:
    name: order-processing
    elements:
      - transform:
          output_data:
            - status: "validating"
      - activity:
          type: builtin.http_request
          input_data:
            url: https://api.example.com/validate
            body: { order_id: "{{ order_id }}" }
          output_name: validation
      - abort:
          condition: "{{ not validation.valid }}"
          type: raise
          message: "Validation failed"
      - transform:
          output_data:
            - status: "processing"
      - activity:
          type: builtin.http_request
          input_data:
            url: https://api.example.com/process
            body: { order_id: "{{ order_id }}" }
          output_name: result
```

---

#### 2. Parallel

Executes statements in parallel with join semantics.

```yaml
parallel:
  join_type: and                     # and (all must succeed) or or (one must succeed)
  elements:                          # List of statements
    - transform:
        output_data:
          - result1: "{{ calc1() }}"
    - transform:
        output_data:
          - result2: "{{ calc2() }}"
    - transform:
        output_data:
          - result3: "{{ calc3() }}"
```

**Parameters:**
- `join_type`: "and" (all must succeed) or "or" (at least one must succeed)
- `elements`: List of statements to execute in parallel

**Example: Parallel API calls**
```yaml
- parallel:
    join_type: and
    elements:
      - activity:
          name: fetch-user
          type: builtin.http_request
          input_data:
            url: https://api.example.com/users/{{ user_id }}
          output_name: user_data
      - activity:
          name: fetch-orders
          type: builtin.http_request
          input_data:
            url: https://api.example.com/orders?user={{ user_id }}
          output_name: order_data
      - activity:
          name: fetch-preferences
          type: builtin.http_request
          input_data:
            url: https://api.example.com/preferences/{{ user_id }}
          output_name: pref_data
```

**Example: OR join (first success wins)**
```yaml
- parallel:
    join_type: or
    elements:
      - activity:
          name: primary-api
          type: builtin.http_request
          input_data:
            url: https://primary.api.com/data
          output_name: api_result
      - activity:
          name: backup-api
          type: builtin.http_request
          input_data:
            url: https://backup.api.com/data
          output_name: api_result
```

---

#### 3. Iteration

Loops over a collection of items.

```yaml
iteration:
  iter_type: sequence                # sequence or parallel
  input_data: "{{ items }}"          # Collection to iterate
  body:                              # Statement to execute per item
    transform:
      output_data:
        - processed: "{{ iter_item }}"
  join_type: and                     # For parallel: and or or
```

**Parameters:**
- `iter_type`: "sequence" (sequential) or "parallel" (concurrent)
- `input_data`: Collection to iterate (list, dict.items(), range(), etc.)
- `body`: Statement to execute for each item
- `join_type`: Join semantics for parallel iteration ("and" or "or")

**Special Variables:**
- `iter_item`: Current item in iteration
- `iter_items`: All items in collection

**Example: Sequential iteration**
```yaml
- iteration:
    iter_type: sequence
    input_data: "{{ range(1, 6) }}"  # [1, 2, 3, 4, 5]
    body:
      sequence:
        elements:
          - transform:
              output_data:
                - current#: "{{ iter_item }}"
          - activity:
              type: builtin.delay
              input_data:
                duration: 1s
```

**Example: Parallel iteration**
```yaml
- iteration:
    iter_type: parallel
    join_type: and
    input_data: "{{ order_ids }}"
    body:
      activity:
        type: process-order
        input_data:
          order_id: "{{ iter_item }}"
        output_name: order_result
```

**Example: Iterate over dictionary**
```yaml
- transform:
    output_data:
      - user_scores: { alice: 95, bob: 87, charlie: 92 }

- iteration:
    iter_type: sequence
    input_data: "{{ user_scores.items() }}"
    body:
      transform:
        output_data:
          - name: "{{ iter_item[0] }}"
          - score: "{{ iter_item[1] }}"
          - grade: >
            {{ 'A' if score >= 90 else 'B' if score >= 80 else 'C' }}
```

**Example: Early break from iteration**
```yaml
- iteration:
    iter_type: sequence
    input_data: "{{ items }}"
    body:
      sequence:
        elements:
          - transform:
              output_data:
                - found: "{{ iter_item }}"
          - abort:
              condition: "{{ iter_item == target }}"
              type: break_iteration
              message: "Found target item"
```

---

## Expression Syntax

Expressions are the core of Moco's dynamic evaluation. They use Python syntax enclosed in `{{ }}` delimiters.

### Basic Expression Syntax

```yaml
# String interpolation
greeting: "Hello, {{ name }}!"

# Full evaluation
total: "{{ price * quantity }}"

# Boolean expression
is_valid: "{{ price > 0 and quantity > 0 }}"

# Complex expression
result: "{{ sum([x * 2 for x in range(10)]) }}"
```

### Expression Types

Expressions can be evaluated in different modes:

#### 1. Python (default)

Standard Python expression evaluation.

```yaml
# Arithmetic
result: "{{ 10 + 20 * 3 }}"          # 70

# String methods
upper: "{{ name.upper() }}"

# List comprehension
squares: "{{ [x**2 for x in range(5)] }}"

# Dictionary access
value: "{{ data['key'] }}"
value: "{{ data.get('key', 'default') }}"
```

#### 2. Python Glom

Path-based data extraction using glom library.

```yaml
# Extract nested value
user_name: "{{ user.profile.name }}"

# With type specification
user_name#python_glom: "user.profile.name"

# Complex glom path
all_names#python_glom: "[users][name]"
```

#### 3. Literal

No evaluation, treat as literal string.

```yaml
# Keep template syntax as-is
template#literal: "{{ this_is_not_evaluated }}"

# Useful for passing templates to other systems
jinja_template#literal: "Hello {{ user_name }}!"
```

#### 4. Jinja2

Jinja2 template evaluation.

```yaml
# Jinja2 template
message#jinja: >
  Dear {{ customer.name }},
  Your order #{{ order.id }} has been {{ order.status }}.
  {% if order.status == 'shipped' %}
  Tracking: {{ order.tracking_number }}
  {% endif %}
```

### Available in Expressions

#### Python Builtins
Whitelisted safe builtins (no `eval`, `exec`, `open`, `__import__`):
- `abs`, `all`, `any`, `bool`, `dict`, `enumerate`, `filter`, `float`, `int`, `len`, `list`, `map`, `max`, `min`, `range`, `reversed`, `round`, `set`, `sorted`, `str`, `sum`, `tuple`, `zip`

#### Libraries
Pre-imported libraries:
```python
import numpy as np
import pandas as pd
import pyarrow as pa
from glom import glom
from bs4 import BeautifulSoup
```

#### Special Variables

| Variable | Description |
|----------|-------------|
| `_` | Root context (all variables) |
| `_raw_output` | Raw output from last statement |
| `iter_item` | Current item in iteration |
| `iter_items` | All items in iteration |
| `__user_info__` | User information object |
| `__sys_info__` | System information (trace_id, tier, workflow_id, parent_workflow_id, etc.) |

**Example: Using special variables**
```yaml
- transform:
    output_data:
      - all_context#: "{{ _ }}"
      - trace_id: "{{ __sys_info__.trace_id }}"
      - workflow_id: "{{ __sys_info__.workflow_id }}"
```

---

## Variable Modifiers

Variable modifiers control how variables are evaluated and stored. They use a special syntax: `variableName[@][#modifier...][#]`

### Modifier Components

| Modifier | Position | Description |
|----------|----------|-------------|
| `@` | After name | Container scope (don't persist to global context) |
| `#python` | After name or `@` | Force Python expression evaluation |
| `#literal` | After name or `@` | Force literal (no evaluation) |
| `#python_glom` | After name or `@` | Force glom path evaluation |
| `#jinja` | After name or `@` | Force Jinja2 template evaluation |
| `#` | Trailing | Debug log value to output |

### Container Scope (`@`)

Variables with `@` are temporary and not saved to global context.

```yaml
- transform:
    output_data:
      - temp@: "{{ compute_expensive() }}"  # Temporary variable
      - result: "{{ temp * 2 }}"            # Can use temp here
      # temp is NOT saved to context after this transform
```

**Use case: Intermediate calculations**
```yaml
- transform:
    output_data:
      - subtotal@: "{{ sum(item_prices) }}"
      - tax@: "{{ subtotal * 0.08 }}"
      - shipping@: "{{ 5.99 if subtotal < 50 else 0 }}"
      - total: "{{ subtotal + tax + shipping }}"
      # Only 'total' is saved to context
```

### Debug Logging (`#`)

Trailing `#` logs the variable value to debug output.

```yaml
- transform:
    output_data:
      - debug_value#: "{{ computation() }}"   # Logs value
      - result: "{{ debug_value * 2 }}"
```

### Force Expression Type

Override default expression evaluation.

```yaml
- transform:
    output_data:
      # Force literal (don't evaluate)
      - template#literal: "{{ user_name }}"

      # Force glom path
      - user_name#python_glom: "user.profile.name"

      # Force Jinja2
      - message#jinja: "Hello {{ name }}!"
```

### Multi-stage Evaluation (`#python#python`)

Chain modifiers for multiple evaluation passes.

```yaml
- transform:
    output_data:
      - var1: "result_var"
      - var2: "{{ var1 }}"                  # "result_var"
      - result_var: 42
      - nested#python#python: "{{ var2 }}"  # First: "{{ var1 }}" -> "result_var"
                                            # Second: "{{ result_var }}" -> 42
```

**Use case: Dynamic variable references**
```yaml
- transform:
    output_data:
      - field_name: "user_email"
      - value#python#python: "{{ field_name }}"  # Gets value of user_email variable
```

### Combined Modifiers

Combine multiple modifiers for complex behavior.

```yaml
- transform:
    output_data:
      # Temporary + debug logging
      - temp@#: "{{ expensive_calc() }}"

      # Container scope + force literal
      - intermediate@#literal: "{{ template }}"

      # Debug + glom + multi-stage
      - extracted#python_glom#python#: "path.to.value"
```

---

## Conditions

Conditions control whether statements execute. They support simple expressions and complex logic.

### Simple Condition

Single boolean expression.

```yaml
- transform:
    condition: "{{ price > 100 }}"
    output_data:
      - discount: "{{ price * 0.1 }}"
```

### OR Condition

Execute if any condition is true.

```yaml
- transform:
    condition:
      - or:
          - "{{ price > 100 }}"
          - "{{ customer.is_premium }}"
          - "{{ coupon_code != '' }}"
    output_data:
      - eligible_for_discount: true
```

### AND Condition

Execute if all conditions are true.

```yaml
- transform:
    condition:
      - and:
          - "{{ price > 0 }}"
          - "{{ quantity > 0 }}"
          - "{{ inventory >= quantity }}"
    output_data:
      - can_process: true
```

### NOT Condition

Execute if condition is false.

```yaml
- abort:
    condition:
      - not: "{{ user.is_verified }}"
    type: raise
    message: "User not verified"
```

### Nested Conditions

Combine AND/OR/NOT for complex logic.

```yaml
- transform:
    condition:
      - or:
          - "{{ price > 1000 }}"
          - and:
              - "{{ customer.is_premium }}"
              - "{{ customer.loyalty_points > 500 }}"
          - and:
              - "{{ coupon_code == 'SPECIAL' }}"
              - not: "{{ used_special_offer }}"
    output_data:
      - apply_special_pricing: true
```

**Example: Complex validation**
```yaml
- abort:
    condition:
      - or:
          - "{{ price < 0 }}"
          - "{{ quantity < 1 }}"
          - and:
              - "{{ payment_method == 'credit_card' }}"
              - not: "{{ credit_card.is_valid }}"
    type: raise
    message: "Order validation failed"
```

---

## Activities

Activities are external functions or services executed by the workflow. They are registered with the engine and invoked by type identifier.

### Built-in Activities

#### Delay Activity

```yaml
- activity:
    type: builtin.delay
    input_data:
      duration: 5s                   # 5 seconds
```

#### HTTP Request Activity

```yaml
- activity:
    type: builtin.http_request
    input_data:
      method: GET
      url: https://api.example.com/data
      headers:
        Authorization: "Bearer {{ token }}"
      params:
        limit: 10
        offset: 0
    output_name: api_response
    timeout_sec: 30
    max_retry_attempts: 3
```

**POST request with JSON body**
```yaml
- activity:
    type: builtin.http_request
    input_data:
      method: POST
      url: https://api.example.com/orders
      headers:
        Content-Type: application/json
      body:
        order_id: "{{ order_id }}"
        items: "{{ items }}"
        total: "{{ total }}"
    output_name: create_response
```

### Activity Configuration

#### Static vs Dynamic Parameters

- `config_data`: Static configuration (evaluated once at workflow start)
- `input_data`: Dynamic input (evaluated each time activity runs)

```yaml
- activity:
    type: custom.data_processor
    config_data:                     # Static: API endpoint, credentials
      endpoint: https://processor.example.com
      api_key: "{{ env.API_KEY }}"
    input_data:                      # Dynamic: per-execution data
      data: "{{ current_batch }}"
      options:
        format: json
    output_name: processed_data
```

#### Retry and Timeout

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://unreliable-api.com/data
    timeout_sec: 10                  # Timeout per attempt
    max_retry_attempts: 5            # Total attempts (initial + retries)
    output_name: result
```

#### Caching

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://api.example.com/reference-data
    enable_cache: true               # Enable result caching
    cache_policy:
      ttl_seconds: 3600              # Cache for 1 hour
      cache_key: "reference_data_{{ date }}"
    output_name: cached_data
```

#### Local Execution

Force activity to run locally (bypass Temporal worker).

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: http://localhost:8080/internal
    execute_locally: true            # Run in workflow process
    output_name: local_result
```

### Custom Activities

Custom activities are registered with the engine via activity providers.

**Example: Custom activity invocation**
```yaml
- activity:
    type: myorg.send_email
    version: 2.0.0
    config_data:
      smtp_host: smtp.example.com
      smtp_port: 587
    input_data:
      to: "{{ customer.email }}"
      subject: "Order Confirmation #{{ order_id }}"
      body: "{{ email_body }}"
      attachments:
        - "{{ invoice_pdf }}"
    output_name: email_result
    timeout_sec: 30
```

---

## State Machines

State machines enable event-driven workflows with explicit states and transitions.

### Basic State Machine

```yaml
state_machine:
  name: order-fsm
  initial_state: pending
  timeout_sec: 300                   # Overall timeout

  states:
    - name: pending
      on_enter:
        transform:
          output_data:
            - status#: pending

    - name: processing
      timeout_sec: 60                # State-specific timeout
      on_enter:
        activity:
          type: process-order
          input_data:
            order_id: "{{ order_id }}"
          output_name: process_result

    - name: completed
      is_terminal: true              # End state
      on_enter:
        transform:
          output_data:
            - status#: completed

    - name: failed
      is_terminal: true
      on_enter:
        transform:
          output_data:
            - status#: failed

  transitions:
    - from_state: pending
      to_state: processing
      trigger:
        event_name: start_processing

    - from_state: processing
      to_state: completed
      trigger:
        event_name: processing_complete

    - from_state: processing
      to_state: failed
      trigger:
        event_name: processing_failed
```

### State Configuration

#### State Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique state identifier |
| `is_terminal` | boolean | Mark as end state |
| `timeout_sec` | integer | State-specific timeout |
| `on_enter` | statement | Execute when entering state |
| `on_exit` | statement | Execute when exiting state |

#### State Callbacks

```yaml
states:
  - name: processing
    on_enter:                        # Runs when entering state
      sequence:
        elements:
          - transform:
              output_data:
                - entered_at: "{{ __sys_info__.timestamp }}"
          - emit_event:
              input_data:
                topic: state_events
                data:
                  state: processing

    on_exit:                         # Runs when leaving state
      transform:
        output_data:
          - exited_at: "{{ __sys_info__.timestamp }}"
```

### Transitions

Transitions define how the state machine moves between states.

#### Basic Transition

```yaml
transitions:
  - from_state: pending
    to_state: approved
    trigger:
      event_name: approve
```

#### Transition with Condition

```yaml
transitions:
  - from_state: pending
    to_state: processing
    trigger:
      event_name: start_processing
      condition:
        - and:
            - "{{ event.data.get('price') > 0 }}"
            - "{{ event.data.get('inventory_available') == true }}"
```

#### Multiple Transitions from Same State

```yaml
transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_name: success

  - from_state: processing
    to_state: failed
    trigger:
      event_name: error

  - from_state: processing
    to_state: pending
    trigger:
      event_name: retry
```

### Global Triggers

Transitions that apply from any state.

```yaml
state_machine:
  name: order-fsm
  initial_state: pending

  global_triggers:
    - to_state: cancelled             # From any state
      trigger:
        event_name: cancel

    - to_state: failed
      trigger:
        event_name: critical_error

  states:
    - name: pending
    - name: processing
    - name: cancelled
      is_terminal: true
    - name: failed
      is_terminal: true
```

### Event Source Configuration

Specify event topic for state machine events.

```yaml
state_machine:
  name: order-fsm
  event_source_topic: order_events   # Listen to this topic
  initial_state: pending

  states:
    - name: pending

  transitions:
    - from_state: pending
      to_state: processing
      trigger:
        event_name: start              # Listen for "start" event on order_events topic
```

### Complete State Machine Example

```yaml
body:
  sequence:
    elements:
      # Initialize order
      - transform:
          output_data:
            - order_id: "{{ input.order_id }}"
            - order_data: "{{ input.order_data }}"

      # Run state machine
      - state_machine:
          name: order-processor
          initial_state: validating
          timeout_sec: 600
          event_source_topic: order_events

          states:
            - name: validating
              timeout_sec: 30
              on_enter:
                sequence:
                  elements:
                    - transform:
                        output_data:
                          - status: validating
                    - activity:
                        type: validate-order
                        input_data:
                          order: "{{ order_data }}"
                        output_name: validation_result
                    - emit_event:
                        input_data:
                          topic: order_events
                          data:
                            event_name: "{{ 'validated' if validation_result.valid else 'validation_failed' }}"
                            order_id: "{{ order_id }}"

            - name: processing
              timeout_sec: 120
              on_enter:
                sequence:
                  elements:
                    - transform:
                        output_data:
                          - status: processing
                    - activity:
                        type: process-payment
                        input_data:
                          order: "{{ order_data }}"
                        output_name: payment_result
                    - emit_event:
                        input_data:
                          topic: order_events
                          data:
                            event_name: "{{ 'payment_complete' if payment_result.success else 'payment_failed' }}"
                            order_id: "{{ order_id }}"

            - name: fulfilling
              timeout_sec: 300
              on_enter:
                sequence:
                  elements:
                    - transform:
                        output_data:
                          - status: fulfilling
                    - activity:
                        type: create-shipment
                        input_data:
                          order: "{{ order_data }}"
                        output_name: shipment_result
                    - emit_event:
                        input_data:
                          topic: order_events
                          data:
                            event_name: fulfilled
                            order_id: "{{ order_id }}"
                            tracking: "{{ shipment_result.tracking_number }}"

            - name: completed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - status: completed
                    - completed_at: "{{ __sys_info__.timestamp }}"

            - name: failed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - status: failed
                    - failed_at: "{{ __sys_info__.timestamp }}"

          transitions:
            - from_state: validating
              to_state: processing
              trigger:
                event_name: validated

            - from_state: validating
              to_state: failed
              trigger:
                event_name: validation_failed

            - from_state: processing
              to_state: fulfilling
              trigger:
                event_name: payment_complete

            - from_state: processing
              to_state: failed
              trigger:
                event_name: payment_failed

            - from_state: fulfilling
              to_state: completed
              trigger:
                event_name: fulfilled

          global_triggers:
            - to_state: failed
              trigger:
                event_name: cancel
```

---

## Events

Moco supports event-driven workflows with `wait_for` and `emit_event` statements.

### Emit Event

Send events to the event bus.

```yaml
- emit_event:
    input_data:
      topic: notifications             # Event topic
      data:                            # Event payload
        type: order_created
        order_id: "{{ order_id }}"
        timestamp: "{{ __sys_info__.timestamp }}"
```

#### Target Specific Workflow

```yaml
- emit_event:
    input_data:
      topic: child_events
      target_workflow_id: "{{ parent_workflow_id }}"
      data:
        event_name: child_complete
        result: "{{ processing_result }}"
```

#### Event Metadata

```yaml
- emit_event:
    input_data:
      topic: analytics_events
      data:
        action: page_view
        page: "/products"
      metadata:
        priority: low
        source: web_app
```

### Wait For Event

Wait for events matching criteria.

```yaml
- wait_for:
    event:
      topic: order_events
      match_expression: "{{ event.data.get('order_id') == order_id }}"
    timeout_sec: 60
    output_name: received_event
```

#### Event Structure

Events received by `wait_for` have this structure:

```python
{
  "data": {...},              # Event payload
  "topic": "...",             # Event topic
  "source_workflow_id": "...", # Source workflow
  "metadata": {...}           # Event metadata
}
```

#### Event Filtering

```yaml
- wait_for:
    event:
      topic: payment_events
      match_expression: >
        {{ event.data.get('transaction_id') == transaction_id and
           event.data.get('status') == 'completed' }}
    timeout_sec: 120
    output_name: payment_event
```

### Multi-Agent Pattern

Coordinate multiple workflows with events.

**Parent Workflow:**
```yaml
wfspec_name: parent-orchestrator
wfspec_version: 1.0.0

context:
  child_workflow_ids: []

body:
  sequence:
    elements:
      # Start child workflows
      - iteration:
          iter_type: parallel
          input_data: "{{ agent_configs }}"
          body:
            sequence:
              elements:
                - workflow:
                    wfspec:
                      name: child-agent
                      version: 1.0.0
                    child_mode: async
                    execute_options:
                      workflow_id: "child-{{ iter_item.agent_id }}"
                    input_data:
                      config: "{{ iter_item }}"
                      parent_workflow_id: "{{ __sys_info__.workflow_id }}"
                    output_name: child_info
                - transform:
                    output_data:
                      - _tmp: "{{ child_workflow_ids.append(child_info.workflow_id) }}"

      # Wait for all children to complete
      - iteration:
          iter_type: sequence
          input_data: "{{ child_workflow_ids }}"
          body:
            wait_for:
              event:
                topic: child_events
                match_expression: >
                  {{ event.data.get('event_name') == 'complete' and
                     event.source_workflow_id == iter_item }}
              timeout_sec: 300
              output_name: child_result
```

**Child Workflow:**
```yaml
wfspec_name: child-agent
wfspec_version: 1.0.0

input_data:
  config:
  parent_workflow_id:

body:
  sequence:
    elements:
      # Do work
      - activity:
          type: process-data
          input_data:
            config: "{{ config }}"
          output_name: result

      # Notify parent
      - emit_event:
          input_data:
            topic: child_events
            target_workflow_id: "{{ parent_workflow_id }}"
            data:
              event_name: complete
              result: "{{ result }}"
```

---

## Child Workflows

Execute workflows within workflows with different execution modes.

### Nested Mode

Child runs in parent's context (shares variables).

```yaml
- workflow:
    wfspec:
      name: calculate-tax
      version: 1.0.0
    child_mode: inline              # Shares parent context
    input_data:
      price: "{{ item_price }}"
    output_name: tax_amount
```

**Use case:** Reusable logic that needs access to parent variables.

### Break Away Sync

Child runs independently, parent waits for completion.

```yaml
- workflow:
    wfspec:
      name: process-order
      version: 1.0.0
    child_mode: sync     # Independent, synchronous
    input_data:
      order_id: "{{ order_id }}"
      items: "{{ cart_items }}"
    output_name: order_result
```

**Use case:** Long-running child that shouldn't block other workflows, but parent needs result.

### Break Away Async

Child runs independently, parent waits for start only.

```yaml
- workflow:
    wfspec:
      name: send-notifications
      version: 1.0.0
    child_mode: async    # Independent, async
    input_data:
      recipients: "{{ email_list }}"
      message: "{{ notification_body }}"
    output_name: workflow_info      # Contains workflow_id, not result
```

**Use case:** Fire-and-forget background tasks where you need workflow ID but not result.

### Break Away Detached

Child runs completely independently.

```yaml
- workflow:
    wfspec:
      name: analytics-job
      version: 1.0.0
    child_mode: detached # Independent, detached
    input_data:
      data: "{{ analytics_data }}"
```

**Use case:** Background tasks where parent doesn't care about workflow ID or result.

### Inline Child Workflow

Define workflow inline instead of by reference.

```yaml
- workflow:
    wfspec:
      content:
        wfspec_name: inline-calculator
        wfspec_version: 1.0.0
        input_data:
          x:
          y:
        output_name: sum
        body:
          transform:
            output_data:
              - sum: "{{ x + y }}"
    child_mode: inline
    input_data:
      x: 10
      y: 20
    output_name: result              # 30
```

### Execution Options

Customize child workflow execution.

```yaml
- workflow:
    wfspec:
      name: data-processor
      version: 1.0.0
    child_mode: sync
    execute_options:
      workflow_id: "data-proc-{{ batch_id }}"  # Custom workflow ID
      task_queue: high-priority                # Custom task queue
      execution_timeout_sec: 3600              # Overall timeout
      run_timeout_sec: 1800                    # Single run timeout
    input_data:
      batch_id: "{{ batch_id }}"
      data: "{{ batch_data }}"
    output_name: processed_data
```

### Parent-Child Communication

Children can access parent workflow ID and communicate via events.

**Parent:**
```yaml
- workflow:
    wfspec:
      name: child-worker
      version: 1.0.0
    child_mode: async
    execute_options:
      workflow_id: "worker-{{ task_id }}"
    input_data:
      task: "{{ task_data }}"
      parent_id: "{{ __sys_info__.workflow_id }}"
    output_name: worker_info

- wait_for:
    event:
      topic: worker_events
      match_expression: >
        {{ event.source_workflow_id == worker_info.workflow_id and
           event.data.get('status') == 'complete' }}
    timeout_sec: 300
    output_name: completion_event
```

**Child:**
```yaml
body:
  sequence:
    elements:
      - activity:
          type: process-task
          input_data:
            task: "{{ task }}"
          output_name: result

      - emit_event:
          input_data:
            topic: worker_events
            target_workflow_id: "{{ parent_id }}"
            data:
              status: complete
              result: "{{ result }}"
```

---

## Complete Examples

### Example 1: E-commerce Order Processing

```yaml
wfspec_name: order-processing
wfspec_version: 1.0.0

context:
  status: pending
  order_total: 0
  tax_amount: 0

input_data:
  order_id:
  customer_id:
  items:
  payment_info:

output_name: order_result

body:
  sequence:
    elements:
      # Validate order
      - transform:
          name: validate-order
          condition:
            - and:
                - "{{ len(items) > 0 }}"
                - "{{ customer_id != '' }}"
          output_data:
            - status: validating

      - abort:
          condition:
            - not:
                - "{{ len(items) > 0 }}"
          type: raise
          message: "Order must contain at least one item"

      # Calculate totals in parallel
      - parallel:
          name: calculate-totals
          join_type: and
          elements:
            - transform:
                name: calculate-subtotal
                output_data:
                  - subtotal: "{{ sum([item['price'] * item['quantity'] for item in items]) }}"

            - transform:
                name: calculate-tax
                output_data:
                  - tax_amount: "{{ subtotal * 0.08 if 'subtotal' in _ else 0 }}"

            - activity:
                name: check-inventory
                type: inventory.check
                input_data:
                  items: "{{ items }}"
                output_name: inventory_check

      - abort:
          condition: "{{ not inventory_check.available }}"
          type: raise
          message: "Insufficient inventory"

      - transform:
          output_data:
            - order_total: "{{ subtotal + tax_amount }}"
            - status: processing

      # Process payment
      - activity:
          name: charge-payment
          type: payment.charge
          input_data:
            amount: "{{ order_total }}"
            payment_info: "{{ payment_info }}"
            customer_id: "{{ customer_id }}"
          timeout_sec: 30
          max_retry_attempts: 3
          output_name: payment_result

      - abort:
          condition: "{{ not payment_result.success }}"
          type: raise
          message: "Payment failed: {{ payment_result.error }}"

      - transform:
          output_data:
            - transaction_id: "{{ payment_result.transaction_id }}"
            - status: paid

      # Create shipment
      - activity:
          name: create-shipment
          type: shipping.create
          input_data:
            order_id: "{{ order_id }}"
            items: "{{ items }}"
            customer_id: "{{ customer_id }}"
          output_name: shipment_result

      - transform:
          output_data:
            - tracking_number: "{{ shipment_result.tracking_number }}"
            - status: shipped

      # Send notifications in parallel
      - parallel:
          name: send-notifications
          join_type: and
          elements:
            - activity:
                type: notification.email
                input_data:
                  to: "{{ customer_email }}"
                  template: order_confirmation
                  data:
                    order_id: "{{ order_id }}"
                    tracking: "{{ tracking_number }}"
                    total: "{{ order_total }}"

            - activity:
                type: notification.sms
                input_data:
                  to: "{{ customer_phone }}"
                  message: "Your order {{ order_id }} has shipped. Track at: {{ tracking_url }}"

      # Finalize
      - transform:
          output_data:
            - status: completed
            - order_result:
                order_id: "{{ order_id }}"
                status: "{{ status }}"
                total: "{{ order_total }}"
                tracking: "{{ tracking_number }}"
                transaction_id: "{{ transaction_id }}"
```

### Example 2: Data Pipeline with Iteration

```yaml
wfspec_name: data-processing-pipeline
wfspec_version: 1.0.0

context:
  processed_count: 0
  failed_count: 0
  results: []

input_data:
  data_source:
  batch_size: 100

output_name: pipeline_result

body:
  sequence:
    elements:
      # Fetch data
      - activity:
          name: fetch-data
          type: data.fetch
          input_data:
            source: "{{ data_source }}"
            limit: 1000
          output_name: raw_data

      # Split into batches
      - transform:
          name: create-batches
          output_data:
            - batches: "{{ [raw_data.records[i:i+batch_size] for i in range(0, len(raw_data.records), batch_size)] }}"

      # Process batches in parallel
      - iteration:
          name: process-batches
          iter_type: parallel
          join_type: and
          input_data: "{{ enumerate(batches) }}"
          body:
            sequence:
              elements:
                - transform:
                    output_data:
                      - batch_index: "{{ iter_item[0] }}"
                      - batch_data: "{{ iter_item[1] }}"
                      - batch_id#: "batch-{{ batch_index }}"

                # Process each record in batch sequentially
                - iteration:
                    iter_type: sequence
                    input_data: "{{ batch_data }}"
                    body:
                      sequence:
                        elements:
                          - activity:
                              type: data.transform
                              input_data:
                                record: "{{ iter_item }}"
                              output_name: transformed
                              max_retry_attempts: 2

                          - activity:
                              type: data.validate
                              input_data:
                                record: "{{ transformed }}"
                              output_name: validated

                          - transform:
                              condition: "{{ validated.is_valid }}"
                              output_data:
                                - _tmp: "{{ results.append(transformed) }}"
                                - _count@: "{{ processed_count + 1 }}"
                                - processed_count: "{{ _count }}"

                          - transform:
                              condition: "{{ not validated.is_valid }}"
                              output_data:
                                - _count@: "{{ failed_count + 1 }}"
                                - failed_count: "{{ _count }}"
                                - _log#: "Failed validation: {{ validated.errors }}"

      # Store results
      - activity:
          name: store-results
          type: data.store
          input_data:
            records: "{{ results }}"
            destination: "{{ data_source }}_processed"
          output_name: store_result

      # Create summary
      - transform:
          output_data:
            - pipeline_result:
                total_records: "{{ len(raw_data.records) }}"
                processed: "{{ processed_count }}"
                failed: "{{ failed_count }}"
                batches: "{{ len(batches) }}"
                success_rate: "{{ (processed_count / len(raw_data.records) * 100) if len(raw_data.records) > 0 else 0 }}"
```

### Example 3: Multi-Agent Orchestration

```yaml
wfspec_name: multi-agent-orchestrator
wfspec_version: 1.0.0

context:
  agent_results: {}
  all_agents_complete: false

input_data:
  task_description:
  agent_configs:
    - agent_id: analyzer
      type: data-analysis
      priority: 1
    - agent_id: processor
      type: data-processing
      priority: 2
    - agent_id: reporter
      type: report-generation
      priority: 3

output_name: orchestration_result

body:
  sequence:
    elements:
      # Start all agents
      - iteration:
          iter_type: parallel
          join_type: and
          input_data: "{{ agent_configs }}"
          body:
            workflow:
              wfspec:
                name: agent-worker
                version: 1.0.0
              child_mode: async
              execute_options:
                workflow_id: "agent-{{ iter_item['agent_id'] }}-{{ __sys_info__.workflow_id }}"
              input_data:
                agent_id: "{{ iter_item['agent_id'] }}"
                config: "{{ iter_item }}"
                task: "{{ task_description }}"
                orchestrator_id: "{{ __sys_info__.workflow_id }}"
              output_name: agent_info

      # Monitor agent progress
      - state_machine:
          name: agent-coordinator
          initial_state: waiting
          timeout_sec: 600
          event_source_topic: agent_events

          states:
            - name: waiting
              on_enter:
                transform:
                  output_data:
                    - coordination_status: waiting_for_agents

            - name: processing
              on_enter:
                transform:
                  output_data:
                    - coordination_status: agents_processing

            - name: completed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - all_agents_complete: true
                    - coordination_status: all_complete

          transitions:
            - from_state: waiting
              to_state: processing
              trigger:
                event_name: agent_started
                condition:
                  - "{{ event.data.get('agent_id') in [a['agent_id'] for a in agent_configs] }}"

            - from_state: processing
              to_state: processing
              trigger:
                event_name: agent_progress
                condition:
                  - "{{ event.data.get('agent_id') != '' }}"

            - from_state: processing
              to_state: completed
              trigger:
                event_name: agent_complete
                condition:
                  - "{{ len(agent_results) == len(agent_configs) }}"

          global_triggers:
            - to_state: failed
              trigger:
                event_name: agent_failed

      # Aggregate results
      - transform:
          output_data:
            - orchestration_result:
                task: "{{ task_description }}"
                agents: "{{ len(agent_configs) }}"
                results: "{{ agent_results }}"
                status: "{{ coordination_status }}"
```

**Agent Worker Workflow:**
```yaml
wfspec_name: agent-worker
wfspec_version: 1.0.0

input_data:
  agent_id:
  config:
  task:
  orchestrator_id:

output_name: agent_result

body:
  sequence:
    elements:
      # Notify start
      - emit_event:
          input_data:
            topic: agent_events
            target_workflow_id: "{{ orchestrator_id }}"
            data:
              event_name: agent_started
              agent_id: "{{ agent_id }}"

      # Do work
      - activity:
          type: "{{ config['type'] }}"
          input_data:
            task: "{{ task }}"
            config: "{{ config }}"
          timeout_sec: 300
          output_name: work_result

      # Send progress
      - emit_event:
          input_data:
            topic: agent_events
            target_workflow_id: "{{ orchestrator_id }}"
            data:
              event_name: agent_progress
              agent_id: "{{ agent_id }}"
              progress: 50

      # Finalize
      - transform:
          output_data:
            - agent_result:
                agent_id: "{{ agent_id }}"
                result: "{{ work_result }}"
                status: complete

      # Notify completion
      - emit_event:
          input_data:
            topic: agent_events
            target_workflow_id: "{{ orchestrator_id }}"
            data:
              event_name: agent_complete
              agent_id: "{{ agent_id }}"
              result: "{{ agent_result }}"
```

---

## Best Practices

### 1. Variable Naming

- Use descriptive names: `customer_email` not `ce`
- Use snake_case for consistency
- Use `@` suffix for temporary variables
- Use `#` suffix for debug logging

### 2. Error Handling

```yaml
# Validate inputs early
- abort:
    condition:
      - or:
          - "{{ price < 0 }}"
          - "{{ quantity < 1 }}"
    type: raise
    message: "Invalid input: price={{ price }}, quantity={{ quantity }}"

# Use retries for unreliable operations
- activity:
    type: external.api
    input_data:
      url: "{{ endpoint }}"
    timeout_sec: 10
    max_retry_attempts: 3
    output_name: result
```

### 3. Performance

```yaml
# Use parallel for independent operations
- parallel:
    join_type: and
    elements:
      - activity:
          type: fetch.users
          output_name: users
      - activity:
          type: fetch.products
          output_name: products
      - activity:
          type: fetch.orders
          output_name: orders

# Use container scope to avoid saving unnecessary data
- transform:
    output_data:
      - large_dataset@: "{{ load_data() }}"      # Don't save
      - summary: "{{ compute_summary(large_dataset) }}"  # Save only summary
```

### 4. Modularity

```yaml
# Extract reusable logic into child workflows
- workflow:
    wfspec:
      name: calculate-shipping
      version: 1.0.0
    child_mode: inline
    input_data:
      weight: "{{ total_weight }}"
      destination: "{{ shipping_address }}"
    output_name: shipping_cost
```

### 5. Debugging

```yaml
# Use debug logging
- transform:
    output_data:
      - input_data#: "{{ input }}"              # Log input
      - intermediate@#: "{{ step1() }}"         # Log temp value
      - result#: "{{ final_calc(intermediate) }}" # Log result

# Use meaningful names
- activity:
    name: fetch-customer-data                   # Not "step1"
    type: api.get
    input_data:
      endpoint: /customers/{{ customer_id }}
```

### 6. State Management

```yaml
# Use state machines for complex flows
state_machine:
  name: order-lifecycle
  initial_state: created
  states:
    - name: created
    - name: validated
    - name: paid
    - name: shipped
    - name: delivered
      is_terminal: true
```

---

## Schema Validation

Workflowspecs can be validated against the JSON schema located at:
`.github/workflowspec_schema.json`

Use the schema for:
- IDE auto-completion
- Pre-submission validation
- CI/CD pipeline checks
- Documentation generation

---

## Additional Resources

- **README:** `moco-core/README.md` - Core engine documentation
- **Examples:** `moco-tools/sample-*.yaml` - Sample workflowspecs
- **Tests:** `moco-core/tests/` - Unit and integration tests
- **Schema:** `.github/workflowspec_schema.json` - JSON schema for validation
- **CLAUDE.md:** Project-level guide and architecture overview

---

## Appendix: Quick Reference

### Statement Types Summary

| Statement | Category | Purpose |
|-----------|----------|---------|
| `transform` | Primitive | Data transformation |
| `abort` | Primitive | Workflow termination |
| `activity` | Primitive | External function execution |
| `workflow` | Primitive | Child workflow execution |
| `wait_for` | Primitive | Event waiting |
| `emit_event` | Primitive | Event emission |
| `sequence` | Composite | Sequential execution |
| `parallel` | Composite | Parallel execution |
| `iteration` | Composite | Looping |
| `state_machine` | Composite | Event-driven FSM |

### Expression Types

| Type | Syntax | Purpose |
|------|--------|---------|
| Python | `{{ expr }}` | Python evaluation |
| Glom | `var#python_glom` | Path-based extraction |
| Literal | `var#literal` | No evaluation |
| Jinja2 | `var#jinja` | Template rendering |

### Variable Modifiers

| Modifier | Purpose |
|----------|---------|
| `@` | Container scope (temporary) |
| `#python` | Force Python evaluation |
| `#literal` | Force literal |
| `#python_glom` | Force glom |
| `#jinja` | Force Jinja2 |
| `#` (trailing) | Debug logging |

### Child Workflow Modes

| Mode | Wait Behavior | Context Sharing |
|------|---------------|-----------------|
| `inline` | Wait for completion | Shared |
| `sync` | Wait for completion | Isolated |
| `async` | Wait for start | Isolated |
| `detached` | Don't wait | Isolated |
