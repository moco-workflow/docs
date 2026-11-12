# Why Building Moco

What motivates us to build the Moco workflow platform?

**We believe Workflows belong to everyone, not just to software engineers**.

Legacy way of business people provides specs, and developers implement them as software.
The executable workflow logic only exists inside an application or a collection of services.

We believe the approach of represent workflow logic in a high-level DSL languague, that can be excuted on a shared workflow runtime.
By doing this:
- workflow truely focus on business logic, not boilerplat logic
- vertically split the

**We believe in low code DSL approach to author business workflows**

We believe business workflows logic can has its own representation, doesn't have be buried inside an app implemented with a specific tech stack.
Most of the code are boilerplate, not business logic

Workflow expressed in DSL is abstract, truly focus on business logic, long lasting, and can be easily tranformed to any other form


* **Workflow as document**, free to share and send around, but still executable
similar to Excel spreadsheet in that sense.

## What's needed to express workflows
In other words, what are the **Computing models** can be used to express your workflows

* Imperative
* Declarative - Functional, dependency graph (properties)
* Event driven, state machine, HITL

Excel model is pure functional (declarative, dependency graph), lacking capablity to express imperative logic, thus weak on expressing workflow logic.

## Agent Harness
* Your memories and data belong to you, not a specific agent harness
* An Agent harness fully implemented in yaml
