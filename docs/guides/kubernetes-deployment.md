---
sidebar_position: 5
title: Deploying on Kubernetes
---

# Deploying on Kubernetes

Moco ships a Helm chart at `moco-deploy/helm/moco` that installs the whole platform — API server,
Temporal workers, the static UI tier, and optionally the Postgres, RabbitMQ and Temporal
services they depend on.

The chart is designed to run on a laptop cluster first and scale up from there: the defaults
bundle every dependency, and a cloud install turns those off and points at managed
equivalents instead. There is one chart and one set of templates for both.

For the full operator reference — every value, the migration mechanism, key rotation — see
[`moco-deploy/helm/moco/README.md`](https://github.com/moco-workflow/moco/blob/main/moco-deploy/helm/moco/README.md)
in the repository.

## Prerequisites

- A Kubernetes cluster (1.28+) and `kubectl`
- Helm 3.8 or newer
- An ingress controller. The chart defaults to `ingressClassName: nginx`.

## Local install (minikube)

```bash
minikube start --cpus=4 --memory=8192 --disk-size=60g
minikube addons enable ingress

# Build the images into minikube's own docker daemon.
eval $(minikube docker-env)
make build-docker

# Generate the crypto keys moco needs for its secret store.
python scripts/gen_crypto_secret.py --out ./secrets

helm install moco ./moco-deploy/helm/moco \
  -f moco-deploy/helm/moco/values-minikube.yaml \
  --set crypto.encryptKeyName="$(cat secrets/key_name.txt)" \
  --set-file crypto.keys."$(cat secrets/key_name.txt)"=./secrets/fernet.b64 \
  --set-file crypto.keys."$(cat secrets/rsa_key_name.txt)"=./secrets/rsa_priv.pem \
  --set-file crypto.keys."$(cat secrets/rsa_pub_key_name.txt)"=./secrets/rsa_pub.pem \
  --wait --timeout 10m

echo "$(minikube ip) moco.local" | sudo tee -a /etc/hosts
helm test moco
```

Moco is then at `http://moco.local` — UI at `/ui`, docs at `/docs`, API at `/api`.

:::tip Use `--set-file` for key material
`--set` splits values on commas and drops newlines, which silently corrupts an RSA PEM. The
damage does not show up until the first decrypt, deep inside an activity.
:::

## What gets deployed

| Component | Purpose |
| --- | --- |
| `moco-server` | FastAPI REST API and MCP endpoint |
| `moco-worker` | Temporal worker on the `default` task queue |
| `moco-agent-worker` | Activity-only worker for `claude_agent.*` (off by default) |
| `moco-nginx` | Serves the UI/docs/apps bundles and proxies the API |
| `moco-db-migrate` | Job that bootstraps and migrates the schema |

`moco-server` and `moco-worker` run the same image, differing only in
`MOCO_SERVER_ENABLED` / `MOCO_WORKER_COUNT`.

Traffic flows `Ingress → moco-nginx → (static files | moco-server)`.

## Using managed services

Each dependency has an `enabled` flag and a matching `external*` block:

```yaml
postgres:
  enabled: false
externalDatabase:
  host: 10.0.0.3
  database: mocodb
  user: moco
  existingSecret: moco-db          # Secret holding the password
  sslMode: require
  adminUser: postgres              # needs CREATE ROLE / CREATE DATABASE for migrations
  adminExistingSecret: moco-db-admin

temporal:
  devServer:
    enabled: false
externalTemporal:
  endpoint: temporal-frontend.temporal.svc.cluster.local:7233
  namespace: moco
```

`values-gke.yaml` and `values-eks.yaml` are annotated starting points for Google Cloud and
AWS, covering the registry, managed Postgres, ingress, TLS, workload identity and node pools.

:::warning The bundled Temporal is a dev server
`temporal.devServer.enabled=true` runs `temporal server start-dev`, which keeps all workflow
state **in memory**. Restarting that pod loses every running workflow. Use it on a laptop and
nowhere else.
:::

### Managed Postgres needs pgvector

Moco's `llama_index.*` activities store embeddings in Postgres, so the `vector` extension has
to be available **in the moco database** — extensions are per-database, and enabling it
elsewhere does not count. The migration job checks this and fails loudly rather than letting
you discover it when a RAG activity breaks.

- **Cloud SQL**: PostgreSQL 15+; confirm with
  `SELECT * FROM pg_available_extensions WHERE name = 'vector'`.
- **RDS**: PostgreSQL 15.2+ or Aurora PostgreSQL 16.1+; check that `vector` is not excluded
  by `rds.allowed_extensions` in the parameter group.

## Schema migrations

The chart runs a migration Job rather than relying on Postgres' `docker-entrypoint-initdb.d`,
which only fires on an empty data directory and does not exist on a managed instance. The job
bootstraps a fresh database once, then replays `moco-db/upgrade/*.sql` against a
`moco.schema_migration` ledger, and records what it applied.

With an external database the Job is a `pre-install`/`pre-upgrade` hook, so nothing starts
against an un-migrated schema. With the bundled Postgres it is a plain Job named
`<release>-db-migrate-<revision>`, and the moco pods wait in an init container until it has
applied every migration the chart ships. Both work with `helm install --wait`.

Adding a migration is unchanged: drop an idempotent script into `moco-db/upgrade/`, then run
`make helm-sync-db` so the chart's copy is regenerated.

## Upgrading and rolling back

```bash
helm upgrade moco ./moco-deploy/helm/moco -f my-values.yaml
helm history moco
helm rollback moco 3
```

Pin `image.tag` to an immutable tag (a version or a `sha-…` tag) in any environment you care
about. With `latest`, a rollback re-runs whatever `latest` points at now, which is not a
rollback.

## Operational notes

- **Connection budget.** Each moco process opens roughly 30 Postgres connections. `NOTES.txt`
  prints the total for your replica counts on every install and warns if it exceeds the
  bundled server's `max_connections`.
- **Browser automation pins to a process.** The `selenium.*` and `playwright.*` activities
  keep a session in the worker process that opened it. Adding replicas is fine; running those
  workers on spot or preemptible nodes is not.
- **The agent worker must not be autoscaled.** `claude_agent.query` runs for up to 24 hours
  and restarts from scratch if its pod goes away. Give it its own on-demand node pool, and
  confirm it is polling the `agent` queue before shipping a catalog that routes to it.
- **UI configuration is baked in at build time.** The `VITE_*` settings — including the OAuth
  issuer and the `/ui` base path — are compiled into the JavaScript bundle. Changing them
  requires rebuilding the `moco-nginx` image, not a values edit.
