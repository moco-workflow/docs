---
sidebar_label: "System Architecture"
sidebar_position: 1
---

# CCW System Architecture

## Overview

The CCW system architecture is designed to provide a durable, scalable and flexible workflow management platform for automating complex business processes.
The platform consists of four primary components: Workflow Runtime, Deployment Service, API Layer, and Development & Management Tools. The system
integrates with downstream systems through the BAS Service and OpenAPI, providing a robust and secure workflow management solution.

## Architecture Diagram
The following diagram illustrates the CCW system topology, including its upstream and downstream systems and services.


![architecture](/img/ccw/ccw_architecture.png)


---
## CCW Platform

The CCW platform consists of four primary components:

### 1. Workflow Runtime

The Workflow Runtime is the core of the CCW platform, responsible for executing workflows and activities. It comprises:

* **CCW Worker**: BPaaS containers that execute workflow and activity tasks. The generic workflow engine and activity providers are packaged into the worker.
Number of containers in the BPaaS can be adjusted based on load requirements. All CCW workers connect to the Temporalio cluster to receive tasks. The CCW Worker
contains the following components:

    * **Workflow Engine**: The DSL Interpreter, responsible for executing control flows, nested workflows, and data transformations among steps.

    * **Activities**: Activities wrap upstream APIs and services with well-defined contracts, ready to be automated by workflows.
    Activities are decoupled from the workflow engine through the `Activity Dispatcher` and new activities can be added to the runtime without modifying the workflow engine.

    * **Workflowspec Resolver**: Responsible for resolving workflows specs by name and version from the Deployment Service. This can be viewed as part of the Workflow Engine.

* **Temporalio Cluster**: An Open Source Temporalio cluster providing workflow orchestration services, essentially a distributed task scheduler that dispatches workflow and activity tasks to connected workers.

Like other typical backend systems, three isolated workflow runtime environments are built: dev, beta and prod. Workflows can be released
stage by stage to ensure quality. The above diagram only shows the production tier for simplicity.

---
### 2. Deployment Service

The CCW Deployment Service is responsible for workflow deployment and release control. It adopts the Rapid (Rapid app framework) deployment model and supports:

* **Versioning**: Multiple versions of the same workflowspec can co-exist at the same time, each in a different stage and targeted to specific users.
* **Staging**: Each version of a workflowspec must be released stage by stage, allowing for sufficient testing before reaching the prod tier.
* **Access Control**: Each version can be targeted to its own list of users in each stage, and only targeted users in that stage are allowed to run that version.
The **Workflowspec Resolver** resolves the highest targeted version for the user in the workflow runtime.

The Deployment service is an essential part of the platform to support shared workflows and ability to compose complex workflows.
The worklow runtime use the **workflowspec resolver** to resolve released workflows from the deployment service.

---
### 3. API Layer

The API Layer provides two types of standard service endpoints (OpenAPI vs Closed API) to external systems to access CCW and run workflows:

* **BAS Service**: A BAS service named `ccwrnrsvc` allows BAS clients to access CCW and run workflows.
This is a 'closed API' and only clients within the same BAS network tier can access.
It is how News Automation downstream sub-systems like DCCM and BNGA integrate with CCW.

* **OpenAPI**: Standard REST OpenAPI hosted at https://ccw.prod.bloomberg.com/api (*tier* can also be `dev` or `beta`),
for HTTP clients to access CCW and run workflows. Requires standard BSSO issued OAuth2 token to access.
Clients like CCW VSCode extension, or the Web-based CCW Management Console, use the OpenAPI to access CCW for release management and workflow execution.
Through the OpenAPI, clients can access the CCW runtime from different tiers. I.e., VSCode running from corp or bbvpn network can access all tiers of CCW.
Access control is enforced through BSSO authentication and PVF control.


---
### 4. Development & Management Tools

* **VSCode Extension**: A Visual Studio Code extension for CCW development and management.
* **CICD Workflows**: Continuous Integration and Continuous Deployment workflows for automating CCW development and deployment.
* **Management Console**: A web-based management console for CCW release management.

---
## Downstream Systems

The CCW is an open platform offering 'workflow as a service', and can be integrated with other systems through BAS or HTTP APIs.
Here are some examples:

* **DCCM**: A downstream system that integrates with CCW through the BAS Service.
* **BNGA**: A downstream system that integrates with CCW through the BAS Service.
* **Editor Assistance**: A downstream system that integrates with CCW through the OpenAPI.

