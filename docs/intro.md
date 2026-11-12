---
sidebar_position: 1
slug: /
---

# Moco Overview

Business workflows are open ended, change often, and belong to the people who run the process — not
the people who run the platform. How to build a generic business workflow platform that can release
a workflow change without an engineering cycle, and let existing logic be shared and reused to
compose new workflows, is a big challenge.

**Moco is a cloud-based business workflow platform that lets you build, compose, and release
workflows freely.**

It gives you three things: an **abstract workflow spec** that expresses imperative, event-driven,
and rule-based logic in one language; a **virtual execution runtime** that runs it durably while
hiding the distributed-state machinery; and an **agile way to deploy workflows** — released as data,
on demand, independently of the runtime platform.

## What is Moco

### A Low Code YAML DSL

Moco workflows are written in a YAML-based DSL called a **workflowspec** (or **wfspec**).

- The DSL fully decouples your workflow from the underlying runtime platform — the spec expresses
  business logic and data contracts, not implementation details.
- Specs are concise and readable, so they stay reviewable by the people who own the process.
- A single wfspec can mix **imperative tasks**, an event-driven **state machine**, a declarative
  **rules engine**, and composable **child workflows**, so one language covers a wide range of
  use cases.
- Python expressions can be embedded anywhere in `{{ }}` for dynamic data manipulation, with
  Pandas and Jinja2 available for transformation and templating.

### A virtual execution runtime

Moco executes workflows **virtually** — a workflow's lifetime is not bound to the lifetime of the
machine running it. Execution survives machine crashes, restarts, and rolling upgrades, which makes
long-running and human-in-the-loop workflows practical.

By default Moco runs on top of the open-source **Temporal.io** platform, so workflows execute in a
distributed environment with a durability guarantee — but the complexity of distributed execution
and state management is abstracted away from you as a workflow author.

Unlike the common `checkpoint`-based approach to distributed state management (as used by
LangGraph), which pushes explicit state-management logic into the workflow itself, Temporal captures
and restores state through its IO event history. That approach is systematic and application
agnostic. Moco takes a further step and hides it entirely: you write an abstract wfspec, and the
runtime handles state.

Moco binds its DSL engine to Temporal through a thin integration layer on top of the activity
dispatcher. The same engine can also run **in-memory**, with no dependency on Temporal at all — the
same wfspec runs in both modes.

### Workflow deployment

Workflows can be developed, released, and managed entirely by their business owners, with no
engineering involvement and no heavy-lifting backend deployment. Because workflows are data rather
than code baked into the runtime, they can be released instantly and versioned independently.
Workflow owners keep full control of the lifecycle through the web console or the CLI.

## Key Features

### Expressive workflow logic

- **Imperative tasks** with conditions, parallelism, loops, error handling, reusable functions,
  dynamic expressions, and text templating — including embedded Python expressions with Pandas and Jinja2 for complex data
  manipulation.
- **Event-driven state machines** for workflows that react to external events and timers.
- **Declarative rules engine** for logic that is better expressed as rules than as steps.
- **Cross-workflow communication** through events.

### Composability

Workflows compose with other workflows in multiple ways — inline, sync, async, or detached — so
complex processes can be assembled from smaller, independently owned pieces.

### Long-running workflows with durability

- Durable subscription and publishing.
- **Human-in-the-loop** workflows that can wait indefinitely for a person to act.
- **Multi-agent AI** workflows coordinated through events.

### Multi-mode execution

- **Distributed workflow mode** — full durability and scalability for complex, long-running
  workflows.
- **Standalone activity mode** — a high level of durability with a distributed runtime.
- **In-memory execution mode** — low-latency execution for microservices and desktop deployment.

### Flexible release and sharing

Dynamic versioning, access control, and multi-stage release (self-hosted). Unlike
engineering-oriented workflow platforms that require a backend deployment for every workflow change,
Moco lets user-owned workflows be deployed separately from the runtime platform, on demand, through
the CLI or web console. Versioning, permission control, and targeting make workflows easy to share
and compose.

### Interoperability

Moco is a complete platform: a REST/MCP API layer, a CLI tool, and a management console. It is
extensible for connecting to other systems, and easy to embed as a component of an external system.

---

## Quick Examples

### A simple multi-step workflow

A workflow that processes an order. `main` holds the workflow's logic as a tree of **tasks**; here a
`tasks` container runs three of them in order:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: process-order

input:
  order_id:
  items:
  customer_email:

output:
  order_id: '{{ order_id }}'
  total: '{{ total }}'
  status: completed

main:
  tasks:
    # Calculate total
    - set:
        - total: "{{ sum(item['price'] for item in items) }}"

    # Process payment - a child workflow
    - task_name: charge-payment
      workflow:
        ref: payment-charge
        mode: sync
        input:
          amount: '{{ total }}'
      output:
        as: payment_result

    # Send confirmation
    - task_name: send-confirmation
      activity:
        type: email.send
        input:
          from_address: orders@example.com
          to_addresses: ['{{ customer_email }}']
          subject: Order Confirmation
          body_text: Your order {{ order_id }} has been processed!
```

### A human-in-the-loop approval workflow

The same DSL expresses an event-driven state machine. This one waits for a person to submit a draft,
reminds them daily for up to three days, and cancels itself if they never do:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: state-machine-basics-demo

context:
  score: 0

input:
  submitter_email: author@example.com
  quality_score: 80
  approval_threshold: 70

output:
  final_state: '{{ final_state }}'

main:
  state_machine:
    initial_state: draft

    states:
      - name: draft
        timers:
          - name: reminder
            timeout_sec: 86400 # 1d
            max_timeout_attempts: 3

      - name: in_review
        on_enter:
          set:
            - score: '{{ quality_score }}' # simulate a score using input data

      - name: approved
        is_terminal: true
        on_enter:
          activity:
            type: email.send
            input:
              from_address: reviews@example.com
              to_addresses: ['{{ submitter_email }}']
              subject: your submission has been approved

      - name: rejected
        is_terminal: true
        on_enter:
          activity:
            type: email.send
            input:
              from_address: reviews@example.com
              to_addresses: ['{{ submitter_email }}']
              subject: your submission has been rejected

      - name: cancelled
        is_terminal: true

    transitions:
      # timer-driven transitions
      - from_state: draft
        to_state: # no state transition
        trigger:
          event_type: sys.timer.reminder
          action:
            activity:
              type: email.send
              input:
                from_address: reviews@example.com
                to_addresses: ['{{ submitter_email }}']
                subject: reminder for your draft

      - from_state: draft
        to_state: cancelled
        trigger:
          event_type: sys.timer.reminder.final

      # transition triggered by an external event, upon user action (human in the loop)
      - from_state: draft
        to_state: in_review
        trigger:
          event_type: submit # user submits the draft

      # automatic transitions (when trigger.event_type is null)
      - from_state: in_review
        to_state: approved
        trigger:
          condition: '{{ score >= approval_threshold }}'

      - from_state: in_review
        to_state: rejected
        trigger:
          condition: '{{ score < approval_threshold }}'
  output:
    as: final_state # the terminal state reached
```

## Next Steps

- [Quick Start Guide](./quick-start.md) — get up and running in a few minutes
- [Core Concepts](./concepts/overview.md) — how Moco works
- [State Machines](./concepts/state-machines.md) — event-driven workflows
- [Workflowspec Syntax](./reference/workflowspec-reference.md) — complete language reference
- [Using the Moco CLI](./guides/use-moco-cli.md) — run and release workflows
