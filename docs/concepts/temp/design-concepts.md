---
sidebar_label: "Design Concepts"
sidebar_position: 2
---

# CCW Design Concepts

## Overview of CCW

CCW is a low-code workflow automation platform designed to empower users to build, customize, and deploy complex business workflows with ease.

This platform is tailored to support data-centric workflows, providing robust data manipulation capabilities and flexibility in workflow design.

CCW is a workflow platform that
* allows you to express workflow logic in **low code DSL**
  * only focus on high level business logic, hide implmentation details, error handling, etc
  * platform-agnostic workflow is **concise and portable**
* provide a **virtual workflow runtime**
  * provide **reliable workflow execution** by adding inherent fault tolerance in distributed runtime environment
  * provide **consistent virtual memory space** during workflow execution, even though workflow tasks can run across nodes in cloud
    * inherent and seamless state management, workflow logic doesn't need to manage persistent states explicitly
  * same workflow can run in both local mode and distributed mode
* provide **scalable** solution to run complex workflows
* **extensible** architecture
  - activities
  - activity worker (activity registry through wfspec)
  - extensible through continuouly growing workflows
  - workflow as activity
* **flexible** workflow deployment and sharing

Features:
- support dynamically gerated workflow execution
- support dynamic deployment by workflow
- support versioned workflow deployment and release control
- support arbitrary workflow composing
- support complex data transformation capabilities
  - python expression
  - pandas


**Key Features**

* **Easy Workflow Creation and Customization**: CCW enables users to create and customize open-ended business workflows, allowing for seamless adaptation to changing business needs.

* **Advanced Data Manipulation**: The platform supports strong data manipulation capabilities, enabling users to perform complex data transformations and analysis.

* **Python Expression Embedding**: CCW allows users to embed Python expressions for data transformation logic, leveraging the power of popular libraries such as Pandas and Jinja.

* **Reusable and Composable Workflows**: The platform enables users to share and reuse workflow logic, as well as compose complex workflows in a hierarchical manner, promoting efficiency and modularity.

* **Streamlined Deployment and Release Management**: CCW supports easy deployment, versioned deployment, and advanced release control with staging and targeting lists, ensuring smooth and controlled workflow updates.

**Accessibility and User Benefits**
CCW is designed to be accessible to a wide range of users, including engineers, analysts, and business users. The platform's low-code approach and intuitive interface enable users to create and manage complex workflows without requiring extensive technical expertise. This empowers business users to take ownership of their workflows, while also providing engineers and analysts with a powerful tool for automating and optimizing business processes.



CCW is aimed to be a low code workflow/automation platform

* easy to build and customize open ended business workflows,

* tailored to support data centic workflows with strong data manipulation capability,
allow embedding python expressions for data transformation logic, with Pandas and Jinja

* flexible to share and reuse workflow logic, and able to compose complex workflows in a hierachical way
easy to deploy, support versioned deployment and advanced release control with staging and targeting list

* not only for engineers but also for analyst and business users



- split workflow into two parts, a DSL based workflowspec, and a virtual runtime layer
  - workflowspec focus on business logic, control flows and data flows
  - runtime takes care of implementation details for state management, distributed execution, parallel execution, error handling, fault tolerance, etc.
- bring in Open Source Workflow Orchestration solution (Temporalio) to support durable and scalable excution for *complex workflows* in distributed environment
- unified and flexible workflow deployment model for both backend and interactive use cases
  backend workflows - staged deployment
  interactive workflows (AID, EA) - versioned release by both stages and by user base


## Workflows and Challenges

A workflow is a stateful execution of multiple steps.

### what are workflows

Workflows are:
* stateful execution of multiple tasks
* workflows by natuare are more complex and normally takes longer time to complete
* desires to be executed asynchronously
* requires durable execution - ability to recover from interruptions
* defines dependencies among a set of tasks
* workflow focus on the high level control flows of the constituent tasks, thus can be expressed as a graph.
simple use case is a DAG, more complicated is a Finite State Machine
* Graphs are better represented declaratively rather than imperatively

[distributed workflow execution]
* when multiple steps of the workflow can run in a cluster of nodes in distributed way (**redundancy**),
requires virtual memory space. Common aproach is providing cross-nodes session state using persistant storage servcies like Redis or database

[Temporalio]
Temporalio adopts a unique approach that abstract away state mamnagement completely from the high level workflow logic.
In Temporalio,
- all logic can be categorized into either workflow tasks or activity tasks.
- workflow tasks only contain deterministic logic and replayable
- non-deterministic logic must be wrapped inside activity tasks
- activity tasks should be idempotent
- all activity input/output events are captured by the Temporalio
- The activity input/output events contains the full information of the workflow execution history
- state management is completely abstracted away from the workflow logic
  - workflow is agnostic on how state is managed
  - workflow doesn't have to follow specific model to distiguish local vs persistant states, all states are
    persisted at lower level through the activity input/output events
- Temporalio offers the following distributed OS service on a collections of execution nodes:
  - correct execution with fault tolerance
  - virtual memory space within distributed exectution nodes

[Mrico service architecture]
services are stateless (can scale)
applications are stateful

Web App
- legacy web app can be
  - RESTful (Representational State Transfer) - all states are transfered in requests, stateless service, for small session states
    - cookie
    - queryparam in url
  - session - workflow state
    - serverside session storage (Redis)
    - cookie (session key), http-only
- SPA
  - api server

The most common forms of software components are applications and services.
applications with micro-services architecture
**application**
applications can be further categorized into desktop apps vs web apps.
application can be views as
- user interface
- a colloctions of workflows
workflows are stateful excecution of mulitple steps.

**services**


Before the emergence of modern workflow orchestration platform, workflows are normally either embeded inside applications,
or even inside one or a collection of backend services, lacking explict expressions of workflow logic.
Modern workflow orchestration platforms allow workflow logic to be extracted from applications.
Workflows now become its own form of deployable software type that can be expressed explictly.

**CASE STUDY: web apps with serverside session state**
persistent session storage:
- security states
- workflow states
to support durable workflows
but what about scalability? how to support large amount of concurrent complex workflows?
You still need to
- break workflow into smaller tasks
- execute asynchronously

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

Business workflows has high requirements on customization and flexiblity
- light-weight workfow deployment that support versioning and release control (staging and targeting - release to different stages and users)
- ability to compose workflows from worklfows in a flexible way


In CCW, workflow and platform are deployed separately. The runtime platform is deployed as backend services. Workflows are deployed as application,
which support versioned deployment, and release control features like staging and targeting list.

In Airflow, workflows (tasks + DAGs) are deployed as backend components, which doesn't support versioned deployment.



Airflow:
- tasks are part of workflow logic


CCW:
- Activitities are part of the runtime
- workkflows


## summarize
* **computing model**

  * Imperative vs Declarative
    - imperative workflow logic in low code DSL
    - declarative text templating for content/UI, with dynamic data binding
      - news textgen activity
      - ideas:
        - **jinja as activity**
        - **jinja as workflow statement**
        - pebble expression at workflow level (workflow statement)

    - imperative:
      - Low code vs pro code
        - low code (DSL): focus on high level contract and control flow
          - concise and portable
          - more reliable
    - declarative
      - text templating
        - jinja as workflow statement
        - jinja as activity
      - rules engine
      - state-machine


  * state machine model
    - declarative
    - event driven model

* **execution model**
distributed execution vs local execution


* **deployment model**
separate workflow from platform deployment
versioned workflow deployment and release control (airflow workflow is not versioned deployment, doesn't support multiple versions at same time)

