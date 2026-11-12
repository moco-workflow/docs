## overview

This repo contains a docusaurus based documentation project targeted for moco end users.
Internal design documenations are stored in `moco-core/docs`.
Documentation in this project should focus on core concepts of Moco workflow and how to
to build moco workflows, not implementation details of moco platform.

For example, for activities, moco-doc should explain what activity is and how to use them in
wfspec from high level, and provide reference to activities in terms of input/output contract,
and wfspec example on how to use them. how to implement a new activity in python using the
moco activity framework belongs to tech design doc in moco-core.


## documentation topics (draft)
All docs are .md files under docs folder.
Files with `.draft.md` contains draft ideas for the corresponding doc,
try to respect the ideas in the draft doc but not strictly required.

The following are draft topics ideas for this project:

- overview - what is moco workflow platform
- quick start
  - use moco cli,
    - download cli from https://my-moco.com/tools/moco-cli-<version>.tgz
    - with ai agent
  - use moco console
- concepts
  - design goals - business workflow orchestrating APIs decouple
  - wfspec basics
    - wfspec basics
      - statement, composit statements
      - activities
      - expressions
    - workflow states - data context
      - modifiers
    - activities
      - secret management
      - persist state management
    - control flows
    - expressions - data transformation
      - variable modifiers
    - text templating in moco (expression, jinja2)
    - child workflows (composability)
      - wfspec reference
        - by name+version (deployed)
        - by content (without deployment)
          - debug mode
          - dynamically generated
      - child_mode
        - inline,sync,async,detached
      - execution_mode,,entity,retry_policy
      - run workflow as activity
  - state machine (event driven computing model)
    - human in the loop
    - request handler
    - multi-agents
  - rules engine (declarative computing model)
    - live mode
  - communication mechanisms in moco
    - events in moco workflow
      - emit_event,wait_for, state_machine
      - inside workflow - events
      - workflow to workflow - events
      - activity to workflow - events
    - streaming to moco clients
      - mcp
        - api
        - cli tool
      - add websocket?
  - release and share your workflow
    - workflow release and lifecycle management
  - namespace access control
  - writing tests for moco workflows
  - run moco workflow
    - web api
  - secrets management
- guides
  - build long running workflow
    - human-in-the-loop
      - `wait_for`
      - use state-machine
    - durable subscription/monitoring
    - continue-as-new-checkpoint
  - building AI agents
    - multi-agents with state_machines
    - RAG with LlamaIndex
    - evaluation with Langfuse
      - offline
      - online
  - Self-hosting Moco
  - run moco workflows on desktop
- reference
    - workflowspec syntax
    - activity catalog

