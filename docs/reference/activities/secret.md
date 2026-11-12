---
sidebar_label: Secrets
---

# Secret Activities

Four activities manage the secret store — the place API keys, connection strings and service
credentials live so they never appear in a wfspec.

## How secrets reach an activity

**Most of the time you will not use these activities at all.** An activity that needs a credential
takes the *name* of a secret rather than the secret itself, in a field ending `_secret_key`:

| Activity | Field |
| --- | --- |
| [`openai.chat.completions`](./openai.md) | `apikey_secret_key` |
| [`sql.query`](./sql.md), [`sql.execute`](./sql.md) | `connection_string_secret_key` |
| [`email.send`](./email.md) | `password_secret_key` |
| [`gdrive.*`](./gdrive.md) | `auth.credentials_secret_key` |
| [`llama_index.*`](./llama-index.md) | `vectordb_info.connection_string_secret_key`, `embed_model_info.apikey_secret_key`, `llm_model_info.apikey_secret_key`, `auth.token_secret_key` |
| [`claude_agent.query`](./claude-agent.md) | `apikey_secret_key`, per-server `headers_secret_key` |

The activity resolves and decrypts the secret internally, so nothing sensitive ever enters workflow
context. A bare `NAME` resolves a secret owned by the calling user; `global/NAME` resolves one from
the shared global store.

Use [`builtin.secret.get`](#builtinsecretget) only where an activity has no such field — today
that means [`http.request`](./http.md#authentication), whose `encrypted_auth_token` takes the
encrypted blob directly.

## Setup

Secrets are stored in the database named by `MOCO_DB_CONN_STR`, under the reserved namespaces
`secret` (global) or `<user_id>:secret` (per user).

:::caution No database means no durability
With `MOCO_DB_CONN_STR` unset the provider falls back to an in-process store and warns. Secrets
then disappear on restart and are not shared between workers.
:::

The [state activities](./state.md) cannot reach those namespaces — they raise
`ReservedNamespaceError`, including for another user's `<user_id>:secret`, and omit them from
`list_namespaces`. Stored secrets are reachable only through the activities on this page, so the
expiration below cannot be sidestepped by reading the row directly.

## Encryption

A secret is encrypted end to end and moco is careful about which form is where:

1. The client encrypts the secret with the secret manager's **RSA public key** and uploads it.
2. The server decrypts it with the private key and **re-encrypts it with a symmetric key** before
   writing it to the database. The stored form never expires.
3. `builtin.secret.get` decrypts the stored form and re-encrypts it with a **short expiry**, so
   the copy handed to the workflow cannot be replayed later.

Plaintext exists only inside the secret manager and inside the activity that consumes the secret.

## Global secret permissions

A global secret is either **open** (every user can use, replace and delete it, the only behaviour
before this feature) or **protected**. User secrets are private by construction and have no
permissions. The model is the same as for
[global state namespaces](./state.md#global-namespace-permissions), per secret:

| Role | Grants | Lets you |
| --- | --- | --- |
| `secret:<name>:reader` | `read` | **use** it: `builtin.secret.get`, a `global/<name>` secret key in any activity, and see it in `list` |
| `secret:<name>:writer` | `read`, `write` | the above, plus replace its value with `upload` |
| `secret:<name>:admin` | `read`, `write`, `admin` | the above, plus `delete`, and granting or revoking roles |

**What protects a secret.** Uploading a *new* global secret through `sys.secret` (the UI's
*Secrets → Global* view, or the MCP `execute_workflow` tool) protects it: you become its admin
and **every user (`*`) is added as reader**, so every workflow can still use it but only you can
replace or delete it. A global secret that already exists stays open when you re-upload it, and
so does one written directly by a workflow calling `builtin.secret.upload`. Protect one
explicitly with `protect`.

**Who is checked.** The calling user of the workflow, on every `builtin.secret.*` call on a
global secret and on every `global/<name>` secret key an activity resolves. A workflow that uses
a protected secret on behalf of many users needs each of them to hold `read`, which the default
`*` grant already gives. Members of the platform's `moco:admin` role pass every check. Denials
fail with `PermissionDeniedError`, which is not retried; `list` leaves out what you cannot read.

**Names.** A global secret's name must not contain `:`.

Manage permissions in the UI (*Secrets → Global*, the shield icon on a secret), or with the
`sys.secret` operators `acl`, `protect`, `unprotect`, `grant` and `revoke`. They take
`secret_name`, and `grant` / `revoke` also take `level` (`read`, `write`, `admin`) and one of
`grantee_user_id` (`*` for every user) or `grantee_group_id`:

```json
{"operator": "revoke", "secret_name": "OPENAI_KEY", "level": "read", "grantee_user_id": "*"}
```

That example makes the secret private: only users granted a role can use it afterwards.
**Deleting** a secret through `sys.secret` removes its roles too; the next uploader creates it
afresh and becomes its admin.

## Defaults

All four: 60 s timeout, 3 attempts.

---

## `builtin.secret.upload`

Stores a secret. The payload must already be encrypted with the secret manager's public key — in
practice you upload secrets with the `moco` CLI or the console rather than from a workflow, and
both do the encryption for you.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `secret_name` | str | yes | — | Name the secret will be referenced by |
| `encrypted_secret` | [EncryptedData](#encrypteddata) \| [EncryptedClientData](#encryptedclientdata) | yes | — | The encrypted payload |
| `in_global_ns` | bool | no | `false` | Store in the shared global store instead of the caller's |

#### EncryptedData

RSA-encrypted directly with the secret manager's public key.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `encrypted_data` | str | yes | The encrypted payload |
| `encrypt_key_name` | str | yes | Name of the key used |

#### EncryptedClientData

For payloads too large for RSA: the client picks its own symmetric key, encrypts the data with it,
and RSA-encrypts only the key.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `encrypted_client_key` | [EncryptedData](#encrypteddata) | yes | The client's key, RSA-encrypted |
| `encrypted_client_data` | str | yes | The payload, encrypted with that key |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `result` | bool | `true` on success |

**Example**

The pattern used by the system workflow behind the CLI's secret commands, which picks the
operation from its `operator` input:

```yaml
- task_name: upload-secret
  skip_if: '{{ operator != "upload" }}'
  activity:
    type: builtin.secret.upload
    input:
      secret_name: '{{ secret_name }}'
      encrypted_secret: '{{ encrypted_secret }}'
      in_global_ns: '{{ in_global_ns }}'
  output:
    as: result
```

---

## `builtin.secret.get`

Returns a secret **still encrypted**, in a form the consuming activity can decrypt. Pass the result
straight through; do not try to read it.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `secret_name` | str | yes | — | Name of the secret |
| `in_global_ns` | bool | no | `false` | Read from the shared global store |
| `expiration_seconds` | int | no | `60` | How long the returned copy stays decryptable. `0` or negative disables expiration |

**Output**

An [EncryptedData](#encrypteddata) object, or `null` when no such secret exists.

**Example**

```yaml
- task_name: get-db-password
  activity:
    type: builtin.secret.get
    input:
      secret_name: database_password
      in_global_ns: false      # optional; true reads the shared global store
      expiration_seconds: 60   # optional; defaults to 60
  output:
    as: db_password
```

```yaml
- task_name: call-partner-api
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.partner.example.com/v1/accounts
      encrypted_auth_token: '{{ db_password }}'
```

:::caution Fetch late, not early
The returned copy **expires after `expiration_seconds`** (60 by default), so a copy that leaks into
logs, events or workflow history cannot be replayed. Decrypting an expired copy fails with
`EncryptedDataExpiredError`.

This matters for long-running workflows: a state machine that waits on events for minutes or hours
must not fetch the secret once at startup and hold it. Re-run `builtin.secret.get` in each state
that needs it, so every use gets a freshly minted copy.

Passing `0` or a negative value disables expiration entirely, restoring the old replayable
behaviour — use it only when re-fetching genuinely isn't possible.
:::

---

## `builtin.secret.list`

Lists the names of the secrets in a store. Values are never returned.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `in_global_ns` | bool | no | `false` | List the shared global store |

**Output**

A list of secret names.

**Example**

```yaml
- task_name: list-secret
  skip_if: '{{ operator != "list" }}'
  activity:
    type: builtin.secret.list
    input:
      in_global_ns: '{{ in_global_ns }}'
  output:
    as: result     # -> ["MY_LLM_TOKEN", "REPORTING_DB_CONN", ...]
```

---

## `builtin.secret.delete`

Removes a secret. Deleting a name that does not exist is not an error.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `secret_name` | str | yes | — | Name of the secret to delete |
| `in_global_ns` | bool | no | `false` | Delete from the shared global store |

**Output**

None.

**Example**

```yaml
- task_name: delete-secret
  skip_if: '{{ operator != "delete" }}'
  activity:
    type: builtin.secret.delete
    input:
      secret_name: '{{ secret_name }}'
      in_global_ns: '{{ in_global_ns }}'
  output:
    as: result
```

:::caution Deleting breaks running workflows
Any workflow whose activity resolves that `*_secret_key` fails on its next run. Check usage before
removing a shared secret.
:::
