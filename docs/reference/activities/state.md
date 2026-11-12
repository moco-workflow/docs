---
sidebar_label: State Store
---

# State Store Activities

Nine activities read and write a durable key/value store that outlives any single workflow run.
Use it to remember something between runs — a watermark, a task record, a cached lookup — where
workflow context, which dies with the run, would not do.

## Setup

No per-call credentials. The worker connects using `MOCO_DB_CONN_STR`. Global-namespace
permissions are read from the RBAC tables through `MOCO_DEPLOY_DB_CONN_STR` (falling back to
`MOCO_DB_CONN_STR`). Without either, every global namespace is open.

:::caution No database means no durability
If `MOCO_DB_CONN_STR` is unset the provider falls back to an in-process store and logs a warning.
State then vanishes on restart and is not shared between workers — fine for a local run, wrong
for anything else.
:::

## Namespaces and keys

Every entry is addressed by `namespace` + `key`, and the namespace you write is not always the
namespace used:

| `in_global_ns` | Resolved namespace | Visible to |
| --- | --- | --- |
| `false` *(default)* | `<user_id>:<namespace>` | Only the calling user |
| `true` | `<namespace>` | Every user of the deployment |

So two users writing `namespace: tasks, key: t-1` privately do not collide, while
`in_global_ns: true` is how a shared task queue or a shared cache is built.

A namespace must not contain `:`. That character is the separator in the resolved
`<user_id>:<namespace>` form, so every activity that takes a `namespace` rejects one containing
it with `InvalidInputDataError`, whatever `in_global_ns` is set to. Use `.` or `-` to structure
names instead, e.g. `agent.support.sessions`.

Values are serialized with moco's extended JSON encoder, so typed values — `datetime`, `Decimal`
and friends — round-trip rather than degrading to strings.

:::note The `secret` namespace is off limits
Secrets share this table under the reserved namespaces `secret` and `<user_id>:secret`. Every
activity here rejects them — `secret` with `ReservedNamespaceError`, and anything containing `:`
(such as another user's `<user_id>:secret`) with `InvalidInputDataError` — and `list_namespaces`
filters them out entirely. Use
[Secret Activities](./secret.md) instead.
:::

## Global namespace permissions

A global namespace is either **open** (every user can read, write and delete it, the only
behaviour before this feature) or **protected** (only users granted a role can touch it).
User-scoped namespaces are private by construction and have no permissions.

**What protects a namespace.** Writing to a new global namespace through `sys.state`
(`moco state upload --in-global-ns`, the UI's *My Data → global* view, or the MCP
`execute_workflow` tool with `sys.state`) protects it automatically. Three roles are created,
you are added as admin, and **every user (`*`) is added as reader**:

| Role | Grants | Lets you |
| --- | --- | --- |
| `state:<ns>:reader` | `read` | `get_state`, `get_state_with_ts`, `list_states`, and see it in `list_namespaces` |
| `state:<ns>:writer` | `read`, `write` | the above, plus `set_state`, `del_state`, `update_topic`, `delete_by_topic` |
| `state:<ns>:admin` | `read`, `write`, `admin` | the above, plus `delete_namespace`, and granting or revoking roles |

A namespace that **already holds rows** stays open when you write to it. So does one written
directly by a workflow calling `builtin.state.set_state`: existing workflows and the shared
namespaces they rely on are not locked by accident. Protect one explicitly with `protect`.

**Readable by everyone by default.** Protecting a namespace (on creation or with `protect`)
stops other users changing it, not reading it. To make it private, revoke the default grant:
`moco state revoke <ns> --level read --user '*'`.

**Who is checked.** The **calling user** of the workflow (`__user_info__.user_id`), on every
`builtin.state.*` call, whichever workflow makes it. A workflow that runs on behalf of many users
can only write a protected namespace if each of them is granted, typically
`--user '*'` or a group. Members of the platform's `moco:admin` role pass every check. A call
without a user id is denied on a protected namespace.

**When access is denied** the activity fails with `PermissionDeniedError`, naming the level it
needed. The error is not retried. `list_namespaces` does not fail: it leaves out protected
namespaces you cannot read.

Manage permissions in the UI (*My Data → Global*, open the namespace, **Permissions** tab: see
who has access, grant, revoke, protect or remove protection), with the CLI, or with `sys.state`
operators `protect`, `unprotect`, `grant`, `revoke` and `acl`:

```bash
moco state acl shared.queue                                 # who has what; is it protected?
moco state protect legacy.cache                             # adopt an open namespace; you become admin, everyone reads
moco state grant shared.queue --level read --user bob       # admin only
moco state grant shared.queue --level write --group ops
moco state revoke shared.queue --level read --user '*'      # make it private (everyone reads by default)
moco state revoke shared.queue --level read --user bob
moco state unprotect shared.queue                           # drop the roles: open again, rows kept
```

**Deleting a namespace** with `sys.state` `delete_namespace` (admin only) removes its roles as
well, so whoever writes it next creates it afresh and becomes its admin. Deleting its last key
with `delete` keeps the roles: a namespace that empties and refills keeps its grants and cannot be
claimed in between. A workflow calling `builtin.state.delete_namespace` directly removes only the
rows. Run `moco state unprotect <ns>` to drop the leftover roles.

Grants go to a role, so `revoke --level read` does not remove a `write` grant to the same user.
The roles are ordinary RBAC roles, so a grant to a user group follows group membership.

## Topics

`topic` is an optional free-text tag on a row, set when you write it. It exists for bulk
filtering (`list_states`) and bulk deletion (`delete_by_topic`) — tagging every task row with its
status, for instance, then listing or clearing one status at a time.

It is a **label on stored data**, unrelated to event-bus topics or to the `relay_topic` used by
[long-running activities](../activity-catalog.md#long-running-activities-and-the-relay-pattern).

Patterns (`key_pattern`, `topic_pattern`, `name_pattern`) use `*` as the wildcard.

:::caution Two topic traps
- **`set_state` always writes the topic column.** Re-saving a value without `topic` *clears* a tag
  set earlier. Use [`update_topic`](#builtinstateupdate_topic) to retag without rewriting.
- **Untagged rows are invisible to topic operations.** `topic_pattern: "*"` does not match rows
  whose topic is null, so `delete_by_topic` will not clear them.
:::

## Defaults

All nine: 60 s timeout, 3 attempts. All are safe to retry — writes are upserts and deletes are
idempotent.

---

## `builtin.state.set_state`

Writes a value, creating the entry or replacing it.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace, resolved per [Namespaces](#namespaces-and-keys) |
| `key` | str | yes | — | Key within the namespace |
| `value` | any | yes | — | The value to store; any JSON-serializable structure |
| `topic` | str | no | `null` | Tag for bulk operations. Omitting it clears an existing tag |
| `in_global_ns` | bool | no | `false` | Write to the shared namespace |

**Output**

None.

**Example**

```yaml
- task_name: save-task
  activity:
    type: builtin.state.set_state
    input:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
      value:
        task_id: "{{ task_id }}"
        payload: "{{ payload }}"
        submitted_at: "{{ now }}"
      topic: "pending"
```

---

## `builtin.state.get_state`

Reads one value.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace |
| `key` | str | yes | — | Key to read |
| `in_global_ns` | bool | no | `false` | Read from the shared namespace |

**Output**

The stored value, or `null` when the key does not exist. Reading a missing key is not an error.

**Example**

```yaml
- task_name: load-task
  activity:
    type: builtin.state.get_state
    input:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
  output:
    as: task

- task_name: require-task
  raise:
    if: '{{ task is None }}'
    type: error
    error_type: TaskNotFound
    message: 'No such task: {{ task_id }}'
```

---

## `builtin.state.get_state_with_ts`

Reads a value together with the time it was last written. Use it to decide whether a cached entry
is still fresh.

**Input**

Same as [`get_state`](#builtinstateget_state): `namespace`, `key`, `in_global_ns`.

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `value` | any | The stored value, or `null` when the key does not exist |
| `last_update_time` | str \| null | ISO-8601 timestamp of the last write, or `null` |

**Example**

```yaml
- task_name: read-cache
  activity:
    type: builtin.state.get_state_with_ts
    input:
      namespace: "fx-rates"
      key: "{{ pair }}"
  output:
    as: cached

- task_name: check-freshness
  set:
    - is_stale: >-
        {{ cached['value'] is None
           or (datetime.now(timezone.utc)
               - datetime.fromisoformat(cached['last_update_time'])).total_seconds() > 3600 }}
```

---

## `builtin.state.del_state`

Deletes one entry. Deleting a key that does not exist is not an error.

**Input**

Same as [`get_state`](#builtinstateget_state): `namespace`, `key`, `in_global_ns`.

**Output**

None.

**Example**

```yaml
- task_name: forget-task
  activity:
    type: builtin.state.del_state
    input:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
```

---

## `builtin.state.list_states`

Lists the keys in a namespace, with filtering, ordering and pagination. It returns **keys and
topics only, not values** — fetch the ones you need with `get_state`.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace to list |
| `in_global_ns` | bool | no | `false` | List the shared namespace |
| `key_pattern` | str | no | `null` | Keep keys matching this pattern; `*` is the wildcard |
| `topic_pattern` | str | no | `null` | Keep rows whose topic matches; untagged rows never match |
| `limit` | int | no | `null` | Maximum rows to return |
| `offset` | int | no | `null` | Rows to skip, for paging |
| `order_by` | enum | no | `"key"` | `key`, `last_update_time` or `topic` |
| `order_direction` | enum | no | `"asc"` | `asc` or `desc` |

**Output**

A list of `{key, topic}` objects.

**Example**

The ten most recently touched pending tasks:

```yaml
- task_name: list-pending
  activity:
    type: builtin.state.list_states
    input:
      in_global_ns: true
      namespace: "tasks"
      topic_pattern: "pending"
      order_by: last_update_time
      order_direction: desc
      limit: 10
  output:
    as: pending      # -> [{key, topic}, ...]
```

---

## `builtin.state.list_namespaces`

Lists the namespaces that hold data.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name_pattern` | str | no | `null` | Keep namespaces matching this pattern; `*` is the wildcard |
| `limit` | int | no | `null` | Maximum namespaces to return |
| `in_global_ns` | bool | no | `false` | List shared namespaces instead of the caller's own |

**Output**

A list of namespace names. Secret namespaces are never included.

**Example**

```yaml
- task_name: list-namespaces
  activity:
    type: builtin.state.list_namespaces
    input:
      name_pattern: "task*"
      in_global_ns: true
  output:
    as: namespaces   # -> ["tasks", "task-archive", ...]
```

---

## `builtin.state.update_topic`

Retags an existing entry without touching its value or its last-update time. Pass `topic: null` to
clear the tag.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace |
| `key` | str | yes | — | Key to retag |
| `topic` | str | no | `null` | New tag; `null` clears it |
| `in_global_ns` | bool | no | `false` | Operate on the shared namespace |

**Output**

None.

**Example**

Moving a task through its lifecycle:

```yaml
- task_name: update-task-topic
  skip_if: '{{ not has_task }}'
  activity:
    type: builtin.state.update_topic
    input:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
      topic: "dispatched"
```

:::caution A missing key is a silent no-op
`update_topic` on a key that does not exist does nothing and reports no error — it will not create
the entry. Check with `get_state` first if that distinction matters.
:::

---

## `builtin.state.delete_by_topic`

Deletes every entry in a namespace whose topic matches a pattern, and returns how many it removed.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace to clear within |
| `topic_pattern` | str | yes | — | Topic pattern; `*` is the wildcard |
| `in_global_ns` | bool | no | `false` | Operate on the shared namespace |

**Output**

An integer: the number of rows deleted.

**Example**

```yaml
- task_name: purge-completed
  activity:
    type: builtin.state.delete_by_topic
    input:
      in_global_ns: true
      namespace: "tasks"
      topic_pattern: "completed-*"
  output:
    as: purged_count   # -> e.g. 42
```

:::caution This deletes many rows at once
`topic_pattern` is required — there is no accidental "delete everything" — but a broad pattern
still clears the whole namespace. Run [`list_states`](#builtinstatelist_states) with the same
pattern first to see what will go. Note also that rows with no topic are never matched, so this
cannot be used to empty a namespace completely — use
[`delete_namespace`](#builtinstatedelete_namespace) for that.
:::

## `builtin.state.delete_namespace`

Deletes every entry in a namespace, and returns how many it removed.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace to empty |
| `in_global_ns` | bool | no | `false` | Operate on the shared namespace |

**Output**

An integer: the number of rows deleted. A namespace that holds nothing returns `0` rather than
failing.

**Example**

```yaml
- task_name: drop-scratch-space
  activity:
    type: builtin.state.delete_namespace
    input:
      namespace: "scratch"
  output:
    as: deleted_count   # -> e.g. 17
```

:::caution This deletes the entire namespace
Unlike [`delete_by_topic`](#builtinstatedelete_by_topic), this **does** remove untagged rows, so
it is the only way to empty a namespace completely. Run
[`list_states`](#builtinstatelist_states) first to see what will go.

With `in_global_ns: true` the namespace must not contain `:`. A global namespace is by definition
one without a colon, so the restriction costs nothing — it stops a global delete resolving into
another user's scope.

The namespace itself is not a record. It exists exactly as long as a key carries its name, so
deleting the keys is what makes the namespace disappear.
:::
