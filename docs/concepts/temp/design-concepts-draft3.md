temporal:
It captures states at a different dimension and offload the complex state mangement from application layer to platform layer, and greatly simplified application logic with durability guarantee.


## design goal
* moco workflow platform aims for buiness workflows orchestrating API calls, with advanced data transformation capability

* fully decouple workflow logic from underneath runtime platform
workflows and runtime platform are developed, managed, and deployed independenty
workflows focus on business logic, it's
- focus on control flows and data contracts
- concise, implementation details (security,reliability,scalability,concurrency, etc) are abstraced away from workflow logic
- platform agnostic
- workflow lifecycle is fully managed by workflow owner
- self deployable


## computational model
- imperative vs declarative
  - imperative workflow
  - declarative capability
    - native support jinja template in wfspec

```yaml
  transform:
    input_data:
      name: tao
      items: ["item1","item2","item3"]
    output_data:
      templated_content#jinja: |
        <html>
        <body>
            <h1>Hello, {{ name | upper }}!</h1>
            {% if items %}
                <ul>
                {% for item in items %}
                    <li>{{ item }}</li>
                {% endfor %}
                </ul>
            {% else %}
                <p>No items found.</p>
            {% endif %}
        </body>
        </html>
```

- state machine
  - can blend with workflow imperative statements seamlessly
  - event-driven application
    - AI agents
    - Request handler
    - monitoring external data sources
    - complex workflows
    - human in the loop workflows

- rules engine
  - can blend with workflow imperative statements seamlessly

- support durable event subscription and publishing (through durable long-running activities)


## execution model
- in-process execution
- distributed execution
- run-as-activity

## workflow deployment model
- workflow is deployed like an app rather than a service
- support versioned deployment, multiple versions can coexist
- support staged deployment
- support targetted deploymented, user based targeting list

## virtual workflow runtime
A virtual workflow runtime that
- provides consistent virtual memory space during workflow execution (even executes across nodes in distributed environment)
- garanteed workflow execution (can tolerate temporary error condition during distributed execution)

The virtual workflow runtime and run in-process or run on top of Temporalio for distributed execution

## DSL based workflow spec
- concise
  - focus on business logic
  - abstract away error handling, timeout, retry logic
- decoupled from implementation details
- platform agnostic
- can compose hierachical workflows

## app or service

moco workflows have traits of both app and service
* as app
  - stateful execution
  - versioned deployment with user-based targetting

* as service
  - single 'run-workflow' API can serve as a universal API for any backend logic

## scalable for complex workflows
