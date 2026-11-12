---
sidebar_label: Authorization
---

# Authorization Activities

Four activities let a workflow read and evaluate the platform's authorization policies, and act as
another user.

Most workflows never call these: the platform already enforces policy around the activities that
need it — `http.request`, `shell.run`, `claude_agent.query` and the deployment activities all check
their own. Reach for these when a workflow has to make an authorization decision **itself**: gate a
branch on whether the caller may do something, or carry out an action on another user's behalf.

## Setup

No credentials. Identity comes from the calling context — the user the workflow is running as.

## How a policy is shaped

A **resource policy** names a resource and lists, for each action on it, the grants that allow it.
A grant is a pattern matched against *evidence* about the caller and the run.

```
resource:  {resource_id: "sys.workflow", namespace: "system"}
items:
  - privilege: {privilege_id, resource_id, action: "execute", description}
    grants:
      - content: ["user_email:jon@example.com", "group:user:moco_admins"]
        relation: OR
```

Grant patterns come in two families:

| User-based | Context-based |
| --- | --- |
| `user_email:jon@example.com` | `oauth_client_id:myapp` |
| `user_org_name:mocoland technology` | `web_origin:https://example.com` |
| `group:user:moco_admins` | `target_web_origin:https://*.prod.example.com` |
| `*` | `wfspec_name:internal.example_workflow`, `parent_wfspec_name:ai.*` |
| | `wfspec_tag:category:ai`, `tier:beta`, `debug_mode:true` |
| | `env:DEVCONTAINER:true`, `group:http-allow-list.prod`, `*` |

`relation` is `AND` (default) or `OR` across the patterns in one grant.

:::caution Authorization fails open when no policy is deployed
If a resource has no policy, the check **allows** access and logs a warning. A deployment that
wants `http.request`, `shell.run` or `claude_agent.query` restricted must actually deploy the
policy — not deploying one is not a deny.
:::

## Defaults

All four: 60 s timeout, 3 attempts.

:::note `NotAuthorizedError` is not retryable
A denial raised by `raise_on_deny` (or by any platform-side check) is a non-retryable error. Raising
`max_attempts` will not help.
:::

---

## `authz.list_resources`

Lists the resources that have policies, optionally filtered.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | no | `null` | Only resources in this namespace |
| `resource_id_pattern` | str | no | `null` | Only resource ids matching this pattern; `*` is the wildcard |

**Output**

A list of resources, each `{resource_id, namespace, description}`.

**Example**

```yaml
- task_name: list-system-resources
  activity:
    type: authz.list_resources
    input:
      namespace: "system"
      resource_id_pattern: "sys.*"
  output:
    as: resources   # -> [{resource_id, namespace, description}, ...]
```

---

## `authz.get_resource_policy`

Fetches the full policy for one resource — the input `authz.check_privilege` expects.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `resource_id` | str | yes | — | Resource to fetch the policy for |

**Output**

A [ResourcePolicy](#how-a-policy-is-shaped): `{resource, items, groups}`, or `null` when the
resource has no policy.

**Example**

```yaml
- task_name: load-policy
  activity:
    type: authz.get_resource_policy
    input:
      resource_id: "sys.workflow"
  output:
    as: resource_policy
```

---

## `authz.check_privilege`

Evaluates whether the caller is granted an action on a resource, and returns a boolean — or raises,
with `raise_on_deny: true`.

Evidence about the caller and the run is filled in automatically — `user_id`,
`requester_user_id`, `is_impersonated`, `tier`, `debug_mode`, `wfspec_name` and
`caller_wfspec_name` — on top of anything you add in `extra_evidence`.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `resource_policy` | object | yes | — | The policy to evaluate, typically from [`authz.get_resource_policy`](#authzget_resource_policy) |
| `check_action` | str | yes | — | The action to check, e.g. `execute` |
| `extra_evidence` | dict | no | `null` | Additional evidence merged into the automatic set |
| `raise_on_deny` | bool | no | `false` | Raise `NotAuthorizedError` instead of returning `false` |

**Output**

A boolean: `true` when the action is granted.

**Example**

Gate the rest of the workflow on the check:

```yaml
- task_name: load-policy
  activity:
    type: authz.get_resource_policy
    input:
      resource_id: "sys.workflow"
  output:
    as: resource_policy

- task_name: check-execute
  activity:
    type: authz.check_privilege
    input:
      resource_policy: "{{ resource_policy }}"
      check_action: execute
      raise_on_deny: true
```

A denial fails the task with `NotAuthorizedError`. To recover rather than fail the run, add
`on_error: {catch: true, do: ...}` to the task; inside `do`, `_` is the error
(`{error_type, error_message, error_detail}`).

Branching instead of failing:

```yaml
- task_name: may-publish
  activity:
    type: authz.check_privilege
    input:
      resource_policy: "{{ resource_policy }}"
      check_action: publish
      extra_evidence:
        target_env: "{{ target_env }}"
  output:
    as: can_publish

- task_name: publish
  skip_if: "{{ not can_publish }}"
  activity:
    type: http.request
    input:
      method: POST
      url: "{{ publish_url }}"
```

---

## `authz.impersonate_user`

Returns a user identity for another user. Use it for a workflow acting on someone's behalf — a
scheduled job that must see what a particular user sees.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `run_as_user_id` | str | yes | — | The user to act as |

**Output**

A user identity:

| Field | Type | Description |
| --- | --- | --- |
| `user_id` | str | The impersonated user |
| `requester_user_id` | str | The caller who asked for the impersonation |
| `auth_mode` | str | Inherited from the caller's own credential type |

**Example**

```yaml
- task_name: act-as-owner
  activity:
    type: authz.impersonate_user
    input:
      run_as_user_id: "{{ dataset_owner_id }}"
  output:
    as: run_as
```

:::caution Impersonating anyone but yourself is privileged
It requires the `sys.workflow / impersonate_user` privilege. The impersonated identity **inherits
the caller's `auth_mode`**, so the credential class of the original request still applies.
:::
