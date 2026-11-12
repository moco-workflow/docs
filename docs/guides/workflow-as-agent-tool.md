---
sidebar_label: Workflows as Agent Tools
sidebar_position: 8
---

# Exposing a Workflow as an Agent Tool

An agent built on the moco agent harness can call your deployed workflows as **tools**: the
model decides when a workflow would help, fills in its input, and gets its output back. A
workflow opts in by declaring `header.metadata.tool`. Nothing is offered until an agent admin
imports it.

## Declare the tool

Add a `tool` block to the workflow's `header.metadata`:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: count-words
  metadata:
    tool:
      description: "Count the words and characters of a text exactly. Use when the user asks how long a text is."
      parameters:
        type: object
        properties:
          text: {type: string, description: "The text to count."}
        required: [text]
      side_effects: none

input:
  text: ""

output:
  words: "{{ words }}"
  characters: "{{ characters }}"

main:
  task_name: count
  set:
    - words: "{{ len(str(text).split()) }}"
    - characters: "{{ len(str(text)) }}"
```

| Field | Required | Meaning |
| --- | --- | --- |
| `description` | yes | What the model reads to decide whether to call the tool. Say what it does and when to use it |
| `parameters` | yes | A JSON Schema with `type: object`. Its properties become the workflow's `input` |
| `side_effects` | yes | `none`, `read`, `write` or `external`. A tool that writes or reaches outside asks the user for approval by default |
| `name` | no | The tool's name. Default: `workflow_name` with `-` and `.` replaced by `_` |
| `mode` | no | `sync` (default) or `async`. An async tool runs in the background and reports back later |
| `timeout_sec` | no | At most 300 for a sync tool, 3600 for an async one |

Each `parameters` property should be a declared `input` key; `moco validate` warns about one
that is not. The model's arguments are passed as the workflow's input, and its `output` is the
tool's result.

## Validate and publish

```bash
moco validate src/count-words.yaml
moco publish
```

`moco validate` reports a malformed `tool` block. `moco publish` refuses to publish one, and
collects every valid declaration in the package into the package manifest (`manifest.tools`),
which is where agents find them. Two tools with the same name in one package are an error.

## Make it available to an agent

An agent admin adds a **workflow provider** in the agent UI: **Tools → Providers → Add
provider**, source **Deployed workflows**. The list shows the declared tools deployed to that
admin on the stage, newest version per package. Tick the ones to import, then add the
provider's toolset to the agent.

- The tool runs as the **calling user**, so the user must be targeted by the workflow's
  deployment, exactly as if they ran it themselves.
- The admin can only make a tool stricter: a provider may raise its side effects or require
  approval, never lower what the workflow declares.
- If a new version changes the `tool` block (description, parameters, side effects), the
  provider marks the tool as changed and disables it until an admin accepts the change. A
  redeploy that leaves the block alone changes nothing.
