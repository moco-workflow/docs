---
sidebar_label: Releasing and Sharing
sidebar_position: 9
---

# Releasing and Sharing Workflows

A workflow on your laptop is a file. A workflow on Moco is something colleagues can run by name,
that you can version and roll forward, and that you control access to — without anyone deploying
software.

Getting there is three distinct steps, and the difference between them is worth learning up front
because people routinely conflate the middle two:

| Step | What it does | Who does it |
|------|--------------|-------------|
| **Publish** | Stores a versioned package in a namespace | You, via `moco publish` or the console |
| **Deploy** | Makes one version resolvable by name in a stage | You, via the console |
| **Target** | Decides which users that deployment serves | You, via the console |

Publishing alone does not make `moco run my-workflow` work. Deploying does.

---

## Namespaces

A **namespace** is where wfspecs live, and the unit that access is granted over. Logging in selects
your home namespace as your working namespace:

```bash
moco session show                    # user, working namespace, roles, privileges
moco session select <namespace-id>   # switch
```

Your working namespace is the default target for `moco publish` and for secret management. Publish
elsewhere with `moco publish --namespace <id>`, assuming you have the privilege.

---

## Packages and versions

The unit you publish is a **package**: one or more wfspec files versioned together as a single
semantic version. A `moco.json` in your project root describes it:

```json
{
  "wfspec_package_name": "hello-moco",
  "wfspec_package_version": "1.0.0",
  "wfspec_description": "Summarize a GitHub repository",
  "sources": ["src/**/*.yaml"],
  "tests": ["tests/**/*.yaml"]
}
```

The package needs an **entry point** — one source file whose `header.workflow_name` equals
`wfspec_package_name`. Everything else in `sources` is a child workflow the entry point may
reference by name (`workflow: {ref: <workflow_name>}`). Tests ship alongside, so whoever inherits
the workflow inherits its tests.

```yaml
# src/hello-moco.yaml — the entry point
header:
  schema_version: 2.0.0
  workflow_name: hello-moco      # == wfspec_package_name

input:
  repo: moco-workflow/moco

output: "{{ summary }}"

main:
  task_name: summarize
  workflow:
    ref: summarize-repo          # src/summarize-repo.yaml, same package
    input:
      repo: "{{ repo }}"
  output:
    as: summary
```

**A workflow's version is its package's version.** A wfspec carries no version of its own: every
workflow in the package is published as `wfspec_package_version`.

```bash
moco publish --dry-run     # validate and show what would be published
moco publish
```

Versions are `major.minor.patch`. Bump the version for every change you publish rather than
overwriting one — the version is how callers and deployments refer to a specific artifact, so
changing what a version means undermines both.

- **patch** — a fix with no interface change
- **minor** — new optional inputs, new outputs; existing callers unaffected
- **major** — a changed or removed input, or a changed output shape

The distinction matters because of how callers resolve you. A caller that writes
`ref: payments/payment-charge` with no version takes the highest version available to it; one that
pins `ref: payments/1.*/payment-charge` stays on major `1`, and `payments/1.0.0/payment-charge`
stays on exactly that version. A patch should be safe for everyone. A breaking change needs a major
bump so the people who pinned are not moved. See
[Composing Workflows](./child-workflows.md#ref--a-published-workflow) for the `ref` forms.

---

## Stages

A **stage** is a named environment a package version can be deployed into. Moco ships three: `dev`,
`beta`, and `prod`. The `tier` a workflow runs under selects the stage its names resolve through.

```bash
moco run hello-moco --tier dev
moco run hello-moco --tier prod
```

Deploying a package version to a stage is what makes the name resolvable there.

### How a name resolves

When someone runs `hello-moco` at a given tier, Moco looks for package versions that are

1. deployed to that stage,
2. on an active deployment, and
3. **targeted at that user**,

and takes the **highest version** among them. A version pin narrows the search rather than
bypassing it — and the pin may be a wildcard, so pinning `1.*` picks the highest `1.x.y` available
to you.

Two consequences are worth internalising:

**Several versions can live in a stage at once.** They coexist, and the highest one that the caller
is targeted at wins. This is not a mistake to avoid — it is the mechanism behind staged rollout.

**Rollout is a targeting decision.** Deploy `2.0.0` to `prod` targeted only at a pilot group and
leave `1.4.0` targeted at everyone: the pilot resolves to `2.0.0` because it is the highest version
*they* can see, and everyone else continues on `1.4.0`. Widening the rollout means adding targets,
not redeploying. Rolling back means deactivating the `2.0.0` deployment — the next-highest version
takes over immediately.

The promotion loop, then, is: publish `1.1.0`, deploy to `dev`, verify with `moco run --tier dev`,
then deploy the *same package* to `prod`. Nothing is rebuilt between stages, so what you tested is
what runs.

Deployment is done from the web console, on the wfspec's page. Every deploy, undeploy, and targeting
change is recorded in an audit log with who did it and when.

---

## Sharing with people

A deployment on its own serves you. To let others run it, add **targets**.

A target is a user or a group, attached to a deployment. Once your colleague is a target of your
`prod` deployment, they can run:

```bash
moco run hello-moco
```

— from their own CLI, their own agent, or the API. They need no copy of your YAML, no namespace
access, and no deployment of their own. They cannot read your spec; they can invoke it.

**Groups** are the scalable form. A group contains users *or other groups*, nested to any depth, so
targeting `analytics-team` keeps working as people join and leave. Membership is resolved
transitively, so a user in a subgroup of a targeted group is covered.

Targeting `*` serves all users — reasonable for something genuinely universal, worth a pause
otherwise.

**Share to all** goes one step further: it is a flag on the wfspec, not on a deployment, so every
user resolves to the highest version deployed to the stage without any targets at all. A version
still has to be actively deployed to the stage to be visible. Set it in `moco.json`
(`"share_to_all": true`, re-applied on every publish) or on the wfspec's page in the console.

Because targeting is per-deployment and resolution picks the highest version *visible to the
caller*, targets are also your rollout control: see [How a name resolves](#how-a-name-resolves).

---

## Access control

Two different questions, answered in two different places:

**"Who can run this workflow?"** — deployment targets, above.

**"Who can edit and deploy in this namespace?"** — namespace privileges. Roles are defined per
namespace, grant actions on resources, and have users or groups as members. `moco session show`
prints the roles and privileges you hold in your working namespace, which is the quickest way to
find out why an operation was refused.

Workflows can also make authorization decisions themselves. The `authz.*` activities let a workflow
check whether its caller may do something and branch accordingly — see the
[authz activity reference](../reference/activities/authz.md).

---

## Secrets belong to you, not the package

Secrets are **not** part of a published package, and this is deliberate. A wfspec references a
secret by key:

```yaml
- task_name: summarize
  activity:
    type: openai.chat.completions
    input:
      apikey_secret_key: OPENAI_API_KEY
      model_name: gpt-4o-mini
      messages:
        - role: user
          content: "Summarize: {{ text }}"
```

The key is resolved at execution time, in the caller's own secret scope. So a colleague running your
shared workflow uses *their* `OPENAI_API_KEY`, and your credentials never leave your namespace.

```bash
moco secret upload OPENAI_API_KEY sk-...
moco secret list
```

Use `--global` for a secret shared across the deployment. When you share a workflow, document which
secret keys it expects — that is the part your users have to supply.

See [Secret Activities](../reference/activities/secret.md).

---

## A release checklist

1. `moco validate src/*.yaml` — schema-clean
2. `moco test` — suites pass, ideally both in-memory and on Temporal
3. Bump `wfspec_package_version` according to what changed
4. `moco publish --dry-run`, then `moco publish`
5. Deploy to `dev` in the console; verify with `moco run <name> --tier dev`
6. Deploy the same package to `prod`
7. Add or confirm targets for the people who need it

---

## Next steps

- [Using the Moco CLI](../guides/use-moco-cli.md) — `publish`, `session`, `secret`
- [Composing Workflows](./child-workflows.md) — calling a workflow someone else published
- [How Workflows Run](./how-to-run-workflow.md) — how `tier` selects a deployment
- [Testing Workflows](../guides/testing.md) — what to run before you publish
