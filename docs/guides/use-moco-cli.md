---
sidebar_label: Using the Moco CLI
sidebar_position: 0
---

# Using the Moco CLI

`moco` is the command-line client for the Moco platform. It validates workflow specs locally, runs
them on a Moco service, publishes them to a namespace, and manages the secrets, state, and
credentials your workflows depend on.

The CLI is a **thin client**. Apart from schema validation, nothing executes locally — the CLI
bundles your YAML, sends it to the service over MCP, and streams progress back. You do not need
Python, Docker, or a Temporal server on your machine.

If you are setting up for the first time, follow the [Quick Start](../quick-start.md) — it walks
through install, login, and your first workflow. This guide is the command-by-command reference.

---

## Installation

The CLI is published as an npm tarball under
[`https://www.my-moco.com/tools/`](https://www.my-moco.com/tools/):

```bash
curl -O https://www.my-moco.com/tools/moco-cli-1.0.0.tgz

npm i -g moco-cli-1.0.0.tgz

moco --help
```

It is a single self-contained package. Node.js 18+ is required. If you installed an older
version that shipped a separate `moco-lib` tarball, remove it with `npm uninstall -g @moco/lib`.

---

## Configuration

The CLI's settings are grouped into **profiles**, one per Moco service. Each profile has its own
endpoint, auth settings, login tokens, session and API key, so switching between servers never
sends one server's credentials to another.

Two profiles are built in:

| Profile | Endpoint | Auth |
|---------|----------|------|
| `local` (default) | `http://localhost:8080/mcp` | none: the local dev server runs with auth disabled, every request as `admin` |
| `my-moco` | `https://www.my-moco.com/mcp` | OAuth2 (`moco login`) |

```bash
moco profile list                 # * marks the active profile
moco profile use my-moco          # switch
moco profile current
moco run my.wfspec.yaml --profile local   # one command against another profile
```

`local` needs no setup: it comes with a session for the dev server's `admin` user (home and
working namespace `admin`), so `moco run` and `moco publish` work straight after installing.
The first `moco publish` (or `moco session select`) initializes that session with the server,
which creates the `admin` namespace, and stores the server's session in its place.

An install that already used `my-moco` as the default before `local` became the default stays
on `my-moco`.

`MOCO_PROFILE=<name>` does the same as `--profile` for a whole shell session. The order is
`--profile`, then `MOCO_PROFILE`, then the profile chosen with `moco profile use`.

### Your own profiles

```bash
# a self-hosted server
moco profile create acme --endpoint https://moco.acme.internal/mcp --use

# start from an existing profile and change one setting
moco profile create acme-dev --from local --endpoint http://devbox:8080/mcp

moco profile show acme            # effective settings
moco profile delete acme          # also removes its stored tokens and API key
```

### Settings

`moco config` reads and changes the active profile (or the one named with `--profile`):

```bash
moco config list
moco config get mcp_endpoint
moco config set auth.client_id my-client-id --profile acme
```

| Key | Default | Meaning |
|-----|---------|---------|
| `mcp_endpoint` | per profile | The Moco service's MCP endpoint. Every command except `validate` goes here. |
| `auth.mode` | `oauth` | `oauth`, or `none` for a server with authentication disabled |
| `auth.authorize_url` | Google OAuth2 | Authorization endpoint of the identity provider |
| `auth.token_url` | Google OAuth2 | Token endpoint |
| `auth.redirect_url` | `http://localhost:3000/auth` | Local redirect the CLI listens on during login |
| `auth.client_id` | `moco-cli` | OAuth2 client ID |
| `auth.token_type` | `id_token` | Which token is sent to the service — `id_token` or `access_token` |

The `auth.*` defaults work for the hosted service. Change them only if your deployment uses a
different identity provider. On a built-in profile, `moco config set` stores just the changed
setting; `moco profile reset <name>` goes back to the built-in values.

Settings live in `~/.moco/config.json`. Each profile's `tokens.json` (OAuth tokens),
`session.json` (cached session and working namespace) and `credentials.json` (API key) live in
`~/.moco/profiles/<name>/`. The downloaded wfspec schema (`~/.moco/schemas/`) is shared by all
profiles.

If you used the CLI before profiles existed, your configuration is moved into a profile named
`default` the first time you run a command, and that profile stays active.

---

## Authentication

Moco accepts two credentials: an **OAuth2 session** (interactive, for humans) and an **API key**
(non-interactive, for scripts and CI).

### OAuth2 login

```bash
moco login
moco logout          # clear tokens
moco logout --all    # also clear the stored API key
```

`moco login` runs an OAuth2 PKCE flow: your browser opens, you authenticate, and the CLI receives
the token on `auth.redirect_url`. Tokens are cached and refreshed automatically.

### API keys

```bash
moco apikey create ci-runner --expires-in 90d --save
moco apikey list
moco apikey list --include-revoked
moco apikey get <key-id>
moco apikey revoke <key-id>      # keeps the record, stops the key working
moco apikey delete <key-id>      # removes the record entirely
```

`moco apikey create` prints the key **exactly once** — there is no way to read it back. `--save`
stores it for this CLI to use. `--expires-in` accepts `30d` / `12h` / `90m`; `--expires-at` takes an
ISO-8601 instant.

To hand a key to a machine that did not create it:

```bash
moco apikey set              # reads the key from stdin
moco apikey set <key>
moco apikey clear
moco apikey status           # which credential will be used
moco apikey status --reveal
```

A key in the `MOCO_API_KEY` environment variable takes precedence over the stored one — the usual
way to authenticate in CI without writing anything to disk.

When both an API key and OAuth tokens are available the API key wins. Force one explicitly with
`--auth oauth` or `--auth apikey`, available on every command that talks to the service.

### Logging in with an API key

```bash
moco login --apikey <key>    # log in as the key's user, and store the key
moco login --apikey -        # same, reading the key from stdin
moco login --apikey          # use the key already in play (MOCO_API_KEY, stored, or guest)
```

`moco login --apikey` skips the browser: it uses the key to start your session (working namespace,
roles) directly. A key passed on the command line is stored for the profile, like `moco apikey
set`, but only once the login has succeeded, so a mistyped or revoked key never replaces a working
one. This also works on profiles without OAuth, such as `local`, where a plain `moco login` does
nothing.

---

## Sessions and namespaces

A **namespace** is where workflow specs live. Logging in (with OAuth2 or `--apikey`) selects your home namespace as the working
namespace; publishing and secret management default to it.

```bash
moco session show                    # user, working namespace, roles, privileges
moco session select <namespace-id>   # switch working namespace
```

---

## Validating

```bash
moco validate src/my-workflow.yaml
```

`validate` runs entirely locally and needs neither a login nor a running service — so it is the
right thing to put in a pre-commit hook. It checks a wfspec in two passes:

1. **Schema.** The document's structure against the workflowspec JSON schema: the top-level keys,
   the shape of every task kind, variable names and their modifiers, and the input fields of every
   activity type.
2. **Static rules** the schema cannot express, among them:
   - every `task_name` is unique in the document, including inside `functions`;
   - a task has exactly one kind key (reported once, naming the keys it found);
   - `branches` starts with `if`, uses `elif` after that, and ends with at most one `else`;
   - `raise` with `type: exit` sits inside a `tasks` container, and `break` / `continue` inside a
     `loop`; `error_type` is used only with `type: error`;
   - a `workflow` task has exactly one of `ref`, `function`, `contents`, `contents_yaml`, and a
     `function` call is `inline`;
   - no variable write targets a reserved name such as `_` or `__context__`, and no name is both
     task-local and container-scoped (`_name@`);
   - nested loops do not reuse a `foreach` or `index` name;
   - state machine transitions name declared states.

Problems that do not make the spec invalid — `props.execute_mode` on a task that is not a `tasks`
container, say — are printed as warnings. A valid spec prints its `workflow_name`; its version is
the package's, set in `moco.json`.

The schema ships with the CLI, but the service's schema advances as activities are added. Keep them
in sync:

```bash
moco schema update     # download the current schema from the configured service
moco schema show       # print the active schema and where it came from
```

The same schema drives autocompletion and inline diagnostics in the VSCode extension.

---

## Running workflows

```bash
moco run <file-or-name>
```

The argument is treated as a **file path** when it ends in `.yaml` or `.yml`, and as a **deployed
workflow name** otherwise:

```bash
moco run src/hello-moco.yaml                 # local file
moco run hello-moco                          # deployed, resolved by name
```

Running a local file bundles the spec together with the child workflows it references by `ref`
(found as `<workflow_name>.yaml` next to it) and sends the whole bundle; nothing needs to be
published first. Children given inline with `contents` travel inside the spec already. This is the normal development loop.

| Option | Effect |
|--------|--------|
| `-i, --input <json>` | Input data as a JSON string |
| `-o, --output <file>` | Also write the result to a file |
| `-t, --timeout <sec>` | MCP request timeout (`0` = no timeout, the default for `run`) |
| `--in-memory` | Run in-process on the server, no Temporal (`execute_mode: in-memory`) |
| `--activity` | Run the whole workflow as one Temporal activity (`execute_mode: standalone-activity`) |
| `--tier <tier>` | Execution tier, e.g. `dev`, `beta`, `prod` |
| `--user-id`, `--user-org` | Override the identity the workflow runs as |
| `--trace` | Emit OpenTelemetry traces for the run |
| `--debug` | Verbose logging and debug traces |

`--in-memory` and `--activity` are mutually exclusive. See
[How Workflows Run](../concepts/how-to-run-workflow.md) for what each mode gives up.

`--output` writes the result payload on its own, which matters because progress lines and the
result share stdout — redirecting with `>` captures both. The format follows the extension: `.json`
writes pretty-printed JSON, `.yaml`/`.yml` writes YAML, any other extension writes a string result
verbatim (useful for markdown or CSV), falling back to JSON for non-strings.

### Debug traces

Debug mode is enabled **automatically when you run a local file**, so variables marked with the `#`
modifier stream to your terminal as they are evaluated:

```yaml
- task_name: build-summary
  set:
    - stars#: '{{ repo_info.get("stargazers_count", 0) }}'
```

When running a *deployed* workflow by name, pass `--debug` to get the same traces. Traces from
child workflows are collected and interleaved automatically.

### Asynchronous runs

`run` blocks until the workflow finishes. For long-running workflows, start one and manage it by
ID:

```bash
moco start src/monitor.yaml -i '{"symbol": "AAPL"}'
moco status <workflow-id>
moco history <workflow-id>
moco cancel <workflow-id>                  # graceful — the workflow can run cleanup
moco terminate <workflow-id> -r "stuck"    # forceful — no cleanup
```

`moco history` returns the chronological event list for a run (activity scheduled, started,
completed, failed) — the first place to look when a run behaved unexpectedly.

`start`, `cancel`, `terminate`, `status`, and `history` require Temporal. They are not available for
`--in-memory` runs, which have no durable handle to address.

---

## Running a single activity

Sometimes you want to exercise one activity without wrapping it in a workflow — checking an HTTP
endpoint's shape, verifying credentials, or reproducing an activity failure in isolation:

```bash
moco activity run http.request -i '{"method": "GET", "url": "https://api.github.com"}'
moco activity run sql.query -i @query-input.json -c @db-config.yaml
```

`-i/--input` and `-c/--config` accept inline JSON, or `@path` pointing at a `.json` or `.yaml` file.

```bash
moco activity start <type> -i @input.json    # returns an activity ID
moco activity result <activity-id>
moco activity cancel <activity-id>
moco activity terminate <activity-id>
```

Standalone activities default to `max_attempts=1` with a 24-hour timeout. Override with
`--retry-policy '{"max_attempts": 3, "timeout_sec": 60}'`. `moco activity run --in-memory` dispatches
in the server process, which means no Temporal worker is needed.

---

## Testing

```bash
moco test                                  # everything under ./tests/
moco test tests/hello-moco.test.yaml       # one file
moco test 'tests/**/*.test.yaml'           # a glob
```

| Option | Effect |
|--------|--------|
| `--in-memory` | Run tests on the in-memory runtime (no Temporal) |
| `--verbose` | Per-test workflow progress and server log messages |
| `-t, --timeout <sec>` | MCP request timeout (default 300) |
| `--debug` | HTTP-level debug logging |

Test files are `*.test.yaml` and support mocked activities and assertions. See
[Testing Workflows](./testing.md) for the file format.

---

## Publishing

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

The package needs an **entry point**: one source file whose `header.workflow_name` equals
`wfspec_package_name`. The remaining sources are child workflows it may reference by `ref`. Every
workflow in the package takes the package's version, `wfspec_package_version`.

Add `"share_to_all": true` to let every user run the workflow without being a deployment target.
When the field is present, every publish sets the flag to its value, `true` or `false`, overriding
a change made in the console. Leave it out to keep whatever the flag is currently set to.

```bash
moco publish --dry-run                     # validate and show what would be published
moco publish
moco publish --namespace <namespace-id>    # publish somewhere other than the working namespace
```

Publishing stores the package. Making a version resolvable by name in a stage (`dev`, `beta`,
`prod`) is a separate **deployment** step, done from the web console. Once deployed,
`moco run hello-moco` resolves through the deployment — so bumping `wfspec_package_version` and
republishing rolls callers forward without them changing anything.

---

## Secrets

Secrets are encrypted **client-side** before upload; the service stores ciphertext and workflows
resolve them at execution time through the `secret.*` activities.

```bash
moco secret list
moco secret upload OPENAI_API_KEY sk-...
moco secret delete OPENAI_API_KEY
```

`--global` targets the global (shared) namespace instead of your own; `--force` skips the delete
confirmation. See the [secret activity reference](../reference/activities/secret.md) for how
workflows read them.

---

## Uploading state

Workflows read and write persistent state through the `state.*` activities. To seed that store with
a local dataset:

```bash
moco state upload data/customers.csv --key customers
moco state upload data/config.json --key app-config --topic settings
```

| Option | Effect |
|--------|--------|
| `--key <key>` | State key name (prompted if omitted) |
| `--namespace <ns>` | Target namespace (prompted if omitted; defaults to `uploads`) |
| `--topic <topic>` | Topic used for categorization |
| `--in-global-ns` | Store in the global, non-user-scoped namespace |

Only `.json` and `.csv` files are accepted.

---

## Command summary

| Command | Purpose |
|---------|---------|
| `moco validate <file>` | Schema-check a wfspec locally |
| `moco run <file-or-name>` | Execute a workflow and wait for the result |
| `moco start <file-or-name>` | Start a workflow, return its ID |
| `moco status <id>` / `history <id>` | Inspect a run |
| `moco cancel <id>` / `terminate <id>` | Stop a run gracefully / forcefully |
| `moco activity run\|start\|result\|cancel\|terminate` | Work with a single activity |
| `moco test [path]` | Run `*.test.yaml` suites |
| `moco publish [dir]` | Publish a package from `moco.json` |
| `moco login [--apikey]` / `logout` | Log in (OAuth2 or API key) and start a session |
| `moco apikey …` | Create and manage API keys |
| `moco session show` / `select` | Inspect or switch the working namespace |
| `moco profile list` / `use` / `create` / … | Switch between Moco services |
| `moco config get` / `set` / `list` | Settings of the active profile |
| `moco schema update` / `show` | Sync the validation schema |
| `moco secret list` / `upload` / `delete` | Manage secrets |
| `moco state upload <file>` | Seed persistent state |

---

## Next steps

- [How Workflows Run](../concepts/how-to-run-workflow.md) — execute modes and options
- [Running Workflows Through the API](./run-moco-workflow-through-api.md) — REST and MCP
- [Testing Workflows](./testing.md) — writing test suites
- [Writing Workflows](./writing-workflows.md) — authoring patterns
