---
sidebar_position: 4
---

# Expression Syntax

Expressions compute values at runtime. They are sandboxed Python expressions inside `{{ }}`, and
they can appear in almost any value of a wfspec: `context`, `set`, `output`, an activity's `input`,
a condition.

```yaml
- set:
    - greeting: 'Hello, {{ name }}!'                     # string interpolation
    - total: '{{ price * quantity }}'                    # a number
    - is_valid: '{{ price > 0 and quantity > 0 }}'       # a bool
    - squares: '{{ [x ** 2 for x in range(5)] }}'        # a list
```

## Typed values and interpolated strings

How a value is evaluated depends on its shape:

| Value | Result |
|---|---|
| No `{{` at all: `pending` | The value itself |
| Exactly one `{{ e }}` (surrounding whitespace allowed): `'{{ [1, 2] }}'` | The **typed** value of `e`: here the list `[1, 2]` |
| Text mixed with `{{ }}`: `'n={{ [1, 2] }}'` | A **string**: each `{{ e }}` is replaced by `str(e)`, giving `'n=[1, 2]'` |
| A mapping or list | Each value or element evaluated by the same rules. Keys are not evaluated |
| Any other scalar: `42`, `true` | The value itself |

So `count: '{{ len(items) }}'` stores an integer, while `label: '{{ len(items) }} items'` stores a
string. Quote expression values in YAML: an unquoted value starting with `{` is read as a mapping.

An expression may span several lines; newlines inside `{{ }}` are treated as spaces:

```yaml
- set:
    - stats: |
        {{
          {
            "headcount": len(people),
            "avg_salary": round(sum(p["salary"] for p in people) / len(people), 1)
          }
        }}
```

## Name resolution

A bare name in an expression is looked up in this order:

1. the reserved names below (`_`, `__context__`, `__sys_info__`, ...);
2. the current task's locals (`_name`);
3. container scopes (`name@`), innermost first;
4. the workflow context (`context`, `input`, and everything written without a marker).

A name that is not found is a `NameError`. To test whether a variable exists, ask `__context__`:

```yaml
- set:
    - tier: '{{ tier if "tier" in __context__ else "standard" }}'
```

See [Workflowspec Structure](./workflowspec.md#data-flow) for where each kind of variable lives.

### Reserved names

| Name | Value |
|---|---|
| `_` | The current task's raw result, inside its `output` (and the error, inside `on_error.do`) |
| `__context__` | A read-only mapping of every visible variable, merged innermost-first |
| `__sys_info__` | Information about the run (table below) |
| `__user_info__` | Who started the run |
| `event` | The current event, inside `wait_for.event.match_expression` and state machine callbacks and conditions |

A loop also binds its `foreach` variable (default `item`) and, if given, its `index` variable. None
of the reserved names can be assigned.

`_` depends on the task kind: an activity's output, a child workflow's output, the list of a loop's
iteration results, and so on. The full table is in
[Workflowspec Structure](./workflowspec.md#a-tasks-result-_-and-output).

```yaml
- task_name: fetch-user
  activity:
    type: http.request
    input:
      method: GET
      url: 'https://api.example.com/users/{{ user_id }}'
      output_json: true
  output:
    data: '{{ _["json"] }}'          # the parsed response body
    as: user
```

**`__sys_info__`** is a mapping; read it with `["key"]` or `.get("key")`:

| Field | Description |
|-------|-------------|
| `trace_id` | Root trace identifier, shared by the parent and every child workflow |
| `workflow_id` | This workflow instance's ID |
| `tier` | Execution tier (`dev`, `beta`, `prod`): useful for pointing at a staging endpoint outside production |
| `wfspec_name`, `wfspec_version` | The running workflow's `header.workflow_name` and its package version |
| `wfspec_callstack` | The chain of workflows that led here |
| `is_continue_as_new` | `True` when this execution was restarted by a [checkpoint](../reference/statements.md). Always a bool, so it is safe to use directly as a condition |
| `state_machine` | Info about the enclosing state machine; present only while one is running |
| `debug_mode`, `enable_otel_trace` | Whether debug events and OTel tracing are on for this run |

**`__user_info__`** holds `user_id`, `user_org`, `requester_user_id` and `auth_mode`.

```yaml
- set:
    - user_id: '{{ __user_info__.get("user_id") }}'
    - workflow_id: '{{ __sys_info__["workflow_id"] }}'
```

## Variable modifiers

The name you write to (in `context`, `set`, `output.set`, `output.as`, and the `input` maps of
`activity`, `workflow` and `rules_engine`) can carry markers that change where the value is stored
and how it is evaluated:

```
[_]name[@][#modifier...][#]
```

| Marker | Meaning |
|---|---|
| `_name` | Task-local: visible to the rest of this task's `set` / `output`, then discarded |
| `name@` | Container scope: the nearest enclosing `tasks` container or loop iteration |
| `name#python` | Evaluate as a Python expression (the default) |
| `name#literal` | Do not evaluate: keep the text, braces included |
| `name#jinja` | Render as a sandboxed Jinja2 template |
| `name#python_glom` | Evaluate as a glom spec over `__context__` |
| `name#` (trailing) | Log the stored value as a debug event, streamed to the CLI |

The markers are stripped before the value is stored: `total#` stores `total`. A name cannot both
start with `_` and end with `@`, and an unknown modifier is rejected by validation. Scope markers
only have an effect in `set`, `output.set` and `output.as`.

### `#literal`

Keep `{{ }}` as text, for a template meant to be rendered later or by another system:

```yaml
- set:
    - template#literal: 'Hello {{ user_name }}!'
```

### `#jinja`

Render with Jinja2, which has statements (`if`, `for`) and filters that a single Python expression
cannot express. Every visible variable is in the template's context. Enabled by default; an
operator can turn it off by setting `MOCO_ENABLE_JINJA=false` on the server and workers:

```yaml
- set:
    - message#jinja: |
        Dear {{ customer.name }},
        Your order #{{ order.id }} has been {{ order.status }}.
        {% if order.status == 'shipped' %}
        Tracking: {{ order.tracking_number }}
        {% endif %}
```

### `#python_glom`

The value is a Python expression for a [glom](https://glom.readthedocs.io) spec, applied to
`__context__`. A path must therefore be a **quoted string**. Disabled by default: the server and
workers need `MOCO_ENABLE_GLOM=true`, which also makes the `glom` module available inside `{{ }}`:

```yaml
- set:
    - first_dept#python_glom: '"people.0.dept"'          # people[0]["dept"]
    - names#python_glom: '("users", ["name"])'           # [u["name"] for u in users]
```

### Multi-stage evaluation

Modifiers are applied left to right, each to the previous result, so `#python#python` evaluates
twice. Use it when a variable holds an expression:

```yaml
- set:
    - template#literal: '{{ total }}'
    - total: 42
    - resolved#python#python: '{{ template }}'   # pass 1: '{{ total }}'   pass 2: 42
```

### Debug logging with a trailing `#`

A trailing `#` emits the stored value as a debug event, which `moco run` prints as the workflow
runs. It is the main debugging tool, and it combines with the other markers:

```yaml
- set:
    - users#: '{{ load_users }}'                         # log the value
    - greeting@#: 'Hello {{ user["name"] }}'             # container scope, logged
    - greeting_html@#jinja#: '<h1>{{ user.name }}</h1>'  # scope, Jinja2, logged
```

### Assigning into a structure

In `set` and `output.set`, a key that is itself an expression assigns into an existing variable.
Only literal subscripts are allowed:

```yaml
- set:
    - '{{ order["status"] }}': shipped
    - '{{ totals["eu"]["count"] }}': '{{ totals["eu"]["count"] + 1 }}'
```

## Conditions

`skip_if`, `raise.if`, the `if` / `elif` of `branches`, `wait_for.event.match_expression` and
state machine and rule conditions all take a **condition**: an expression that evaluates to a
`bool`, or a tree of `and`, `or` and `not`:

```yaml
- task_name: domestic-adult-member
  skip_if:
    not:
      and:
        - '{{ age >= 18 }}'
        - '{{ country == "US" }}'
        - '{{ is_member }}'
  set:
    - tier: domestic-premium

- task_name: eligible
  skip_if:
    or:
      - '{{ is_banned }}'
      - '{{ age < 13 }}'
  set:
    - eligible: true
```

`and` and `or` take a non-empty list and short-circuit; the forms nest freely.

**A condition must evaluate to exactly `True` or `False`.** Any other value, such as a list, a
string or `None`, fails the task with a `ConditionTypeError` rather than being treated as truthy.
Say what you mean:

| Instead of | Write |
|---|---|
| `'{{ items }}'` | `'{{ len(items) > 0 }}'` |
| `'{{ user_id }}'` | `'{{ user_id is not None }}'` or `'{{ bool(user_id) }}'` |
| `'{{ result.get("error") }}'` | `'{{ "error" in result }}'` |

## Available in expressions

### Python builtins

The safe builtins are available: `abs`, `all`, `any`, `bool`, `dict`, `enumerate`, `filter`,
`float`, `int`, `isinstance`, `len`, `list`, `map`, `max`, `min`, `range`, `reversed`, `round`,
`set`, `sorted`, `str`, `sum`, `tuple`, `zip`, and the like. `eval`, `exec`, `open`, `compile`,
`globals`, `type`, `getattr` / `setattr` and the other introspection builtins are removed;
`__import__` and dunder attributes are rejected outright.

### Helpers

| Name | Description |
|---|---|
| `now()` | The current time as a `datetime`. Replay-safe: on the Temporal runtime it is the workflow's deterministic clock |
| `uuid4()` | A random UUID, also replay-safe |
| `copy`, `deepcopy` | From the `copy` module |
| `remap` | `boltons.iterutils.remap`, for transforming nested data |
| `StringIO` | An in-memory text buffer, for example for `pd.read_csv` |

### Libraries

Pre-imported modules:

| Name | Module |
|---|---|
| `np` | NumPy |
| `pd` | pandas |
| `pa` | PyArrow |
| `glom` | glom: call `glom.glom(...)` |
| `json`, `re`, `base64` | the standard modules |
| `yaml` | PyYAML: only `safe_load`, `safe_dump` and `dump` |
| `dt` | the `datetime` module |
| `rd` | `dateutil.relativedelta` |
| `bs4` | BeautifulSoup: `bs4.BeautifulSoup(...)` |

Each is exposed through a read-only proxy, so **submodules are not reachable**: `pd.io`, `pd.api`,
`np.random`, `np.ctypeslib`, `glom.core` and `pa.fs` all raise. Functions that read or write the
filesystem are either restricted to in-memory buffers (`pd.read_csv(StringIO(...))` is fine,
`pd.read_csv('/path')` is not) or removed (`pd.read_pickle`, `np.load`).

```yaml
- set:
    - mean: '{{ float(np.mean([1, 2, 3, 4, 5])) }}'
    - due: '{{ (now() + dt.timedelta(days=30)).date().isoformat() }}'
    - next_month: '{{ now() + rd.relativedelta(months=1) }}'
    - payload: '{{ json.dumps({"id": order_id}) }}'
    - value: '{{ glom.glom(data, "path.to.nested.value") }}'
```

## Common patterns

```yaml
- set:
    # Conditional values
    - discount: '{{ price * 0.1 if is_premium else 0 }}'
    - tier: '{{ "gold" if points > 1000 else "silver" if points > 500 else "bronze" }}'

    # Lists
    - positive: '{{ [x for x in numbers if x > 0] }}'
    - names: '{{ [u["name"] for u in users] }}'

    # Dictionaries
    - squared: '{{ {k: v ** 2 for k, v in data.items()} }}'
    - merged: '{{ {**defaults, **overrides} }}'

    # Strings
    - slug: '{{ title.strip().lower().replace(" ", "-") }}'
    - formatted: '{{ f"Total: ${total:.2f}" }}'
```

## Best practices

**Keep expressions short; build values step by step.** A `set` is ordered and each entry sees the
earlier ones. Hold intermediates in task-locals so they never reach the context:

```yaml
- task_name: price
  set:
    - _available: '{{ [i for i in items if i.get("available", True) and i["price"] > 0] }}'
    - _subtotals: '{{ [i["price"] * i["qty"] * (1 - i.get("discount", 0)) for i in _available] }}'
    - total: '{{ sum(_subtotals) }}'
```

**Debug with a trailing `#`** instead of adding tasks to print values.

**Keep side effects in activities.** Expressions are re-evaluated when a durable workflow replays;
anything that touches the outside world belongs in an [activity](./activities.md), whose result is
recorded once. Mutating your own variables (`log.append(...)`) is fine.

**Validate inputs with `raise`:**

```yaml
- task_name: check-email
  raise:
    if: '{{ not email or "@" not in email }}'
    type: error
    error_type: ValidationError
    message: 'Invalid email: {{ email }}'
```

## Next steps

- [Activities](./activities.md) — calling the outside world
- [Workflowspec Reference](../reference/workflowspec-reference.md) — the full DSL reference
- [Writing Workflows](../guides/writing-workflows.md) — practical patterns
