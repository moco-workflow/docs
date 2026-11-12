---
sidebar_label: "Design Concepts"
sidebar_position: 2
---

# CCW Design Concepts

## Workflows and Challenges


### what are workflows

Workflows are:
* stateful execution of multiple tasks
* defines dependencies among a set of tasks
* workflows by natuare are more complex and normally takes longer time to complete,
* desires to be executed asynchronously,
* ability to recover from interruptions
* workflow focus on the high level control flows of the constituent tasks, thus can be expressed as a graph.
simple use case is a DAG, more complicated is a Finite State Machine
* Graphs are better represented declaratively rather than imperatively

The most common forms of software components are applications and services.



Before the emergence of modern workflow orichestration platform, workflows are normally either embeded inside applications,
or inside one or a collection of services, lacking explict expressions of workflow logic.

### The biggest challenges of workflow platform

micro-service architecture
Services are best suited for primitive capabilities such as CRUD. It's also common for services to expose higher level composite
capabilities as APIs, such as combination of multiple primitive steps. Those composite capabilityes are essentially workflow
logics, which are stateful excution of multiple steps.
When workflow are simple and fast enough, it's not a problem of running them as request/response type of api.
But when workflows become more complex and takes minutes to run, **durabibility** and **scalability** become biggest challenages.

* durability
When workflow become complex enough (minutes), there's bigger chance that the workflow execution can be interrupted. Examples can be
machine turn around, unexpected crash, or temporary upstream service unavailability, etc.
durablility becomes a requirement.
A Wworkflow is a stateful execution of muliple steps. Workflow execution states need to be persisted so that they can
recovered.

There are two types of workflow states
- execution states (checkpoints)
  - which step the workflow execution is at
  - these states can be managed systematically by the underneath platform
- workflow context states (application level states)
  - normally a programming model that requires workflow to follow, so that the underneath framework know what and how to persist
    - airflow - xComs
    - LangGraph - State base class
  - Temporalio systematically persists all events io, so it's transparent to application


When workflows run inside appications or inside services, they run inside a physical OS process memory space. Without
customized solution to persist and manage states, the liftetime of a workflow is naturally aligned and limited by the
lifetime of the OS process.

Workflows are typically more complex, taking longer time than primitive APIs, and often need to orchestrate multiple components
in a distributed environment, there's bigger chance that a workflow execution can be interrupted by unexpected events,
such as machine crashes, turn arounds, temporary network disruptions, etc. It's a common requirement that workflows can
run in a durable way and survive from the interruptions.

Before the emergence of common workflow platforms, each application often implements its own data model so execution states of
the workflows can be persisted and restored for durable execution.
And it's a common approach to model the workflow execution as a task scheduling system. A task model typically has exection status
and a set of application specific attributes.


* scalability
Micro-service architecture is scalable for stateless API calls. Workflows are stateful exectution of mulitple steps,
and by nature more complex and requires asynchronous execution.

How to scale complex workflows to support hundred thousands or event million of concurrent executions.
Another big challenge is how to scale the system to support hundred thousands or millions of concurrent workflow executions.
When workflows are executed in a coarse grained way, the number of execution resource is the limit of how many concurrent
workflows the system can support. The common approach is to break the workflows into smaller tasks and feed them into the pool
of execution resource.

This is very similar to convert a synchronous multithreading model to true thread pool model.
Similar to feed rocks through a funnel
compared with break rocks into sands and feed into the funnel



* flexibility
authoring
deployment
composable workflows

## goal

The goal of CCW is to allow extended users to author, compose, and deploy a varity of workflows in a easy and flexible way.
And to build a cloud native scalable runtime platform for durable workflow execution.

Here are the core decisions we made during the design to build such kind of system:
* decouple declarative workflow logic from runtime implementation
* use open source Temporalio to form a durable distributed workflow execution runtime
* flexible workflow deployment with versioning and release control



## CCW approach:

Instead of taking the code-first approach that implements and deploys workflow directly in a specific programming language,
CCW vertically splits the workflow into two parts: a DSL-based workflow spec, and a generic workflow engine



CCW uses DSL to express workflow logic in an abstract way, and decouples from
deouples abstract repesentation of workflow logic from underneath runtime.

- workflows are expressed as declarative DSL and platform agnostic
- workflows specs are

Benefits of using declarative workflow spec:
* workflow logic are fully decoupled from the underneath runtime
* more concise and focus on business logic instead of implementation details
* workflow specs are runtime agonostic
* platform specific maintenance, such as python language version upgrades, are only contained within the platform
* DSL based workflow specs are abstract representation of the workflow logic, thus more stable, and can be easily tranformed to any other form
* DSL based workflow specs can be better integrated with Agentic AI system
*


There are multiple ways of expressing workflows:

**DAG** - simpler workflows that has liner logic are better expressed in imperative way (DAG)

**Finite State Machine** - complex workflows can be better modeled as Finite State Machine in a declarative way

- rules engine - declarative list of rules

Imperative vs Declarative:

Imperative - liner logic, DAG
Declarative - State Machine or Rules Engine
Logic is much more concise to be expressed in declarative way.


Declarative Policy, Rules, Prompts can also be implemented as CCW wfspec to take advantage of its versioning and release control.

---


## DSL based Workflow specs and virtual runtime

We use DSL to express workflow logic in an abstract way, rather than directly implemented in code.

There are multiple benifits of using this approach:
- more concise and simpler
- platform agnostic
-



In CCW, workflow specs and the workflow runtime are fully decoupled.
The workflow spec declares the workflow logic.
The actual runtime is responsible for executing all comformant workflow specs.

The workflow runtime is pre-deployed as platform and managed by the engineering team.
Workflow specs are deployed separately by the workflow owners using a more flexible
mechanism that supports versioned release and targeting list.

### workflow spec
Given workflows are fundamentally graphs, CCW uses a declarative way to express workflow logic, instead of using imperative way.
In CCW, workflow logic, named workflow specs, are expressed using a yaml-based DSL.
The DSL based workflow spec is the abstract representation of the worklfow logic, which is concise and only include the
necessary information about the workflow logic, rather than the implementation details. Fault tolerance logics, such as retry
and error handling, and state persistence, are abstracted away from the workflow spec.
A workflow spec is more like the high level pseudo code rather than the actual application code.

The CCW workflow spec support
- control flow primitives, able to express condition, loop, sequential and parallel execution,
- ability to run activities, which are pre-deployed primitive building blocks of workflows
- ability to run child workflows, so that workflows can have hierachical structure and able to compose to form arbitrarily complex workflows
- support expressions, so that data can be dynamically transformed and manipulated inside the workflow




### virtual runtime
The workflow specs are executed in workflow runtime.

The virtual runtime is the abstraction of the actual implementation of workflow runtime, which offers

* correctness of ordered execution,
  - when run in distributed environment, provide fault tolerance on inidividual steps

* virtual memory space for workflow states
  - workflow level states can be accessed within the workflow context during execution lifetime
  - no matter the workflow is executed within a physical process memory boundary, or spreaded accross pool of nodes in a distributed environment


### Distribute workflow runtime



## workflow deployment
In CCW, workflow and platform are deployed separately. The runtime platform is deployed as backend services. Workflows are deployed as application,
which support versioned deployment, and release control features like staging and targeting list.

In Airflow, workflows (tasks + DAGs) are deployed as backend components, which doesn't support versioned deployment.



Airflow:
- tasks are part of workflow logic


CCW:
- Activitities are part of the runtime
- workkflows
