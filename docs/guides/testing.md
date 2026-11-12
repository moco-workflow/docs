---
sidebar_label: Testing Workflows
sidebar_position: 4
---

# Testing Workflows

Moco tests are YAML, like the workflows they test. You write a `*.test.yaml` suite next to your
wfspec, run it with `moco test`, and the platform executes the workflow for each case and checks the
result. There is no Python and no test framework to install — if you can write a wfspec, you can
write its tests.

```bash
moco test                                   # everything under ./tests/
moco test tests/hello-moco.test.yaml        # one file
moco test 'tests/**/*.test.yaml'            # a glob
```

A Moco project keeps tests where `moco.json` says they are:

```
hello-moco/
├── moco.json          # "tests": ["tests/**/*.yaml"]
├── src/
│   └── hello-moco.yaml
└── tests/
    └── hello-moco.test.yaml
```

---

## Two kinds of suite

Every suite declares a `test_type`.

| Type | Runs | Use it to |
|------|------|-----------|
| `integration-test` | The whole workflow, start to finish | Check end-to-end behaviour and real outputs |
| `unit-test` | One named task, in isolation | Check a single task's logic without running everything around it |

Start with integration tests. Reach for a unit test when a task has interesting logic of its own and
setting up a full run to reach it would be more trouble than the test is worth.

The examples below test this workflow, saved as `src/price-order.yaml`:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: price-order

context:
  total: 0
  band: none

input:
  quantity: 1
  unit_price: 0
  discount_pct: 0

output:
  total: '{{ total }}'
  band: '{{ band }}'

main:
  tasks:
    - task_name: check-input
      raise:
        if: '{{ unit_price < 0 }}'
        type: error
        error_type: ValidationError
        message: Price must be non-negative

    - task_name: nothing-to-do
      raise:
        if: '{{ quantity == 0 }}'
        type: terminate
        message: empty order

    - task_name: compute-total
      set:
        - _subtotal: '{{ quantity * unit_price }}'
        - total: '{{ round(_subtotal * (1 - discount_pct / 100), 2) }}'

    - task_name: classify
      switch:
        value: '{{ total >= 100 }}'
        cases:
          - match: true
            do:
              set:
                - band: large
        default:
          set:
            - band: small
```

---

## Integration tests

```yaml
test_type: integration-test

wfspec:
  name: price-order

test_cases:
  # 2 x 60 = 120 -> large
  - id: large-order-is-banded-large
    input:
      quantity: 2
      unit_price: 60
    expect:
      output:
        - total: 120
        - band: large

  # 4 x 25 = 100, minus 10% = 90 -> small
  - id: discount-drops-order-below-threshold
    input:
      quantity: 4
      unit_price: 25
      discount_pct: 10
    expect:
      output:
        - band: small
      assert:
        - "{{ total == 90 }}"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `test_type` | yes | `integration-test` |
| `wfspec.name` | yes | The `workflow_name` of the workflow under test |
| `wfspec.version` | no | Pin a version; omit to use whatever resolves |
| `wfspec.content` | no | Inline the workflow YAML instead of loading or resolving it by name |
| `test_cases` | yes | The cases to run |
| `test_data` | no | Shared data available to the suite |
| `skip` | no | Skip the whole suite |
| `verbose` | no | Verbose output for the whole suite |

`moco test` looks for the workflow on disk first — `<name>.yaml` next to the test file, in `../src/`,
or in `..` — and sends it with the suite, together with the other workflow files in that directory
so child workflows resolve. If no file is found, the name is resolved as a published workflow.

Each case needs an `id`, an `input`, and an `expect`:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique, descriptive name. This is what the runner and the test explorer show |
| `input` | yes | Input for the run. `{}` if the workflow takes none |
| `expect` | yes | What should be true afterwards |
| `mocks` | no | Replace named tasks with canned output |
| `skip` | no | Skip this case |
| `verbose` | no | Print the expanded test workflow and full output for this case |

Name cases for the behaviour they pin down. `boundary-total-at-threshold` tells you what broke;
`test-4` does not.

---

## Expectations

`expect` supports four kinds of check, and a case may combine them. All of them must pass.

Expectations read the **workflow result** — what the workflow's `output` evaluates to. Make `output`
a mapping: its keys are the names the checks below refer to. A workflow whose `output` is a single
value, or that has no `output`, gives `output` and `assert` nothing to check.

### `output` — named values

```yaml
expect:
  output:
    - total: 120
    - band: large
```

Each entry names a key of the workflow result and the value it should have. The value is compared
with `==`, so a nested value is matched as a whole:

```yaml
expect:
  output:
    - summary: {name: python/cpython, stars: 70000}
```

Only the keys you list are checked, so a case can pin one value and ignore the rest.

### `assert` — expressions

```yaml
expect:
  assert:
    - "{{ total == 90 }}"
    - "{{ band in ('small', 'large') }}"
    - "{{ summary['stars'] > 1000 }}"
```

Each assertion is an ordinary Moco expression and must come out `True`. The keys of the workflow
result are bound as variables, so refer to them by name and index into nested values as usual. Use
these when a value is computed, approximate, or only interesting in relation to another — anything
`output` cannot express as a literal.

### `error` — expected failure

```yaml
expect:
  error:
    error_type: ValidationError
    error_message: Price must be non-negative
```

The run must fail, with this error type and message. The message must match exactly. Set either
field to `null` to accept any value:

```yaml
expect:
  error:
    error_type: ValidationError
    error_message: null      # any message
```

A `raise` task with `type: error` produces these: its `error_type` (default `WorkflowError`) and
its `message`. Testing the failure paths is the half people skip. A workflow that validates its
input deserves a case proving it actually rejects bad input.

### `terminate` — expected early exit

```yaml
expect:
  terminate:
    terminate_message: empty order
```

The workflow must stop early through a `raise` task with `type: terminate`, whose `message` becomes
the `terminate_message`. `terminate_message: null` accepts any message. This is distinct from
`error`: terminating is a deliberate, successful outcome, failing is not.

The workflow's `output` is still evaluated after a terminate, so every variable it reads must exist
by then. That is why `price-order` gives `total` and `band` initial values in `context`; without
them the terminate case would fail with a `NameError` instead.

---

## Mocking

Real activities make tests slow, flaky, and dependent on credentials. `mocks` replaces a **named
task** with canned output, so the workflow runs its real logic against data you control. Given the
`hello-moco` workflow from the [Quick Start](../quick-start.md):

```yaml
test_type: integration-test

wfspec:
  name: hello-moco

test_cases:
  - id: summarizes-the-repository
    input:
      owner: python
      repo: cpython
    mocks:
      - step_name: fetch-repo
        _:
          status_code: 200
          is_success: true
          json:
            full_name: python/cpython
            stargazers_count: 70000
            description: The Python programming language
    expect:
      output:
        - name: python/cpython
        - stars: 70000
      assert:
        - "{{ description.startswith('The Python') }}"

  - id: missing-repo-gives-empty-summary
    input: {}
    mocks:
      - step_name: fetch-repo
        _:
          status_code: 404
          is_success: false
          json: {message: Not Found}
    expect:
      output:
        - name: null
        - stars: 0
```

| Field | Required | Meaning |
|-------|----------|---------|
| `step_name` | yes | The `task_name` of the `activity` or `workflow` task to intercept |
| `_` | yes | The raw output the task should return instead of running — the `_` its `output` sees |
| `wfspec_name` | no | The `workflow_name` of a child workflow, to mock a task inside that child rather than this one |

The mocked task does not run, but everything around it does: its `output` still processes `_`, so
the test above also proves that `output.data` and `output.as` pick the right fields.

**Mocking requires named tasks.** A task with no `task_name` cannot be mocked, which is the
practical reason to name every activity in a workflow you intend to test:

```yaml
- task_name: create-job          # <- this is the mock handle
  activity:
    type: k8s.apply
    input:
      connection: '{{ cluster }}'
      manifest: '{{ job_manifest }}'
```

Mock at the edges — the activities that talk to the outside world — and let everything between them
run for real. A suite that mocks every task tests nothing but the mocks. A suite that mocks only
`http.request` and `sql.query` still proves your conditions, expressions, and control flow work.

Mocking error paths works the same way: give the task output that represents failure and assert the
workflow handles it.

---

## Unit tests

A unit test runs **one named task** with variables you supply, and checks what it produced:

```yaml
test_type: unit-test

wfspec:
  name: price-order

test_groups:
  - step_name: compute-total
    test_cases:
      - id: discount-applied
        input: {quantity: 4, unit_price: 25, discount_pct: 10}
        expect:
          output:
            - total: 90.0

  - step_name: check-input
    test_cases:
      - id: negative-price-is-rejected
        input: {unit_price: -5}
        expect:
          error:
            error_type: ValidationError
            error_message: null
```

`test_groups` replaces `test_cases` at the top level: one group per task, each with its own cases.
`step_name` must match the `task_name` of exactly one task in the workflow. Groups take `skip` and
`verbose` too, so you can park a whole group while a task is in flux.

For each case the runner builds a small workflow from the document: a `set` of the case's `input`,
followed by the named task. The document's `context` and `input` defaults still apply. What the
expectations see is the resulting **workflow context**, so:

- `expect.output` and `assert` refer to the variables the task wrote — `total` above;
- task-local `_names` and `name@` container-scoped variables are gone by then, so test them through
  a context variable they feed;
- a task's `output.as` target is a context variable, and can be checked like any other.

Mocks work in unit tests too. A mock without `step_name` applies to the task under test:

```yaml
test_type: unit-test

wfspec:
  name: hello-moco

test_groups:
  - step_name: fetch-repo
    test_cases:
      - id: keeps-only-the-json-body
        input: {owner: python, repo: cpython}
        mocks:
          - _:
              status_code: 200
              json: {full_name: python/cpython}
        expect:
          output:
            - repo_info: {full_name: python/cpython}
```

This is the right tool for a task that encodes real business rules — a precedence order, a
rounding convention, a set of defaults. Pinning those values in a unit test turns "someone changed a
default" into a failing test rather than a surprise in production.

---

## Running tests

```bash
moco test                                  # all tests under ./tests/
moco test tests/hello-moco.test.yaml       # a single file
moco test 'tests/**/*.test.yaml'           # a glob
```

| Option | Effect |
|--------|--------|
| `--in-memory` | Run on the in-memory runtime — fastest, no Temporal needed |
| `--verbose` | Per-test progress and server log messages |
| `-t, --timeout <sec>` | MCP request timeout (default 300) |
| `--debug` | HTTP-level debug logging |
| `--auth <mode>` | Force `oauth` or `apikey` |

`--in-memory` is the normal choice while developing: a fully mocked suite has no need for durable
execution, and skipping Temporal makes the loop noticeably tighter. Run at least once without it
before publishing, so the suite is exercised the way the workflow will actually run.

### Debugging a failing case

Set `verbose: true` on the one case that fails rather than on the suite — it prints the expanded
test workflow and the full output context, which is usually enough to see which variable is not what
you assumed:

```yaml
- id: the-one-that-fails
  verbose: true
  input: { ... }
  expect: { ... }
```

The `#` debug modifier works in tests exactly as it does in a normal run — append it to a variable
in the workflow to have its value streamed as the test executes:

```yaml
- task_name: compute-total
  set:
    - _subtotal#: '{{ quantity * unit_price }}'
    - total#: '{{ round(_subtotal * (1 - discount_pct / 100), 2) }}'
```

Use `skip: true` to park a case you are not ready to fix. A skipped case stays visible; a deleted
one is forgotten.

---

## Practical advice

**One behaviour per case.** When a case with eight assertions fails you still have to work out
which. Several small cases with meaningful IDs tell you directly.

**Cover the boundaries.** Most workflow bugs live at thresholds. If a rule fires at `>= 100`, write
the case at exactly `100` and the one just below it — `boundary-total-exactly-at-threshold` and
`boundary-total-below-threshold` are more valuable than five cases in the comfortable middle.

**Comment the arithmetic.** Where an expected value is derived, show the derivation:

```yaml
# 4 x 25 = 100, minus 10% = 90 -> small
- id: discount-drops-order-below-threshold
```

The next person to change a threshold needs to know why the number was 90.

**Test what a change would break.** A suite's job is to fail when behaviour changes unintentionally.
Assertions on values that can never change are noise; assertions on defaults, thresholds, and output
shape are the ones that earn their place.

**Publish tests with the package.** The `tests` glob in `moco.json` ships your suites alongside the
sources, so whoever inherits the workflow inherits its specification of correct behaviour.

---

## Next steps

- [Using the Moco CLI](./use-moco-cli.md) — `moco test` among the other commands
- [Writing Workflows](./writing-workflows.md) — authoring patterns
- [Expressions](../concepts/expressions.md) — the language used in `assert`
- The `moco-examples` projects — every one ships a `tests/` directory worth reading
