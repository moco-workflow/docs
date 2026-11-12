---
sidebar_label: Rules Engine
sidebar_position: 6
---

# Rules Engine

Some logic is a series of steps. Some logic is a pile of independent rules — "excellent credit
means a 95% base chance", "debt-to-income over 43% is an automatic reject" — where nobody can say
what order they should run in, and where the business owner adding the fifteenth rule should not
have to understand the other fourteen.

Expressed as a chain of `branches`, that logic becomes a nest of conditionals whose behaviour
depends on their ordering. The `rules_engine` task lets you declare the rules instead and leave the
ordering to the engine.

```yaml
- task_name: loan-classification
  rules_engine:
    input:
      facts:
        credit_score: "{{ credit_score }}"
        annual_income: "{{ annual_income }}"
      run_mode: forward
    rules:
      - id: credit_tier_excellent
        if:
          with_facts: [credit_score]
          expression: "{{ credit_score >= 750 }}"
        then:
          set_facts:
            - credit_tier: excellent
            - base_approval_chance: 0.95
  output:
    as: derived_facts
```

---

## Facts and rules

The engine holds a working memory of **facts** — a flat key/value store, seeded from `input.facts`
and grown as rules fire.

A **rule** is an `if` / `then` pair:

```yaml
- id: high_dti_rejection
  name: "High DTI Rejection"
  description: "Reject if debt-to-income ratio exceeds 43%"
  if:
    with_facts:
      - debt_to_income_ratio
    expression: "{{ debt_to_income_ratio > 0.43 }}"
  then:
    set_facts:
      - auto_reject: true
      - reject_reason: "Debt-to-income ratio exceeds 43%"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique identifier for the rule |
| `name`, `description` | no | Documentation; surfaced in logs |
| `if.with_facts` | yes | The facts this rule depends on |
| `if.expression` | yes | Condition — an expression, or an `and` / `or` / `not` tree |
| `then.set_facts` | no | Facts asserted when the rule fires |
| `then.actions` | no | Tasks run when the rule fires |

### `with_facts` is a declaration, not a convenience

`with_facts` does two jobs, and the second is the important one.

It scopes the condition: **only** the facts listed there are visible to the expression. A listed fact
that has not been derived yet evaluates to `None`; a fact you forgot to list is simply not in scope,
and the condition comes out false. Keeping `with_facts` accurate is therefore not bookkeeping — it
is what makes the rule work.

It also tells the engine what the rule depends on. The engine indexes rules by the facts they read,
so when a fact changes it re-evaluates only the rules that could be affected, and it knows a rule
cannot fire yet because one of its inputs has not been derived. This dependency graph is what makes
rule ordering the engine's problem rather than yours.

Fact names may use dot notation for nested domain data — `applicant.credit_score`. Inside the
expression the dots become underscores, so the condition reads
`{{ applicant_credit_score >= 750 }}`.

### Conditions

An expression that evaluates to `True` fires the rule. For anything beyond a single comparison, use
the logical operators:

```yaml
if:
  with_facts: [credit_score]
  expression:
    and:
      - "{{ credit_score >= 650 }}"
      - "{{ credit_score < 750 }}"
```

`and`, `or`, and `not` nest arbitrarily and short-circuit. They are the same
[condition syntax](../reference/workflowspec-reference.md) used by `skip_if`, `branches` and
`raise.if`.

### Conclusions

`set_facts` asserts facts. Asserted facts are immediately visible to other rules, which is what
allows multi-step reasoning — one rule derives `credit_tier`, another reads it.

A `set_facts` value is asserted **as written, without evaluation** — `"{{ credit_score }}"` would be
stored as that literal string. Set constants and flags there. When a fact has to be computed, give a
task as the value instead: the task runs and its result is asserted.

```yaml
then:
  set_facts:
    - risk_band: high                    # a constant
    - risk_score:                        # a task: its result is the fact
        task_name: score-risk
        activity:
          type: http.request
          input:
            method: GET
            url: "https://api.example.com/risk/{{ applicant_id }}"
            output_json: true
```

`actions` are full tasks, run as a side effect when the rule fires:

```yaml
then:
  set_facts:
    - decision: approved
  actions:
    - task_name: announce-approval
      emit_event:
        topic: loan_events
        event_type: loan_approved
        data:
          applicant_id: "{{ applicant_id }}"
    - task_name: notify
      activity:
        type: http.request
        input:
          method: POST
          url: "https://api.example.com/notifications"
```

Anything you can write in a workflow's `main` can be an action — an activity, a child workflow, an
emitted event. Actions run in the **workflow's** scope, not the facts': they read workflow variables
such as `applicant_id`, not facts. Note the asymmetry: `set_facts` feeds the inference, `actions`
reach outside it. If a rule's output needs to be read by another rule, it belongs in `set_facts`.

---

## Run modes

### Forward chaining — data-driven

`run_mode: forward` (the default) starts from what you know and derives everything it can.

The engine evaluates rules, applies the conclusions of those that fire, and repeats. Each cycle
after the first only re-evaluates rules that depend on facts changed in the previous cycle. It stops
when a cycle fires nothing — a fixed point — or when every fact in `terminate_facts` has been
derived.

Use it when you have input data and want conclusions: classification, scoring, enrichment,
eligibility.

```yaml
input:
  facts:
    credit_score: 720
    annual_income: 85000
  run_mode: forward
  terminate_facts:
    - decision      # stop as soon as this is derived
```

### Backward chaining — goal-driven

`run_mode: backward` starts from a question and works out what it needs to answer it.

Name the goal as a fact with a `null` value. The engine finds rules whose conclusions produce that
fact, recursively resolves whatever those rules' conditions require, and evaluates back up the
chain.

```yaml
input:
  facts:
    decision: null          # the goal
    credit_score: 720       # what is already known
  run_mode: backward
  fact_resolvers:
    employment_verified:
      task_name: verify-employment
      activity:
        type: http.request
        input:
          method: GET
          url: "https://api.example.com/verify-employment/{{ applicant_id }}"
          output_json: true
```

Use it when deriving everything would be wasteful or expensive — when facts come from paid API calls
or slow queries and you only want the ones the answer actually depends on.

### Fact resolvers

`fact_resolvers` maps a fact name to a task that can produce it on demand. When a rule's
condition needs a fact that has not been asserted, the engine runs the resolver and uses the result.

This is what keeps external lookups out of the rules. A rule says `employment_verified == true`; it
does not know or care that answering that costs an HTTP call. Resolvers are most useful in backward
chaining — where they are the mechanism by which a goal pulls in only the data it needs — but they
work in forward mode too.

---

## Output

A `rules_engine` task's result `_` is the **derived facts**: the facts that rules asserted, not
the facts you seeded it with.

```yaml
- task_name: loan-classification
  rules_engine:
    # ...
  output:
    as: derived_facts

- task_name: summarize
  set:
    - tier: "{{ derived_facts.get('credit_tier', 'unknown') }}"
    - rejected: "{{ derived_facts.get('auto_reject', False) }}"
```

Read them with `.get(key, default)` rather than direct indexing. Whether a fact is present depends on
which rules fired, and that is the point — absence is information.

Like other tasks, `rules_engine` accepts `output.data` to reshape the result and `skip_if` to skip
the whole block.

---

## Live mode: continuous evaluation

Everything above runs to completion and returns. Setting `keep_alive: true` turns the engine into a
long-lived reactive session instead: it evaluates what it can, then waits for facts to arrive from
the event bus and re-evaluates as they do.

```yaml
- task_name: incident-triage
  rules_engine:
    input:
      facts:
        service: checkout
      keep_alive: true
      fact_source_topic: telemetry_facts
      terminate_facts:
        - remediation_decision
      timeout_sec: 3600
      max_iterations: 1000
    rules:
      # ...
  output:
    as: triage_result
```

| Field | Purpose |
|-------|---------|
| `keep_alive` | Turns on continuous evaluation |
| `fact_source_topic` | Event bus topic carrying fact updates. Defaults to `default` |
| `terminate_facts` | Session ends once all of these are derived |
| `timeout_sec` | Wall-clock limit. Supports expressions |
| `max_iterations` | Safety limit on evaluation cycles. Defaults to 1000 |

Facts arrive as events with `event_type: "set_facts"` and a dict payload of fact names to values.
Events of any other type are ignored, so the topic can be shared with other consumers:

```yaml
- task_name: push-telemetry
  emit_event:
    topic: telemetry_facts
    event_type: set_facts
    target_workflow_id: "{{ triage_workflow_id }}"
    data:
      error_rate: 0.12
      latency_p99_ms: 2400
```

In a live session a fact that has not arrived yet reads as `None`. A comparison against `None`
raises, and a condition that raises counts as false — so `cpu_pct >= 85` simply waits for
`cpu_pct`, but a rule that only tests presence must say `is not None`. Derived facts are never
retracted, so model escalations rather than toggles.

A session ends when `terminate_facts` are all derived, when `timeout_sec` expires, or when it is
cancelled. **A timeout is not a failure** — the session returns whatever it managed to derive, so a
monitor that reached a partial conclusion still reports it.

This is the declarative counterpart to a [state machine](./state-machines.md). A state machine asks
"what state am I in, and what does this event do to it?" A live rules engine asks "given everything
I now know, what follows?" Reach for the state machine when the lifecycle matters — the same event
means different things in different states. Reach for the live rules engine when it does not, and
facts simply accumulate towards a conclusion: monitoring, alert correlation, streaming eligibility.

---

## Practical notes

**Rules fire in an unspecified order.** Write them so it does not matter. In the loan example the
credit tiers are mutually exclusive conditions rather than an if/else chain, which is what makes
them safe to evaluate in any order.

**Do arithmetic afterwards.** Rules are good at classification — turning numbers into categories and
modifiers. Combining those modifiers into a final score is a `set` task. Splitting the two keeps
each rule readable and keeps the arithmetic in one place:

```yaml
- task_name: loan-classification
  rules_engine:
    # derives credit_tier, base_approval_chance, income_modifier, employment_modifier
  output:
    as: derived_facts

- task_name: decide
  set:
    - _score: >-
        {{ derived_facts.get('base_approval_chance', 0)
           + derived_facts.get('income_modifier', 0)
           + derived_facts.get('employment_modifier', 0) }}
    - decision: "{{ 'approved' if _score >= 0.70 else 'rejected' }}"
```

`_score` is task-local (leading `_`): it exists only while `decide` runs, so only `decision` lands in
the workflow context.

**Failures are non-fatal, which cuts both ways.** A condition that raises is logged and treated as
false; a rule that raises while applying its conclusions is logged and skipped. One malformed rule
cannot take down a whole policy — but a typo in a fact name produces a rule that silently never
fires rather than an error. Test your rule sets, and check the logs when a rule you expected to fire
did not.

**Rules are data.** Because they live in YAML rather than code, a rule set can be published,
versioned, and deployed like any other wfspec — which is usually the reason to use a rules engine at
all.

---

## Next steps

- [State Machines](./state-machines.md) — the event-driven alternative
- [Tasks Reference](../reference/statements.md) — task kinds usable as rule actions
- [Expressions](./expressions.md) — the `{{ }}` language used in conditions
- The `moco-examples` project's `rules-engine` folder — a full loan-approval rule set and a live session
