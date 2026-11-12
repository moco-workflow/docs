---
sidebar_label: "Workflow Platforms"
sidebar_position: 0
---

# Workflow Platforms

## Workflows

A workflow is a generic term that can manifest in various forms and implementations across different domains and organizations.
It can range from backend batch jobs maintained by engineering teams to business workflows managed by product or business teams,
requiring flexible customization and quick turnaround.

In the context of computer software, workflows and automation refer to the high-level orchestration logic in a highly modularized
and componentized system. The building blocks of workflows are abstracted as components or tasks (also known as activities),
while the workflows define the execution order and dependencies among these tasks.

### Key Features

Workflows typically exhibit the following traits:

* **Stateful execution**: Workflow execution is normally stateful, allowing for recovery from interruptions and potentially requiring transactional (ACID) guarantees.

* **high level abstraction**: When we use the term Workflow, it often means the high level business logic about the relationship among
a set of inidividual tasks.

  * **Control Flow Logic**: Workflow is the control flow logic of a set of tasks. In other words, a workflow defines the dependencies or execution order of
a set of tasks. Workflow logic can be expressed as a graph.

  * **Automation of reusable components**: Workflows focus on the high-level logic of orchestrating reusable components, rather than implementation details of
individual functionalities. Automation and workflow are closely related terms and often used interchangeably.


### Challenges

* How to recover from interuptions
Workflows normally take longer time (compared with micro services) to run end to end. In reality, unexpected conditions like machine turnarounds,
temporary upstream service unavailability, netowrk interruptions,  have much larger chance to abort the workflow execution. Without proper
persistant state management, we have to rerun the workflow from the begining. So supporting **durable execution** is a must-have requirements for modern
workflow platforms.

* How to scale horizontally

* How to provide redundancy to a workflow platform


### Modeling Workflows
There are several ways to model and implement workflows.

#### DAG vs [Finite State Machine](https://en.wikipedia.org/wiki/Finite-state_machine)
Workflow logic focus on high level control flow among tasks, which can be naturally modeled as a graph.
Some workflow platform like Apache Airlow models workflow as DAG (Direct Acyclic Graph), which is intuitive to express batch job type of workflows.

A more powerful model to express workflow logic is the finite state machine, which models the workflow logic through a finite set of states,
and a state transition table describing how states react to external events. The state machine model is more powerful and is a superset of DAG.
When a acyclic state machine transite states without external events, it becomes a DAG.

State machine is more suitable for expressing complex business workflows than DAG. For example, for a business workflow requiring approval steps,
it implies the workflow need to respond to human generated approval or reject events, and it's common to have cycles in the workflow logic graph.
DAG can't express such kind of workflows, state machine is a natural fit in this case.

### Implementation Approaches

#### [Imperative](https://en.wikipedia.org/wiki/Imperative_programming) vs [Declarative](https://en.wikipedia.org/wiki/Declarative_programming) Programming
It is often intuitive to express workflow logic in an imperative way, and most workflow platforms take this approach.
If you model workflows as state machine, however, it's also common to express workflow logic in a declarative way,
i.e. states and transitions are defined in a data structure like JSON or XML, and feed to a generic state machine engine for execution.

#### Code-first vs using DSL (Domain-Specific Language)

It's common for engineers to implement workflows using a specific programming or scripting language in a imperative way. This is a natural and intuitive approach
when the number of workflows is limitted, and for simple execution models like batch jobs.
But this engineer oriented approach is not scalable in terms of business model - implementation and customization are restricted by the engineer resource.
It doesn't give the freedom for business users to build, customize, and deploy business workflows in a flexible way.

However, when dealing with complex business workflows that require flexible customization and virtually unlimited variations,
expressing workflows using DSL in a declarative way is more preferable.

This approach decouples workflow logic from runtime implementation details, allowing workflows to be customized and deployed in a much lighter-weight fashion.
Workflows and runtime platforms can be owned by separate teams, reducing maintenance costs and improving business efficiency.

For complicated graph logic, using state machine model can offer simpler and more stable solution than imperative implementation.
In this approach state transition graph can be expressed delaratively in a DSL, and a generic runtime can be used to drive the state machine
according to the state transition logic declared in the DSL.

Some systems also offer a low-code visual layer on top of a DSL, allowing people without programming expertise to author or customize workflows with ease.
Fundamentally, the low-code visual layer is just one additional transformation to the DSL, thus equivalent in terms of system design.

With the increasing maturity of Large Language Models (LLMs) and their widespread availability, it is becoming a compelling trend to integrate AI and workflow
automation to form a more powerful system, known as an AI agent, or maybe even Artificial General Intelligence (AGI). DSL-based automation systems offer advantages
in this case, as DSLs can be easily generated by LLMs and immediately runnable in the platform. With a feedback mechanism to evaluate, correct and improve
intermediate result, it can turn into a fully autonomous system.
Products like Microsoft Copilot take this approach, using LLMs to generate and run DSLs on the fly, and applying multiple iterations of
self-evaluation and improvement to achieve desirable results.

#### Customized Solution vs Generic Workflow Platform

Before the emergence of generic workflow platforms, people had to build customized solutions for each use case. Sometimes, workflow logic was not even explicitly
expressed, and it could be buried inside an application or spread across multiple components or services, making workflows less obvious and harder to maintain.

Without a shared framework, lots of repetitive work were implemented in each customized solution. For example, similar task scheduling, state management,
error handling, timeout, and retry logic were implemented repeatedly in different systems or even in different components of the same system.

Modern generic workflow platforms not only offer scalable architectures built on top of cloud computing, but also abstract away state management, error handling,
timeout, and retry logic from the high-level workflow logic, making workflows much more concise and cleaner, and the whole system more reliable and resilient.

---
## Workflow Platforms

### Requirements

#### Durablility

#### Scalablility

#### Flexiblility

---
## Available Workflow Platforms

In today's rapidly evolving technological landscape, efficient workflow orchestration has become crucial for businesses seeking streamlined operations and optimal
resource utilization. Several platforms have emerged as leaders in this space, each offering unique features and capabilities tailored to different organizational needs.
Among these, Temporal.io, Apache Airflow, and Argo stand out as prominent choices.

### Temporal.io
[Temporal.io](https://github.com/temporalio) is an open-source, stateful, and resilient workflow orchestration platform designed to handle complex, long-running workflows.
Developed by the creators of Uber's Cadence, Temporal.io focuses on providing reliability, scalability, and ease of use for building mission-critical applications.

#### Key Features:
- **Stateful Workflows**: Temporal.io supports stateful workflows, where the state of a workflow execution is managed internally, ensuring robustness against failures and allowing for complex orchestration patterns.
- **Programming Language Agnostic**: Developers can write workflows and activities in any programming language, making it versatile and accessible across different tech stacks.

### Apache Airflow
[Apache Airflow](https://github.com/apache/airflow) is an open-source platform for programmatically authoring, scheduling, and monitoring workflows.
It originated from Airbnb and has gained widespread adoption due to its flexibility and extensibility.

#### Key Features:
- **DAGs (Directed Acyclic Graphs)**: Airflow uses DAGs to define workflows, allowing for dependencies and scheduling of tasks.
- **Extensibility**: Supports custom plugins and integrations with various external systems and tools.
- **Rich UI**: Airflow provides a web-based UI for visualization, monitoring, and management of workflows.

### Argo
[Argo](https://github.com/argoproj/argo-workflows) is an open-source container-native workflow engine for Kubernetes, specializing in orchestrating parallel and distributed workflows on Kubernetes clusters.
It comprises several components, including Argo Workflows and Argo Events.

#### Key Features:
- **Kubernetes-Native**: Seamlessly integrates with Kubernetes, leveraging its scalability and resource management capabilities.
- **Workflow Templates**: Allows defining workflows using YAML or a graphical interface, making it accessible to both developers and operations teams.
