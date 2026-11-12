---
sidebar_label: Deployment & Admin
---

# Deployment Activities

Seventy-five activities make up moco's control plane: namespaces, workflowspecs, packages and their
files, stages, deployments and targeting, users and groups, roles and privileges, API keys and audit
logs.

**Most people never call these directly.** The `moco` CLI and the console drive them through the
platform's system workflows (`sys.*`) — `moco publish`, `moco login` and the rest. Use them when
you are automating the platform itself: a release pipeline that publishes a package and rolls it
out, a provisioning workflow that creates a namespace with its roles, a reporting workflow over the
audit log.

Because they are one CRUD surface over one database, this page documents them **by family** rather
than one long section per activity: a table covering every activity in the family, then one worked
example. The shapes are consistent enough that the tables are the reference and the example shows
the idiom.

## Setup

No per-call credentials. The provider connects using `MOCO_DEPLOY_DB_CONN_STR`.

Authorization is enforced by the system workflows that wrap these activities (for example
`sys.deploy.assert_privilege`), not by the activities themselves — so a workflow calling them
directly is operating at the control plane's own level of trust.

## Conventions across every family

- **`*.set` is an upsert.** It creates the record if absent and updates it if present. This is
  deliberate: it makes a retried activity safe, where a plain create would fail on a duplicate key.
  Consequently `*.set` activities keep the default `max_attempts: 3`.
- **`*.delete` is not retried** (`max_attempts: 1`), and neither is
  [`apikey.create`](#api-keys), which mints new material on every call.
- **`*.add` / `*.remove` for memberships and targets are idempotent**, so they are safe to retry.
- **Output shapes follow the operation**, not the entity:

  | Operation | Returns |
  | --- | --- |
  | `*.get` | The record as an object, or `null` when it does not exist |
  | `*.list` | A list of record objects |
  | `*.set`, `*.activate`, `*.deactivate`, `*.add` | The resulting record |
  | `*.delete` | `{deleted: true}` |
  | `*.remove` | `{removed: true}`, or `{removed: false, already_removed: true}` |

- Timeouts are 60 s everywhere except `deploy_package` and `package.create_with_files`, which get
  120 s.

---

## Namespaces

A namespace is the top-level grouping for workflowspecs, and the unit access control is scoped to.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.namespace.set` | Create or update a namespace (upsert by name) | `namespace_id`, `namespace_name` | `description` |
| `builtin.deploy.namespace.get` | Fetch one namespace | — | `namespace_id` |
| `builtin.deploy.namespace.list` | List every namespace | — | — |
| `builtin.deploy.namespace.get_privileged` | List namespaces where the calling user holds any privilege | — | — |
| `builtin.deploy.namespace.delete` | Delete a namespace | `namespace_id` | — |

**Example**

```yaml
- task_name: create-namespace
  activity:
    type: builtin.deploy.namespace.set
    input:
      namespace_id: "{{ namespace_id }}"
      namespace_name: "{{ namespace_name or namespace_id }}"
      description: "{{ description }}"
  output:
    as: namespace
```

:::note Creating a namespace is more than one activity
The system workflow follows `namespace.set` with `sys.deploy.namespace.authorization` to
initialize the namespace's roles. A provisioning workflow of your own should do the same, or the
namespace exists with nobody able to use it.
:::

---

## Workflowspecs

A wfspec record is the *identity* of a published workflow package — its name (the
`wfspec_package_name` in `moco.json`), namespace and ownership. The YAML itself lives in package
files, versioned separately.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.wfspec.set` | Create or update a wfspec | `wfspec_name` | `namespace_id`, `description`, `owner`, `tags`, `share_to_all` |
| `builtin.deploy.wfspec.get` | Fetch one wfspec | — | `wfspec_name` |
| `builtin.deploy.wfspec.list` | List wfspecs in a namespace | — | `namespace_id` |
| `builtin.deploy.wfspec.delete` | Delete a wfspec | `wfspec_name` | — |

**Example**

```yaml
- task_name: register-wfspec
  activity:
    type: builtin.deploy.wfspec.set
    input:
      wfspec_name: "daily-summary"
      namespace_id: "reporting"
      description: "Daily summary report"
      owner: "{{ owner }}"
      tags: ["reporting", "scheduled"]
  output:
    as: wfspec
```

`share_to_all: true` lets every user resolve the wfspec without being targeted (see
[Deployment queries](#deployment-queries)). Leave it out on an update to keep the current value.

---

## Packages and files

A package is one **semantic version** of a wfspec, holding the YAML files that make it up — what
`moco publish` uploads from a project's `moco.json`. Versions are
`version_major.version_minor.version_patch`.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.package.set` | Create a package version (idempotent by wfspec + version) | `wfspec_name` | `package_id`, `version_major`, `version_minor`, `version_patch`, `manifest`, `created_by` |
| `builtin.deploy.package.create_with_files` | Create a package **and** its files atomically | `wfspec_name`, `files` | `package_id`, version fields, `manifest`, `created_by` |
| `builtin.deploy.package.get` | Fetch a package by id, or by wfspec + version | — | `package_id`, `wfspec_name`, version fields |
| `builtin.deploy.package.list` | List every version of a wfspec | `wfspec_name` | — |
| `builtin.deploy.package.get_files` | A package's files, with their content | `package_id` | — |
| `builtin.deploy.package.list_files` | List a package's files without their content: `filename` and `workflow_name` | `package_id` | — |
| `builtin.deploy.package.delete` | Delete a package | `package_id` | — |
| `builtin.deploy.package.file.set` | Add or update one file (idempotent by package + filename) | `package_id`, `file_order`, `filename`, `content` | `file_id`, `input_schema`, `output_schema` |
| `builtin.deploy.package.file.get` | Fetch one file by name | `package_id`, `filename` | — |
| `builtin.deploy.package.file.delete` | Delete one file | `file_id` | — |

Each file's `content` is a wfspec document (`header` + `main`). The file with `file_order: 0` is
the package's entry point: its `header.workflow_name` must equal the package's `wfspec_name`. The
other files are child workflows the entry point refers to by name. This is the same layout
`moco publish` produces from `moco.json`:

| `moco.json` | Activity input |
| --- | --- |
| `wfspec_package_name` | `wfspec_name` |
| `wfspec_package_version` (`major.minor.patch`) | `version_major`, `version_minor`, `version_patch` |
| `wfspec_description`, `manifest` | `manifest` (`{description, ...}`) |
| files matched by `sources`, entry point first | `files[]` with `file_order` 0, 1, … |

Moco records each file's `workflow_name` when the file is written: its `header.workflow_name`, or
`null` for a file that is not a wfspec. Use `list_files` to see which workflows a package
contains without fetching their YAML:

```yaml
- activity:
    type: builtin.deploy.package.list_files
    input:
      package_id: '{{ package_id }}'
  output:
    as: files   # -> [{id, package_id, file_order, filename, workflow_name, created_at}, ...]
```

**Example** — publish version 1.2.0 of `daily-summary` with its files in one call. The wfspec
being published is held with the `#literal` modifier so that its own `{{ }}` expressions are
stored as written rather than evaluated by the publishing workflow:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: publish-daily-summary

context:
  entry_wfspec#literal: |
    header:
      schema_version: 2.0.0
      workflow_name: daily-summary
    input:
      day: null
    output: '{{ summary }}'
    main:
      task_name: summarize
      workflow:
        ref: fetch-numbers
        input:
          day: '{{ day }}'
      output:
        as: summary
  helper_wfspec#literal: |
    header:
      schema_version: 2.0.0
      workflow_name: fetch-numbers
    input:
      day: null
    output: '{{ numbers }}'
    main:
      set:
        - numbers: {day: '{{ day }}', total: 42}

output: '{{ package }}'

main:
  task_name: publish-version
  activity:
    type: builtin.deploy.package.create_with_files
    input:
      wfspec_name: "daily-summary"
      version_major: 1
      version_minor: 2
      version_patch: 0
      manifest:
        description: "Daily summary report"
      created_by: "{{ __user_info__['user_id'] }}"
      files:
        - filename: "src/daily-summary.yaml"
          file_order: 0                     # the entry point
          content: "{{ entry_wfspec }}"
        - filename: "src/fetch-numbers.yaml"
          file_order: 1
          content: "{{ helper_wfspec }}"
    options:
      retry_policy:
        timeout_sec: 120
  output:
    as: package                             # the package record; its id is package['id']
```

:::note Prefer `create_with_files`
It writes the package and every file in one transaction, so a failure cannot leave a version
half-published. Use `package.set` plus `package.file.set` only when you are adding files to a
package that already exists.
:::

---

## Stages, deployments and targeting

A **deployment** puts one package into one **stage**, and **targets** decide which users or groups
see it — the mechanism behind a staged rollout.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.stage.list` | List the available stages | — | — |
| `builtin.deploy.deployment.set` | Create or update a deployment (upsert by id, or by package + stage) | `package_id`, `stage_id` | `deployment_id`, `is_active`, `deployed_by` |
| `builtin.deploy.deployment.get` | Fetch one deployment | `deployment_id` | — |
| `builtin.deploy.deployment.list` | List deployments | — | `stage_id`, `package_id` |
| `builtin.deploy.deployment.activate` | Make a deployment live | `deployment_id` | — |
| `builtin.deploy.deployment.deactivate` | Take a deployment out of service | `deployment_id` | — |
| `builtin.deploy.target.add` | Target a user or group | `deployment_id` | `target_user_id`, `target_group_id`, `created_by` |
| `builtin.deploy.target.list` | List a deployment's targets | `deployment_id` | — |
| `builtin.deploy.target.remove` | Remove a target | — | `target_id`, `deployment_id`, `target_user_id`, `target_group_id` |
| `builtin.deploy.deploy_package` | Create the deployment **and** add its targets in one call | `package_id`, `stage_id` | `target_user_ids`, `target_group_ids`, `deployed_by` |
| `builtin.deploy.undeploy_package` | Deactivate a deployment | `deployment_id` | `performed_by` |

**Example** — deploy by hand: create an inactive deployment, target a group, then activate it.

```yaml
- task_name: create-deployment
  activity:
    type: builtin.deploy.deployment.set
    input:
      package_id: "{{ package['id'] }}"
      stage_id: "beta"
      is_active: false
      deployed_by: "{{ __user_info__['user_id'] }}"
  output:
    as: deployment

- task_name: target-beta-testers
  activity:
    type: builtin.deploy.target.add
    input:
      deployment_id: "{{ deployment['id'] }}"
      target_group_id: "{{ beta_group_id }}"

- task_name: activate
  activity:
    type: builtin.deploy.deployment.activate
    input:
      deployment_id: "{{ deployment['id'] }}"
```

A staged rollout in one activity:

```yaml
- task_name: roll-out-to-beta
  activity:
    type: builtin.deploy.deploy_package
    input:
      package_id: "{{ package['id'] }}"
      stage_id: "beta"
      target_group_ids: ["{{ beta_group_id }}"]
      deployed_by: "{{ __user_info__['user_id'] }}"
    options:
      retry_policy:
        timeout_sec: 120
  output:
    as: deployment
```

:::note Who sees a deployment
A user sees an active deployment only if it targets them: directly, through a group they belong
to (nested groups count), or through the wildcard target `"*"` (as `target_user_id` or
`target_group_id`), which means every user. **A deployment with no targets is visible to no one**,
so activating before targeting is safe, and removing the last target hides it again.

The exception is a wfspec with `share_to_all: true` (see [Workflowspecs](#workflowspecs)): every
active deployment of it is visible to every user in the stage, targets or not.
:::

---

## Deployment queries

Read-only questions about what is deployed and who can see it. These back the platform's own
version resolution.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.query.get_latest_package` | Latest package version of a wfspec | `namespace_id`, `wfspec_name` | — |
| `builtin.deploy.query.get_wfspec_versions` | Every package version of a wfspec | `wfspec_name` | — |
| `builtin.deploy.query.get_targeted_wfspec_version` | The version a given user resolves to in a stage | `wfspec_name`, `user_id`, `stage_id` | `version_filter`, `exclude_files` |
| `builtin.deploy.query.get_user_deployments` | Active deployments a user can see in a stage | `user_id`, `stage_id` | — |
| `builtin.deploy.query.is_user_targeted` | Whether a deployment targets a user — returns `{is_targeted: bool}` | `user_id`, `deployment_id` | — |
| `builtin.deploy.query.get_group_members` | Group members, resolved recursively — returns `{user_ids: [...]}` | `group_id` | — |

**Example**

```yaml
- task_name: resolve-version
  activity:
    type: builtin.deploy.query.get_targeted_wfspec_version
    input:
      wfspec_name: "daily-summary"
      user_id: "{{ target_user }}"
      stage_id: "prod"
  output:
    as: resolved     # -> the package record, or null
```

A wfspec with `share_to_all: true` (set through `builtin.deploy.wfspec.set`) skips targeting:
every user resolves to its highest active version in the stage that matches `version_filter`, and
`get_user_deployments` lists all its active deployments. The stage still matters — a version that
is not actively deployed to the stage is never returned. `is_user_targeted` ignores the flag.

Set `exclude_files: true` when you only need the version and metadata. The result then has no
`files` key, and the package files are not read at all.

---

## Users

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.user.set` | Create or update a user account (upsert; only non-null fields are written) | `user_id` | `display_name`, `email`, `user_org`, `user_metadata`, `record_login` |
| `builtin.deploy.user.get` | Fetch a user | `user_id` | — |
| `builtin.deploy.user.list` | List users | — | `status`, `limit`, `offset` |
| `builtin.deploy.user.disable` | Disable an account and revoke its API keys (idempotent) | `user_id` | — |
| `builtin.deploy.user.delete` | Delete an account and its API keys | `user_id` | — |

**Example**

```yaml
- task_name: record-login
  activity:
    type: builtin.deploy.user.set
    input:
      user_id: "{{ user_id }}"
      display_name: "{{ display_name }}"
      email: "{{ email }}"
      record_login: true      # stamps timestamps and promotes a provisional account
  output:
    as: user
```

:::caution Disabling blocks API keys, not tokens
`user.disable` revokes the account's API keys, but an already-issued JWT keeps authenticating until
it expires.

`user.delete` refuses system accounts, and does **not** remove the user's group memberships or role
grants — clean those up separately if you are removing someone properly.
:::

---

## Groups

Groups can contain users and other groups; membership resolves recursively.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.group.set` | Create or update a group (upsert by id or name) | `name` | `group_id`, `description` |
| `builtin.deploy.group.get` | Fetch a group by id or name | — | `group_id`, `name` |
| `builtin.deploy.group.list` | List every group | — | — |
| `builtin.deploy.group.list_members` | List a group's **direct** members | `group_id` | — |
| `builtin.deploy.group.member.add` | Add a user or nested group | `group_id` | `member_user_id`, `member_group_id` |
| `builtin.deploy.group.member.remove` | Remove a member | — | `member_id`, `group_id`, `member_user_id`, `member_group_id` |
| `builtin.deploy.group.delete` | Delete a group | `group_id` | — |

**Example**

```yaml
- task_name: create-group
  activity:
    type: builtin.deploy.group.set
    input:
      name: "beta-testers"
      description: "Early access cohort"
  output:
    as: group

- task_name: add-member
  activity:
    type: builtin.deploy.group.member.add
    input:
      group_id: "{{ group['id'] }}"
      member_user_id: "{{ user_id }}"
```

:::note Direct vs recursive membership
`group.list_members` returns direct members only. For the fully expanded user list, use
[`builtin.deploy.query.get_group_members`](#deployment-queries).
:::

---

## Roles and privileges

Access control is role-based: a **resource** plus an **action** makes a **privilege**, privileges
are attached to **roles**, and users or groups are members of roles.

### Resources

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.resource.set` | Create or update a resource (upsert by id, or type + value) | `resource_type`, `resource_value` | `resource_id`, `description` |
| `builtin.deploy.auth.resource.get` | Fetch a resource by id, or type + value | — | `resource_id`, `resource_type`, `resource_value` |
| `builtin.deploy.auth.resource.list` | List resources | — | `resource_type` |
| `builtin.deploy.auth.resource.delete` | Delete a resource | `resource_id` | — |

### Privileges

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.privilege.set` | Create or update a privilege (upsert by id, or resource + action) | `resource_id`, `action` | `privilege_id`, `description` |
| `builtin.deploy.auth.privilege.get` | Fetch a privilege | — | `privilege_id`, `resource_id`, `action` |
| `builtin.deploy.auth.privilege.list` | List privileges | — | `resource_id` |
| `builtin.deploy.auth.privilege.delete` | Delete a privilege | `privilege_id` | — |

### Roles

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.role.set` | Create or update a role (upsert by id) | `namespace_id`, `role_name` | `role_id`, `description` |
| `builtin.deploy.auth.role.get` | Fetch a role | `role_id` | — |
| `builtin.deploy.auth.role.list` | List roles | — | `namespace_id` |
| `builtin.deploy.auth.role.delete` | Delete a role | `role_id` | — |
| `builtin.deploy.auth.role.privilege.add` | Grant a privilege to a role | `role_id`, `privilege_id` | — |
| `builtin.deploy.auth.role.privilege.list` | List a role's privileges | `role_id` | — |
| `builtin.deploy.auth.role.privilege.remove` | Revoke a privilege from a role | `role_id`, `privilege_id` | — |
| `builtin.deploy.auth.role.member.add` | Add a user or group to a role | `role_id` | `user_id`, `group_id` |
| `builtin.deploy.auth.role.member.list` | List a role's members | `role_id` | — |
| `builtin.deploy.auth.role.member.remove` | Remove a member from a role | — | `member_id`, `role_id`, `user_id`, `group_id` |

### Effective access

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.check_user_privilege` | Whether a user holds a privilege, directly or via a group — returns `{has_privilege: bool}` | `user_id`, `privilege_id` | — |
| `builtin.deploy.auth.get_user_privileges` | Every privilege a user holds — returns `{privileges: [...]}` | `user_id` | `namespace_id` |
| `builtin.deploy.auth.get_user_roles` | Every role a user belongs to | `user_id` | `namespace_id` |

**Example** — granting a namespace role to a group:

```yaml
- task_name: define-role
  activity:
    type: builtin.deploy.auth.role.set
    input:
      namespace_id: "reporting"
      role_name: "reporting-operator"
      description: "May run and deploy reporting workflows"
  output:
    as: role

- task_name: grant-privilege
  activity:
    type: builtin.deploy.auth.role.privilege.add
    input:
      role_id: "{{ role['role_id'] }}"
      privilege_id: "{{ deploy_privilege_id }}"

- task_name: add-group-to-role
  activity:
    type: builtin.deploy.auth.role.member.add
    input:
      role_id: "{{ role['role_id'] }}"
      group_id: "reporting-team"
```

Checking effective access:

```yaml
- task_name: may-deploy
  activity:
    type: builtin.deploy.auth.check_user_privilege
    input:
      user_id: "{{ user_id }}"
      privilege_id: "{{ deploy_privilege_id }}"
  output:
    as: check          # -> {has_privilege: bool}

- task_name: require-privilege
  raise:
    if: "{{ not check['has_privilege'] }}"
    type: error
    error_type: NotAuthorizedError
    message: "{{ user_id }} may not deploy to this namespace"
```

This is the *stored* RBAC model. The policy-evaluation activities in
[Authorization](./authz.md) are a different thing: they evaluate a resource policy against evidence
about the caller at run time.

---

## API keys

Every activity here operates on the **calling user's own keys**.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.apikey.create` | Mint a key. Returns the plaintext **once** | `name` | `scopes`, `expires_at` |
| `builtin.deploy.apikey.get` | Fetch one key's metadata. Never the secret | `key_id` | — |
| `builtin.deploy.apikey.list` | List the caller's keys. Never the secrets | — | `include_revoked` |
| `builtin.deploy.apikey.revoke` | Revoke a key (idempotent) | `key_id` | — |
| `builtin.deploy.apikey.delete` | Delete a key permanently | `key_id` | — |
| `builtin.deploy.apikey.lookup` | Look up verification material by the non-secret `key_prefix` | `key_prefix` | `touch` |

`apikey.create` returns `{api_key, key_info}`; every other activity returns metadata only.

**Example** — mint a key and keep only its id in the workflow, so the plaintext never lands in a
variable:

```yaml
- task_name: create-key
  activity:
    type: builtin.deploy.apikey.create
    input:
      name: "{{ key_name }}"
      scopes: "{{ scopes }}"
  output:
    set:
      - key_id: "{{ _['key_info']['key_id'] }}"
    data: null           # the task result would otherwise be the full output, plaintext included

- task_name: revoke-key
  activity:
    type: builtin.deploy.apikey.revoke
    input:
      key_id: "{{ key_id }}"
```

:::danger The plaintext key is returned exactly once
`apikey.create` is the only place the secret ever exists outside the caller. It is not recoverable
afterwards — and it is not retried (`max_attempts: 1`), because a retry would mint a second key and
strand the first. Deliver it to its destination in the same run; do not cache it, and do not write
it to workflow state.
:::

:::caution `apikey.lookup` is sensitive
It returns a key's verification material for a caller that will compare the secret itself. It is
part of the authentication path, not an administrative convenience.
:::

---

## Audit log

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.audit.get_logs` | Query the deployment audit log | — | `package_id`, `stage_id`, `performed_by`, `action`, `limit` |

**Example**

```yaml
- task_name: recent-deploys
  activity:
    type: builtin.deploy.audit.get_logs
    input:
      stage_id: "prod"
      action: "deploy"
      limit: 50
  output:
    as: audit_entries
```
