---
sidebar_position: 2
---

# Quick Start

This guide takes you from an empty machine to a workflow you have written, published, and
deployed. It runs everything on your own machine: a **Moco dev server** in Docker, the **Moco
CLI** for development, and the **Moco web console** for release.

You will:

1. Start a Moco dev server
2. Install the `moco` CLI
3. Run existing example workflows
4. Build and run your first workflow
5. Publish it and run the deployed version
6. Manage it in the web console

At the end, [Use the hosted service](#use-the-hosted-service-at-my-mococom) shows how to do
the same against `https://www.my-moco.com`.

## Prerequisites

- **Docker** with Compose v2.24 or later (runs the dev server)
- **Node.js 18+** (the CLI is distributed as an npm package)
- **Git** (to clone the dev server and the examples)

You do **not** need Python or a Temporal install. Docker runs the whole platform, and the CLI is
a thin client: workflows execute on the server.

---

## 1. Start the Moco dev server

The dev server is a single compose file, published at
[moco-workflow/moco-dev-server](https://github.com/moco-workflow/moco-dev-server), that runs a
complete Moco platform from published images:

```bash
git clone https://github.com/moco-workflow/moco-dev-server.git
cd moco-dev-server

docker compose up -d
docker compose ps          # wait until moco-runtime is "healthy" (first start: ~30s)
```

Everything is served at `http://localhost:8080`:

- `/ui` — the web console
- `/docs` — this documentation
- `/tools/` — the `moco` CLI tarball

Auth is disabled on the dev server: every request runs as the built-in `admin` user, so
nothing asks you to sign in. Keep it on a machine nobody else can reach. The
[repository README](https://github.com/moco-workflow/moco-dev-server#readme) covers
configuration (LLM endpoints, ports, Langfuse), upgrading and resetting.

---

## 2. Set up the Moco CLI

### Install

The dev server serves the CLI under
[`http://localhost:8080/tools/`](http://localhost:8080/tools/) (the directory is browsable and
shows the version):

```bash
curl -O http://localhost:8080/tools/moco-cli-1.0.0.tgz

npm i -g moco-cli-1.0.0.tgz

moco --help
```

It is a single self-contained package.

### Check the connection

There is nothing to configure and no login. The CLI's default profile, `local`, points at the
dev server (`http://localhost:8080/mcp`) and comes with a session for its `admin` user:

```bash
moco profile current       # local
moco session show          # Working Namespace: admin
```

A **namespace** is where your workflow specs live. The session's working namespace, `admin`
(the admin user's home namespace), is where `moco publish` puts them. To work in another one:

```bash
moco session select <namespace-id>
```

---

## 3. Run the examples

The example workflows live in the [moco-workflow](https://github.com/moco-workflow)
GitHub organization. Clone the examples repository and run one:

```bash
git clone https://github.com/moco-workflow/moco-examples.git
cd moco-examples/moco-workflow-demo

moco validate src/sequence-demo.yaml
moco run src/sequence-demo.yaml
```

`moco validate` checks the YAML against the workflowspec schema locally — no server needed.
`moco run <file>` bundles the spec (plus any child workflows it references), sends it to the
service, streams progress back to your terminal, and prints the result:

```
✓ Workflow executed successfully

Result:
"Hello, your request was received at 2026-08-30 10:15:04. Current time is 2026-08-30 10:15:05"
```

Useful options while developing:

```bash
moco run src/sequence-demo.yaml --input '{"name": "Moco"}'   # pass input data as JSON
moco run src/sequence-demo.yaml --debug                      # verbose logs and debug traces
moco run src/sequence-demo.yaml --in-memory                  # run in-process, no Temporal
moco run src/sequence-demo.yaml --output result.json         # also save the result to a file
```

`--output` (short form `-o`) is worth reaching for whenever the result is large or you want to
feed it into another tool. Progress and log lines share stdout with the result, so redirecting
with `>` captures both — `--output` writes the result payload on its own. The format follows the
file extension: `.json` writes pretty-printed JSON, `.yaml`/`.yml` writes YAML, and any other
extension writes a string result verbatim (useful for a workflow that returns markdown or CSV),
falling back to JSON for non-strings. The result is still printed to the terminal as usual.

Long-running workflows can be started asynchronously and managed by workflow ID:

```bash
moco start src/sequence-demo.yaml
moco status <workflow-id>
moco cancel <workflow-id>       # graceful, allows cleanup
moco terminate <workflow-id>    # forceful
```

Examples ship with tests (`tests/*.test.yaml`) that you can run with:

```bash
moco test tests/sequence-demo.test.yaml
moco test                       # everything under ./tests/
```

Browse the other example projects — `state-machine-demo`, `rules-engine-demo`,
`web-crawler-demo`, `task-manager` — to see state machines, rules, and AI activities in action.

---

## 4. Build your first workflow

Create a project directory with a `src/` folder:

```bash
mkdir -p hello-moco/src && cd hello-moco
```

Save this as `src/hello-moco.yaml`. It calls a public HTTP API and turns the response into a
short summary:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: hello-moco

input:
  owner: temporalio
  repo: temporal

output: '{{ summary }}'

main:
  tasks:
    # Call an external API
    - task_name: fetch-repo
      activity:
        type: http.request
        input:
          method: GET
          url: 'https://api.github.com/repos/{{ owner }}/{{ repo }}'
          output_json: true
      output:
        data: '{{ _.get("json", {}) }}'
        as: repo_info

    # Shape the result
    - task_name: build-summary
      set:
        - summary:
            name: '{{ repo_info.get("full_name") }}'
            stars: '{{ repo_info.get("stargazers_count", 0) }}'
            description: '{{ repo_info.get("description") }}'
```

A few things to notice:

- `header` names the workflow. Its version comes from the package you publish it in (step 5), so
  the file itself carries none.
- `input` declares the parameters and their defaults; the caller's values win.
- `main` holds one **task**. Here it is a `tasks` container, which runs its children in order.
- Each task has exactly one **kind**: `activity` performs work against the outside world, `set`
  only assigns variables. `task_name` is optional, but it names the task in logs and lets tests
  mock it.
- Anything inside `{{ }}` is a sandboxed Python expression. Inside a task's `output`, `_` is what
  the task returned — here the HTTP response. `output.data` reshapes it and `output.as` stores the
  result in the variable `repo_info`.
- The top-level `output` is evaluated after `main` finishes and becomes the workflow result.

Validate and run it:

```bash
moco validate src/hello-moco.yaml
moco run src/hello-moco.yaml
moco run src/hello-moco.yaml --input '{"owner": "python", "repo": "cpython"}'
```

```
✓ Workflow executed successfully

Result:
{
  "name": "python/cpython",
  "stars": 77489,
  "description": "The Python programming language"
}
```

### Debugging tip: the `#` modifier

Append `#` to a variable name and its evaluated value is streamed back to your terminal during
execution — the fastest way to see what an expression actually produced:

```yaml
- task_name: build-summary
  set:
    - stars#: '{{ repo_info.get("stargazers_count", 0) }}'
```

It works anywhere a variable is written, including `output.as: repo_info#`.

Traces from child workflows are collected automatically. When running a *deployed* workflow, add
`--debug` to print them.

---

## 5. Publish your workflow

A published unit is a **package**: one or more wfspec files versioned together. Describe it with a
`moco.json` in your project root:

```json
{
  "wfspec_package_name": "hello-moco",
  "wfspec_package_version": "1.0.0",
  "wfspec_description": "Summarize a GitHub repository",
  "sources": ["src/**/*.yaml"],
  "tests": ["tests/**/*.yaml"]
}
```

The package needs an entry point: one source file whose `header.workflow_name` equals
`wfspec_package_name` (here, `hello-moco.yaml`). The others are child workflows it can reference.
Every workflow in the package takes the package's version, `wfspec_package_version`.

Preview, then publish to your working namespace:

```bash
moco publish --dry-run
moco publish
```

The first `moco publish` initializes your session with the server, which creates the `admin`
namespace; later publishes go straight there.

```
✓ Found and validated 1 workflow file(s)
✓ Wfspec created/updated in namespace
✓ Published package
Package: hello-moco:1.0.0
```

To publish elsewhere, use `moco publish --namespace <namespace-id>`.

### Deploy and run the deployed version

Publishing stores the package; **deploying** makes a version resolvable by name in a stage
(`dev`, `beta`, or `prod`). Deploy from the web console (see the next section), then run your
workflow by name instead of by file path:

```bash
moco run hello-moco --input '{"owner": "python", "repo": "cpython"}'
moco run hello-moco --debug
```

Because the name resolves through the deployment, bumping `wfspec_package_version` and
republishing rolls callers forward without them changing anything.

---

## 6. Manage in the web console

Open [`http://localhost:8080/ui`](http://localhost:8080/ui). It opens without a sign-in, as
`admin`. The console is where you own the lifecycle of your workflows.

**Create a wfspec.** In your namespace, create a wfspec entry with a name, description, owner, and
tags. This is the container that versioned packages are published into — the same entry
`moco publish` creates for you.

**Publish a new version.** On a wfspec page, publish a package by setting a semantic version
(major / minor / patch), optional manifest metadata, and the workflow file contents. Use this for
quick edits in the browser, or keep publishing from the CLI — both write to the same place.

**Deploy to a stage.** Deploy a package version to `dev`, `beta`, or `prod`. Start in `dev`,
verify with `moco run <name>`, then promote the same package to `prod`.

The console also manages **secrets** (encrypted values referenced from workflows) and
**persistent state** used by long-running workflows.

---

## Use the hosted service at my-moco.com

Everything above works the same against the hosted service at `https://www.my-moco.com`, with
your own account. Install the CLI from there if you don't have it yet:

```bash
curl -O https://www.my-moco.com/tools/moco-cli-1.0.0.tgz
npm i -g moco-cli-1.0.0.tgz
```

Switch to the built-in `my-moco` profile and log in:

```bash
moco profile use my-moco
moco login
```

`moco login` runs an OAuth2 PKCE flow: your browser opens, you authenticate, and the CLI
receives the token on its local redirect URL. Login also initializes your session and selects
your home namespace as the working namespace. Tokens and sessions are kept per profile, so
`moco profile use local` switches back to the dev server without logging out. To run a single
command against the other profile, add `--profile <name>` (or set `MOCO_PROFILE`):

```bash
moco run src/hello-moco.yaml --profile my-moco
```

The console is at [`https://www.my-moco.com/ui`](https://www.my-moco.com/ui); sign in with the
same account. A hosted service has other users, so you can **share** a workflow: a deployment can
be targeted at specific users or user groups. Add a colleague's user ID (or a group they belong
to) as a target and they can run your workflow by name from their own CLI or from the API,
without a copy of your YAML and without deploying anything themselves. Namespace privileges
control who can view, edit, and deploy alongside you.

For your own self-hosted server, create a profile for it:

```bash
moco profile create my-server --endpoint https://moco.example.com/mcp --use
```

See [Using the Moco CLI](./guides/use-moco-cli.md#configuration) for the profile settings,
including the OAuth2 provider (`auth.*`).

---

## Next steps

- [Core Concepts](./concepts/overview.md) — how Moco models workflows
- [Workflowspec](./concepts/workflowspec.md) — structure of a spec
- [Tasks](./reference/statements.md) — `tasks`, `loop`, `branches`, `switch`, `state_machine`, and more
- [Writing Workflows](./guides/writing-workflows.md) — build a workflow step by step
- [Expressions](./concepts/expressions.md) — the `{{ }}` expression language
- [Activities](./concepts/activities.md) — HTTP, Kafka, shell, S3, OpenAI, MCP, and custom activities
- [State Machines](./concepts/state-machines.md) — event-driven and human-in-the-loop workflows
- [Testing](./guides/testing.md) — writing `*.test.yaml` suites for your workflows
