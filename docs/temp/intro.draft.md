---
sidebar_position: 1
---

# Moco Overview

## What is Moco

**Moco is a cloud-based business workflow platform allowing users to build, compose and release workflows freely**.

**Moco offers abstract workflow spec and a virtual execution runtime**

* yaml-DSL
- Moco uses yaml-based DSL to build workflow specs
- Moco fully decouples workflows from underneath runtime platform, by using yaml-based DSL to express workflow logic.
- focus on business logic and data contract instead of implementation details
- is more concise and easy to undertand
- Moco DSL allows you to use a combination of **imperative steps**, **state machine**, **rules engine**, and composable child workflows to build complex workflows for various use cases

Moco is a virtual workflow runtime platform
- virtual exectuion without physical life time limitation.

**Durability**
Durable and scalable workflow platform for enterprise level solution
not bounded to physical machine life time, workflow execution can surive from machine crash and turnaround.

By default Moco runs on top of Temporalio - in this mode workflows are executed in distributed cloud environment with durability guarantee.
Moco uses the Open Source Temporalio to provide durable workflow execution out of the box, but the complexity of distributed execution and state management are abstracted away from moco developers.

Unlike the common `checkpoint`-based approach for distributed state management (like Langraph), which requires explicit state management logic in workflow, Temporalio's unqique way of capturing/restoring states through IO event history is systematic and provides an application agnostic way for state menagement.

Moco took an extra step further and hide the implemetation complexity from end users
- moco allows end users to write abstract workflow spec using yaml-based DSL, and provide a virtual execution runtime platform with dual modes.
distribute workflow mode - take advantage of the distributed state management and durability guarantee
in-memory mode -
Moco achieved this by binding the DSL engine with the Temporalio platform, through a thin intergration layer on top of its activity dispatcher. Alternatively, the moco workflow engine can directly run in-memory mode without any dependency on temporal.


**Workflow Deployment**
Moco allows workflows to be developped, released and managed fully in the hand of the business users, without the need of engineering involvement and heavy-lifting backend deployment.
Moco workflows can be developed and released instantly by business users without heavy-lifting backend deployment.
Moco workflow owners have full control of their workflows and can manage the workflow lifecycle through web console or cli tool.

## Key Features

* **Ability to express complex workflow logic**
  - **imperative statements** with condition, parallel, loop, dynamic expression and text templating support
    - allow embedding Python expressions for complex data manipulation, with Pandas and Jinja2
  - **event-driven state machine model**
  - **declarative rules engine model**
  - support **cross-workflow communinication**

* **compsability**
  - support flexible workflow composability, users can compose complex Moco workflows from workflows in multiple ways

* support **complex and long-running workflow** use cases, with durability gurrantee
  - workflow for durable subscription and publishing
  - **man-in-the-loop workflow**
  - support **multi-agents AI workflow**

* support **multi-mode execution**
  - **distrubuted workflow mode** provides full durability and scalability, for complex and long runnning workflows
  - **standalone activity modo** for high-level durability with distributed runtime
  - **in-memory excution mode** for low-latency micro-service and desktop deployment

* **flexible workflow release and sharing**
  - dynamic versioning, access control, multi-stage release (in self-host)
  - Unlike other engineering-oriented workflow platforms that require heavy-lifting backend deployment for workflow changes, Moco is a business workflow platform that allows user-owned workflows to be deployed separately from the runtime platform. Moco users can deploy their workflows on demand through cli or web console. Moco supports flexible workflow versioning, permission control, and targetting so that workflows can easily shared and composed

* Moco is a complete and **interoperable** platform
  - API layer (fastapi, mcp) cli tool, management console
  - extensible for connecting other systems
  - easy to be connected and be part of exteral systems


---
## Quick Eaxmples

* simple multi-step workflow
Here's a simple workflow that processes an order:

```yaml
wfspec_name: process-order
wfspec_version: 1.0.0

input_data:
  order_id:
  items:
  customer_email:

output_name: result

body:
  sequence:
    elements:
      # Calculate total
      - transform:
          output_data:
            - total: "{{ sum([item['price'] for item in items]) }}"

      # Process payment - child workflow
      - workflow:
          wfspec:
            name: payment-charge
          child_mode: sync
          input_data:
            amount: "{{ total }}"
          output_name: payment_result

      # Send confirmation
      - activity:
          type: email.send
          input_data:
            to: "{{ customer_email }}"
            subject: "Order Confirmation"
            body: "Your order {{ order_id }} has been processed!"

      - transform:
          output_data:
            - result:
                order_id: "{{ order_id }}"
                total: "{{ total }}"
                status: completed
```

* human-in-the-loop approval workflow using state machine

```yaml
wfspec_name: state-machine-basics-demo
context:
  history: []
  score: 0

input_data:
  quality_score: 80
  approval_threshold: 70

output_data:
  final_state: '{{final_state}}'

body:
  state_machine:
    initial_state: draft
    output_name: final_state
    states:
      - name: draft
        timers:
          - name: reminder
            timeout_sec: 86400 # 1d
            max_timeout_attempts: 3
      - name: in_review
        on_enter:
          transform:
            output_data:
              - score: '{{quality_score}}' # simulate a score using input data
      - name: approved
        is_terminal: true
        on_enter:
          activity:
            type: email.send
            input_data:
              subject: your submission has been approved
              # other args omitted for similicity
      - name: rejected
        is_terminal: true
        on_enter:
            type: email.send
            input_data:
              subject: your submission has been rejected
              # other args omitted for similicity
      - name: cancelled
        is_terminal: true

    transitions:
      # timer driven transitions
      - from_state: draft
        to_state: # no state transition
        trigger:
          event_type: sys.timer.reminder
          ation:
            activity:
              type: email.send
              input_data:
                subject: reminder for your draft
                # other args omitted for similicity
      - from_state: draft
        to_state: cancelled
        trigger:
          event_type: sys.timer.reminder.final

      # transition triggered from external event, upon user action (human in the loop)
      - from_state: draft
        to_state: in_review
        trigger:
          event_type: submit # user submit the draft

      # automatic transition (when trigger.event_type is null)
      - from_state: in_review
        to_state: approved
        trigger:
          condition: '{{ score >= approval_threshold }}'
      - from_state: in_review
        to_state: rejected
        trigger:
          condition: '{{ score < approval_threshold }}'

```
