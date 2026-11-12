---
sidebar_label: Kubernetes
---

# Kubernetes Activities

Eight activities for orchestrating a Kubernetes cluster: `k8s.apply`, `k8s.get`, `k8s.list`,
`k8s.delete`, `k8s.scale`, `k8s.logs`, `k8s.wait` and `k8s.exec`.

They speak to the cluster's REST API directly — no `kubectl` binary and no kubeconfig on the
worker. Every activity names its cluster inline, so one workflow can target several clusters, and
resources are resolved through API discovery, which means **custom resources work exactly like
built-in ones**.

## Setup

Every activity takes a `connection` object. Build it once in `context:` and reuse it, rather than
repeating it in every task.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `api_server` | str | yes | — | API server base URL. Must be `https://` |
| `token_secret_key` | str | one-of | — | Secret holding a bearer token |
| `client_cert_secret_key` | str | one-of | — | Secret holding a client certificate (PEM) |
| `client_key_secret_key` | str | one-of | — | Secret holding the client private key (PEM) |
| `ca_cert` | str | no | `null` | CA bundle as inline PEM |
| `ca_cert_secret_key` | str | no | `null` | Secret holding the CA bundle. Exclusive with `ca_cert` |
| `insecure_skip_tls_verify` | bool | no | `false` | Skip certificate verification |
| `namespace` | str | no | `"default"` | Namespace used when an activity does not name one |

Exactly one authentication method is required: a bearer token, **or** both of the client
certificate and key. An unauthenticated connection is not expressible.

```yaml
context:
  k8s:
    api_server: "https://my-cluster.example.com:6443"
    token_secret_key: "K8S_PROD_TOKEN"
    ca_cert_secret_key: "K8S_PROD_CA"
    namespace: "payments"
```

Store the credentials once with [`builtin.secret.upload`](./secret.md).

:::note `ca_cert` is the one field that may be inline
Tokens and client keys have no inline form — they must be named through a `*_secret_key`. A CA
certificate is public material, so forcing it through the secret store buys nothing, and
`ca_cert` accepts PEM directly. See [Secrets](./secret.md).
:::

:::caution Client certificates and CA bundles are written to the worker's filesystem
The Kubernetes client accepts TLS material only as file paths, so a connection using
`ca_cert`/`ca_cert_secret_key` or client-certificate auth writes those PEMs into a private
(`0700`) temporary directory for the lifetime of the connection, removed when the worker shuts
down. **A bearer token never touches disk** — it lives only in memory. Deployments that cannot
accept certificates on disk should use token auth against a publicly-trusted endpoint.
:::

Connections are cached per worker and keyed on the *resolved* credentials, so rotating a secret
transparently produces a new connection rather than pinning a revoked token.

---

## Safety

`k8s.apply`, `k8s.delete` and `k8s.exec` can destroy a production cluster. Two independent
mechanisms guard them.

**1. Authorization policy.** Every activity asserts a privilege on the
`internal.k8s_activities` resource, with a per-verb action so a deployment can grant broad
read-only access and narrow write access:

| Action | Activities |
| --- | --- |
| `read` | `k8s.get`, `k8s.list`, `k8s.logs`, `k8s.wait` |
| `write` | `k8s.apply`, `k8s.scale` |
| `delete` | `k8s.delete` |
| `exec` | `k8s.exec` |

The evidence offered to the policy includes `api_server_host`, `namespace`, `kind`,
`k8s_action`, `cluster_scoped` and `insecure_skip_tls_verify` — so a policy can say things like
"production workflows may only reach the production cluster" or "only these two wfspecs may
exec". The policy itself is supplied by your deployment through the `internal.authz_policies`
workflow, not by a file in this repository. See [Authz Activities](./authz.md).

:::danger If no policy is deployed, the check passes
Like every `internal.*` privilege in Moco, an unresolvable policy is logged and **allowed**. Do
not treat "k8s activities are authorization-gated" as protection until you have actually
deployed a policy for `internal.k8s_activities`.
:::

**2. Hard guards, always on.** These need no configuration and cannot be turned off except by an
explicit per-call flag:

- `k8s.delete` refuses a **cluster-scoped** resource (Namespace, PersistentVolume, CRD,
  ClusterRole, …) unless `allow_cluster_scoped: true`. Scope comes from API discovery, so it is
  correct for custom resources too.
- `k8s.delete` refuses a **label-selector delete** unless `allow_bulk_delete: true`, and rejects
  an empty selector outright — `label_selector: ""` must never mean "everything".
- `k8s.apply` and `k8s.delete` refuse **`kube-system`, `kube-public` and `kube-node-lease`**
  unless `allow_system_namespaces: true`.
- `k8s.apply` rejects a document with no `kind`, no `apiVersion`, or no
  `metadata.name`/`generateName`, naming the offending document by index.
- `k8s.exec` takes a command **list**; there is no implicit shell.

---

## `k8s.apply`

Applies one or more manifests using **server-side apply**, so the API server arbitrates field
ownership and a conflict with another controller (an HPA owning `replicas`, Argo owning the spec)
is a loud error rather than a silent overwrite.

A string manifest may contain several `---`-separated documents. They are applied **in the order
given** — that is how you express Namespace-before-workload or CRD-before-custom-resource. There
is no dependency sorting.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `manifest` | str \| object \| list | yes | — | YAML text, one document, or a list of documents |
| `namespace` | str | no | connection's | Namespace for documents that do not name one |
| `field_manager` | str | no | `"moco"` | Server-side-apply field manager |
| `force_conflicts` | bool | no | `false` | Take ownership of fields another manager owns |
| `dry_run` | bool | no | `false` | Validate and admit without persisting |
| `continue_on_error` | bool | no | `false` | Apply every document, recording per-document errors |
| `allow_system_namespaces` | bool | no | `false` | Permit `kube-system` and friends |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `resources` | list | One entry per document, in input order |
| `resources[].api_version` | str | apiVersion of the document |
| `resources[].kind` | str | Kind of the document |
| `resources[].name` | str \| null | Name as returned by the API server |
| `resources[].namespace` | str \| null | Namespace; null when cluster-scoped |
| `resources[].uid` | str \| null | `metadata.uid` |
| `resources[].resource_version` | str \| null | `metadata.resourceVersion` after the apply |
| `resources[].error` | str \| null | Failure message; only set when `continue_on_error` is true |
| `applied_count` | int | Number of documents applied without error |

By default the first failing document stops the apply and raises, naming the document's index and
listing what had already been applied — because a half-mutated cluster is something the workflow
needs to know about precisely.

```yaml
- task_name: create-job
  activity:
    type: k8s.apply
    input:
      connection: "{{ k8s }}"
      field_manager: "moco-migrate"
      manifest:
        apiVersion: batch/v1
        kind: Job
        metadata:
          name: "{{ job_name }}"
        spec:
          backoffLimit: 0
          template:
            spec:
              restartPolicy: Never
              containers:
                - name: migrate
                  image: "busybox:1.36"
                  command: ["/bin/sh", "-c", "echo migrating; sleep 5"]
  output:
    as: created
```

:::caution `k8s.apply` runs once — it is not retried
Its default policy is `max_attempts: 1`. Server-side apply is itself idempotent, but a multi-
document bundle that fails at document 5 would re-apply documents 1–4 on a retry. If your bundle
is a single document, or purely declarative, raise `max_attempts` per call in `options.retry_policy`.
:::

---

## `k8s.get`

Fetches a single resource.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `api_version` | str | no | `"v1"` | e.g. `"apps/v1"` |
| `kind` | str | yes | — | e.g. `"Deployment"` |
| `name` | str | yes | — | Resource name |
| `namespace` | str | no | connection's | Ignored for cluster-scoped kinds |
| `not_found_ok` | bool | no | `false` | Return `found: false` instead of failing |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `found` | bool | Whether the resource exists |
| `resource` | object \| null | The full resource |
| `api_version`, `kind`, `name` | str | Echoed back from the request |
| `namespace` | str \| null | Namespace requested; null when cluster-scoped |

Use `not_found_ok: true` when the question is "does this exist?" rather than "fetch this".

---

## `k8s.list`

Lists resources of a kind.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `api_version` | str | no | `"v1"` | e.g. `"apps/v1"` |
| `kind` | str | yes | — | Kind to list |
| `namespace` | str | no | connection's | — |
| `all_namespaces` | bool | no | `false` | List cluster-wide instead |
| `label_selector` | str | no | `null` | e.g. `"app=api,tier!=canary"` |
| `field_selector` | str | no | `null` | e.g. `"status.phase=Running"` |
| `limit` | int | no | `500` | Page size, capped at 2000 |
| `continue_token` | str | no | `null` | From a previous call's output |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `items` | list | Matched resources |
| `item_count` | int | Items in this page |
| `continue_token` | str \| null | Pass back to fetch the next page; null when complete |
| `resource_version` | str \| null | `resourceVersion` of the list |

:::note Every item lands in workflow history
A pod list in a busy namespace is megabytes, copied into history and replayed on every workflow
task. Narrow with selectors and keep `limit` small, and project what you need with `output.data` (`_` is
the raw result) rather than storing the whole list.
:::

---

## `k8s.delete`

Deletes a resource by name, or a set of them by label selector.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `api_version` | str | no | `"v1"` | e.g. `"apps/v1"` |
| `kind` | str | yes | — | Kind to delete |
| `name` | str | one-of | — | Exclusive with `label_selector` |
| `label_selector` | str | one-of | — | Requires `allow_bulk_delete` |
| `namespace` | str | no | connection's | — |
| `allow_bulk_delete` | bool | no | `false` | Required for a selector delete |
| `allow_cluster_scoped` | bool | no | `false` | Required for a cluster-scoped kind |
| `allow_system_namespaces` | bool | no | `false` | Permit `kube-system` and friends |
| `grace_period_seconds` | int | no | `null` | `0` forces immediate deletion |
| `propagation_policy` | str | no | `"Background"` | `Foreground`, `Background` or `Orphan` |
| `not_found_ok` | bool | no | `true` | Treat an absent resource as success |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `deleted` | bool | Whether anything was deleted |
| `deleted_count` | int | Number of resources deleted |
| `names` | list[str] | Names of the deleted resources |
| `not_found` | bool | True when the target was already absent |

`not_found_ok` defaults to **true** here (unlike `k8s.get`) — deleting something already gone is
what makes a cleanup task safe to re-run. Default policy is `max_attempts: 1`.

---

## `k8s.scale`

Sets the replica count on a `Deployment`, `StatefulSet` or `ReplicaSet` through the scale
subresource, and reports what the count was before.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `kind` | str | no | `"Deployment"` | `Deployment`, `StatefulSet` or `ReplicaSet` |
| `name` | str | yes | — | Workload name |
| `namespace` | str | no | connection's | — |
| `replicas` | int | yes | — | Desired count, `>= 0` |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `kind`, `name`, `namespace` | str | Echoed back |
| `previous_replicas` | int \| null | Count before the change — lets you report the delta or detect a no-op |
| `replicas` | int | Count now requested |

Scaling only *requests* the change. Follow it with `k8s.wait` to block until the pods are actually
ready.

---

## `k8s.logs`

Reads a bounded tail of a pod's log.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `pod_name` | str | one-of | — | Exclusive with `label_selector` |
| `label_selector` | str | one-of | — | Read every matching pod |
| `max_pods` | int | no | `5` | Cap when using a selector |
| `namespace` | str | no | connection's | — |
| `container` | str | no | `null` | Defaults to the pod's default container |
| `tail_lines` | int | no | `200` | Lines from the end of the log |
| `since_seconds` | int | no | `null` | Only lines newer than this |
| `previous` | bool | no | `false` | Read the previous terminated container's log |
| `timestamps` | bool | no | `false` | Prefix each line with an RFC3339 timestamp |
| `max_bytes` | int | no | `1048576` | Per-pod cap; the tail is kept when truncating |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `pods` | list | One entry per pod read |
| `pods[].pod_name` | str | Pod the log came from |
| `pods[].container` | str \| null | Container, when one was named |
| `pods[].log` | str | The log text |
| `pods[].truncated` | bool | Whether it was cut to fit `max_bytes` |
| `pods[].byte_count` | int | Size of the returned text |
| `pod_count` | int | Number of pods read |

`label_selector` is how you reach a Job's pod, whose name the cluster generates:

```yaml
- task_name: collect-logs
  activity:
    type: k8s.logs
    input:
      connection: "{{ k8s }}"
      label_selector: "job-name={{ job_name }}"
      tail_lines: 200
  output:
    as: job_logs
```

:::note There is no follow/streaming mode
Pod logs are a high-throughput data feed, and Moco's event relay is built for low-rate control
streams. Wait for the resource with `k8s.wait`, then read the tail. For progress *during* a long
run, poll `k8s.logs`.
:::

---

## `k8s.wait`

Polls a resource until a condition holds. This is the activity that turns "I asked for a rollout"
into "the rollout is live".

Exactly one of three condition forms is required:

1. **`condition`** — a `status.conditions[].type` such as `Available`, `Ready`, `Complete` or any
   custom-resource condition, matched against `condition_status` (default `"True"`).
2. **`jsonpath` + `value`** — a dotted path such as `status.readyReplicas`, compared as a string.
   List indices are supported: `spec.containers.0.image`.
3. **`deleted: true`** — satisfied when the resource is gone.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `api_version` | str | no | `"v1"` | e.g. `"apps/v1"` |
| `kind` | str | yes | — | Kind to wait on |
| `name` | str | yes | — | Resource name |
| `namespace` | str | no | connection's | — |
| `condition` | str | one-of | — | Condition type to wait for |
| `condition_status` | str | no | `"True"` | Status that condition must reach |
| `jsonpath` | str | one-of | — | Dotted path, compared against `value` |
| `value` | str | with `jsonpath` | — | Expected value |
| `deleted` | bool | one-of | `false` | Wait for the resource to disappear |
| `fail_on_conditions` | list[str] | no | `null` | Condition types that mean it can never succeed |
| `poll_interval_sec` | float | no | `2.0` | Initial gap; backs off to a 15s ceiling |
| `raise_on_timeout` | bool | no | `true` | Set false to get `met: false` back and branch |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `met` | bool | Whether the condition was satisfied |
| `elapsed_sec` | float | Wall-clock seconds spent waiting |
| `poll_count` | int | Number of polls performed |
| `observed` | str \| null | Last observed condition status or path value |
| `resource` | object \| null | The resource as last seen |

`fail_on_conditions` is what stops a failed Job from consuming the whole budget:

```yaml
- task_name: await-job
  activity:
    type: k8s.wait
    input:
      connection: "{{ k8s }}"
      api_version: batch/v1
      kind: Job
      name: "{{ job_name }}"
      condition: Complete
      fail_on_conditions: ["Failed"]
      raise_on_timeout: false
    options:
      retry_policy:
        timeout_sec: 900
  output:
    as: awaited
```

:::note This activity blocks, and heartbeats while it does
Its default budget is 600s with Temporal heartbeats configured, so a worker crash mid-wait is
rescheduled rather than silently lost. If the workflow has other work to do meanwhile, put it in
a parallel `tasks` container or set `options.async_mode: true` on the call.

A condition that is never met raises a **non-retryable** error, so a genuine failure is not
multiplied by `max_attempts`.
:::

---

## `k8s.exec`

Runs a command inside a pod's container and captures its output and exit status.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection` | object | yes | — | Cluster connection |
| `pod_name` | str | yes | — | Pod to run in |
| `namespace` | str | no | connection's | — |
| `container` | str | no | `null` | Defaults to the pod's default container |
| `command` | list[str] | yes | — | Command and arguments. **Not** a string |
| `stdin` | str | no | `null` | Text piped to the command's standard input |
| `timeout_sec` | int | no | `60` | Budget for the remote command |
| `max_output_bytes` | int | no | `1048576` | Cap on each of stdout and stderr |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `stdout` | str | Captured standard output |
| `stderr` | str | Captured standard error |
| `exit_code` | int | Exit status; `0` means success |
| `truncated` | bool | Whether either stream was cut |

```yaml
- task_name: check-migration-state
  activity:
    type: k8s.exec
    input:
      connection: "{{ k8s }}"
      pod_name: "{{ pod }}"
      command: ["/bin/sh", "-c", "psql -tAc 'select count(*) from schema_migrations'"]
  output:
    as: migration_check
```

:::danger `k8s.exec` is arbitrary remote code execution
It is the cluster equivalent of [`shell.run`](./shell.md), and should be governed by the `exec`
action on `internal.k8s_activities`. Unlike `shell.run` it defaults to `max_attempts: 1`, because
an arbitrary command is not idempotent.

`command` is a list and is never passed through a shell. To use one, say so explicitly:
`["/bin/sh", "-c", "..."]`.
:::

---

## Why there is no `k8s.job_run`

Running a batch Job is the most common reason a workflow talks to a cluster, so a single
create-wait-logs-cleanup activity is a natural thing to want. It is not offered, because the four
phases have four different retry postures and one activity manifest carries only one retry
policy. Fused together, an API server blip while fetching logs would fail the activity even
though the Job had already succeeded — and the workflow could not tell the difference.

Composed in a wfspec, each task retries on its own terms, you can see which phase failed, and
"clean up on success but keep the evidence on failure" is a single `skip_if`:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: k8s-job-run

input:
  k8s: {}                # a connection object, as in Setup
  job_name: db-migrate
  image: "busybox:1.36"
  cleanup: true

output:
  succeeded: "{{ awaited['met'] }}"
  logs: "{{ job_logs }}"

main:
  tasks:
    - task_name: create-job
      activity:
        type: k8s.apply
        input:
          connection: "{{ k8s }}"
          manifest:
            apiVersion: batch/v1
            kind: Job
            metadata:
              name: "{{ job_name }}"
            spec:
              backoffLimit: 0
              template:
                spec:
                  restartPolicy: Never
                  containers:
                    - name: main
                      image: "{{ image }}"
                      command: ["/bin/sh", "-c", "echo migrating; sleep 5"]

    - task_name: await-job
      activity:
        type: k8s.wait
        input:
          connection: "{{ k8s }}"
          api_version: batch/v1
          kind: Job
          name: "{{ job_name }}"
          condition: Complete
          fail_on_conditions: ["Failed"]
          raise_on_timeout: false
        options:
          retry_policy:
            timeout_sec: 900
      output:
        as: awaited

    - task_name: collect-logs
      activity:
        type: k8s.logs
        input:
          connection: "{{ k8s }}"
          label_selector: "job-name={{ job_name }}"
          tail_lines: 200
      output:
        data: "{{ [p['log'] for p in _['pods']] }}"
        as: job_logs

    - task_name: cleanup-job
      skip_if: "{{ not (cleanup and awaited['met']) }}"
      activity:
        type: k8s.delete
        input:
          connection: "{{ k8s }}"
          api_version: batch/v1
          kind: Job
          name: "{{ job_name }}"
```
