---
sidebar_label: Shell
---

# Shell Activities

One activity, `shell.run`, executes a command on the worker and returns its exit code and output.

## Setup

No configuration. The command runs as the worker's own operating-system user, with the worker's
filesystem and network access.

:::danger This is the broadest privilege in the catalog
`shell.run` can do anything the worker process can do. Every call asserts the
`internal.shell_activities / invoke` privilege, so a deployment can restrict who may use it — but
**if that policy is not deployed the check passes**, leaving arbitrary command execution open to
any workflow. See [Authz Activities](./authz.md).

For the same reason `shell.run` can never be bridged into
[`claude_agent.query`](./claude-agent.md) as an agent tool, at any privilege level.
:::

---

## `shell.run`

Runs a command, waits for it to finish, and returns `return_code`, `stdout` and `stderr`.

A non-zero exit code is **not** an error by default — the activity returns normally with
`return_code` set. Use `check: true` to fail the activity instead.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `command` | str | yes | — | The command line to run |
| `shell` | bool | no | `true` | Run through the system shell, so pipes and redirects work |
| `capture_output` | bool | no | `true` | Capture `stdout`/`stderr`. When false, both come back `null` |
| `check` | bool | no | `false` | Raise and fail the activity when the exit code is non-zero |
| `cwd` | str | no | worker's cwd | Working directory for the command |
| `env` | dict[str, str] | no | `null` | Extra environment variables |
| `timeout` | number | no | `options.retry_policy.timeout_sec` | Seconds before the process is killed |
| `text` | bool | no | `true` | Decode output as text. When false, `stdout`/`stderr` are raw bytes |
| `encoding` | str | no | `"utf-8"` | Decoding used when `text` is true |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `return_code` | int | Process exit code; `0` means success |
| `stdout` | str \| bytes \| null | Standard output, or `null` when `capture_output` is false |
| `stderr` | str \| bytes \| null | Standard error, or `null` when `capture_output` is false |

**Examples**

Reading a file into a workflow variable:

```yaml
- task_name: load-submit-task-tests
  activity:
    type: shell.run
    input:
      command: 'cat {{ test_dir }}/submit-task.test.yaml'
  output:
    set:
      - submit_task_yaml: '{{ _["stdout"] }}'
```

Running a script that has side effects — note `max_attempts: 1`:

```yaml
- task_name: rebuild-index
  activity:
    type: shell.run
    input:
      command: './bin/reindex.sh --since {{ since_date }}'
      cwd: /opt/pipeline
      env:
        PIPELINE_MODE: batch
      check: true            # non-zero exit fails the activity
      timeout: 900
    options:
      retry_policy:
        timeout_sec: 900
        max_attempts: 1      # the script is not idempotent
  output:
    as: reindex              # -> return_code, stdout, stderr
```

Branching on the exit code without `check`:

```yaml
- task_name: probe-service
  activity:
    type: shell.run
    input:
      command: 'curl -sf http://localhost:8080/health'
  output:
    set:
      - service_up: '{{ _["return_code"] == 0 }}'
```

:::caution The default retry policy runs the command up to three times
`shell.run` inherits the platform default of 3 attempts. Set `options.retry_policy.max_attempts: 1` for any command
with side effects.
:::

:::note Timeouts nest
When `timeout` is omitted it inherits `options.retry_policy.timeout_sec`, so the process can never outlive
its own activity budget. Set `timeout` explicitly only when you want the process killed sooner
than the activity gives up.
:::

:::note Secrets in `env` are plaintext
Anything you put in `env` is written in the wfspec and passed through workflow context. To
use a credential, resolve it inside an activity that accepts a `*_secret_key` field instead — see
[Secret Activities](./secret.md).
:::
