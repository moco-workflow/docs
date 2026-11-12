---
sidebar_label: "Design Concepts"
sidebar_position: 2
---

# Design Concepts

## declarative workflow and virtual runtime

- agnostic to runtime
- focus on business logic, concise
- abstracted away:
  - concurrent execution
  - fault tolerant logic, retry, timeout
  - language/runtime migration
  -

Flexibility
CCW aim to provide a flexible architecture to organize software components for workflow automation, to promote ease of authoring, deployment, and sharing reusable logic.


## deployment

- versioning
- release control
  - staged
  - targeting list
- dynamic resolution
- composable workflow



### deployment model, modular design, reusability
#### static vs dynamic dependencies resolution
- python package
  - package is versioned, but deployment is not versioned
    - packege version is selected at development time,
    - deployment is static, doesn't support multiple versions coexist
    - doesn't support run time version selection
- ccw
  - activity is part of platform, thus static
  - shared workflow versioning is resolved at run time

### flat vs layered system architecture (also stability)


## Distributed workflow execution - horizontal scaling
distributed virtual runtime

Scalability, concurrency, throughput - distributed worker pool

### Horizontal Scaling

### single pool vs multiple pools

### distributed application framework

## Unique traits
### Is it an application or service?




------
### Does CCW provide isolation between long-running tasks and short-running tasks?

One of the biggest challenges of a platform that supports complex workflows is how to prevent systematic halts and how to prevent long-running tasks from delaying or blocking short-running tasks.
You do not want a suite of workflows with slow or blocked steps to occupy all workers and halt overall progress.

BNG executes the entire workflow synchronously in the BAS request handler and uses a simple strategy to prevent systematic halts - a 53-second timeout across the board. This approach makes it impossible for BNG to support more complex workflows, which is actually gaining more demand, especially in the AI era.

CCW runs workflows in a more granular way. A workflow is split into tasks (activities), and the tasks are dispatched to a pool of container-based workers for execution.
More importantly, all workers run IO-bound tasks asynchronously - meaning a single worker can run many such tasks concurrently.

Currently, all CCW workers are identical and symmetric, meaning all workers have the same chance to serve all tasks. Temporal also supports asymmetric workers, known as activity workers, meaning you can have a separate worker pool to serve a specific set of tasks. For example, you can deploy a dedicated worker pool only serving expensive activities like AI-related activities, so that these long-running tasks will not delay others.

In fact, AI activities are IO-bound tasks, implemented asynchronously, so even without a dedicated worker pool, they won't cause delays in other workflow executions. Only CPU-bound or synchronous IO-bound long-running tasks truly need a dedicated worker pool to avoid systematic delays.

#### Analogy to Multi-threading

If we scale down the runtime environment from the distributed cluster level to a single process level, what we discussed above is essentially the same concept as the multi-threading model in a single-process world.

- BNG's execution model is essentially the same as what we often call `synchronous multithreading`. In this mode, coarse-grained jobs are executed synchronously in the thread pool. All steps of the workflow, including the IO-bound tasks, are executed sequentially on the thread. The thread will be blocked doing nothing while an IO-bound task is waiting for external responses. This is intuitive to implement, but not the optimal way a thread pool should be used.

- A more efficient way is to cut the workflow into smaller tasks and dispatch them to the thread pool. Tasks that don't depend on each other can be dispatched at the same time to improve concurrency and throughput. More importantly, IO-bound tasks should be executed asynchronously so that the thread can be freed up to process other tasks while the IO task is pending for an IO response. The current setting of CCW matches this model.

- There are also use cases when multiple thread pool instances are needed to run different types of tasks in isolated pools. Preventing long-running expensive tasks from delaying other tasks is a typical use case. The asymmetric worker pools in Temporal is the equivalent counterpart to the multi-thread-pools setting in a scaled-down environment.

------

## Declarative Workflow

### decouple workflow logic from `virtual runtime`
-------------------------------
The above discussion also lead to a fundamental design concept of CCW - run workflow on top of a `virtual runtime`.
In CCW,
A Workflow spec is:
- abstract expression of business workflow
- declarative using DSL
- concise and only contain minimun necessary information about workflow logic
- portable


A virtual runtime provides guarantee of
- correctness of ordered execution,
  - when run in distributed environment, provide fault tolerance on inidividual steps
- virtual memory space for workflow states
  - workflow level states can be accessed within the workflow context during execution lifetime
  - no matter the workflow is executed within a physical process memory boundary, or spreaded accross pool of nodes in a distributed environment


Decouple `Workflow logic` from `Virtual Runtime`

CCW's approach, what we called declarative workflow specs.

What CCW provides, is an abstractive expression of workflow logic (in the most concise way), that can run on top of a virtual runtime layer, as far as the virtual runtime layer provides correctness of ordered execution, and consistent memory model.

This virtual runtime layer can be a OS process when run on a single physical machine (or VM), which can be a desktop application in the frontend, or a service daemon in the backend.

 Temporalio play the role of providing such virtual runtime environment in a distributed cloud environment, and garantee the correctness of ordered execution, and consistent memory model.


you can think it as virtual process. This virtual runtime provide a consistance memory
bourndary.

In that sense, CCW is trying to express the business logic of a workflow in an abstractive way, and fully decouple from the actual runtime.
From the workflow perspective, it only focus on the business logic, and is agnostic to the actual runtime that's bounded in each deployment, no matter it runs in single process on a physical machine, or in a cloud computing environment where each step may run on different node. As far as the runtime provides guarantee on correctness on execution and oder, and consistent memory model.

----------------------
### virtual runtime in distributed environment

- ***guarantee correctness of ordered execution***
  It's a basic feature for distributed task scheduling system to provide guarantteed correct execution order, and fault tolerance to deal with unexpected conditions in distributed computing environment, such as node crash, turnaround, network interruptions, etc. It's common for the task scheduler to persist task excution
  status in order to retry and recover from unexpected interruption.

- ***provide virtual memory space for workflow states***
  A Workflow is a stateful execution of a set of tasks. It's a fundermantal requirement for the virtual runtime to provid a workflow-level virtual memory space so that states can be shared and directly accessible during workflow execution.

  The states here means the workflow states that can be referenced within the workflow at
  any step. Not the internal state that the platform uses to guarantee the execution of individual tasks.

  Most platorms require the workflow to follow their framework to store workflow states, so they can be
  marshalled across nodes, to form a virtual memory space.

  Airflow provides limited capability to share states within DAG, all states are passed through XComs, and can only be accessed and processed within task. DAG level doesn't have capility to transform data.

  Temporalio uses a unique approach to mange workflow states in a agnostic way. there's no requirements for
  workflow to express states in a platform specific way.

---------------------
When running on a single machine, the Operating System provides the virtual memory boundary, and exeuction order. When run in the cloud based distributed environment, the Temporalio provides the virtual memory, so that from the workflow perspective, is has the consitent memory state while workflow makes progress. In that sense, Temporalio is playing the role of a distributed operating system.
While you use Air flow, you have to code in the Airflow way, not a abstrative way. And that is the fundamental reason why we choose Temporalio. It allows us to express workflow logic in abstrative way, and fully decoupled with the runtime environment.



--------------
CCW

`flexibility` - declarative workflow logic and `virtual runtime`
  - workflow:
    - platform agnostic,
      - portable, same workflow can run in desktop app, backend service daemon, or cloud  (temporal)
      - no need to worry about python version migration at recipe level
    - concise, minimun information to express business logic
      - can be transformed to any format, future proof
    - workflow deployment
      - workflow are deployed separately from platform
      - can be managed by workflow onwer through self service
      - support both interactive and backend use cases
      -
      - shared workflow can be resolved at runtime dynamically, compared with statically at development time
        - dependenciy, static vs dynamic
          - static - python package, versioned, but ressolved at development time, statically deployed
          - dynamic - workflow deployment, versioned, with release control, resolved at run time
              workflow deployed separately from platform

`scalablity` - horizontal scaling in distributed environment

*stability*, structure problem - flat vs layered


------------
structure - flat vs layered

One of CCW's goals is solving the structure problem. One of the problem of legacy system is that the structure is flat, or with two-three layers. Causing monolithic logic and hard to manuver. Thing like recipe has to include logic to have try catch and retry logic in every major steps, or need to include logic to raise DRQS on failure, it's not a good approach. Or core platform runtime have to tightly coupled with souround workflows like pre/post steps for validations and error checking, that may require more frequent adjustment than the core features, stability will be at risk.

-----
why not airflow, stella, argo, etc

- Runtime capability
  - open ended workflows
  - support complex data transformation capability
  - state machine model
  - declarative workflow for platform agnostic business logic

- Deployment model
  reusable dependencies are statically resovled at development time
  python module can be versioned and shared. but it's static, meaning reusability is resolved at development time.
  - CCW workflows are shared at run time, meaning reusable workflows are not only versioned,
    but also can be staged, and target to different user base, through release control, no need to redeploy.
    version is selected at run time based on stage and user id

- CCW support both interactive use case and backend use case
Our run time and deployment model support interactive use case.


