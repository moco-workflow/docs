---
sidebar_label: TypeSafe
---

# TypeSafe Activities

**`typesafe.system_one`** asks named, typed questions about a piece of text or JSON and returns
calibrated answers. It wraps the [TypeSafe](https://typesafe.ai) Python SDK, so it talks to the
hosted TypeSafe API or to any server that implements the same `/v1/systemone` protocol, such as a
self-hosted [Laya](https://pypi.org/project/laya/) (`laya-serve`).

Each question has one of three types:

| Type | Asks | Answer |
| --- | --- | --- |
| `noul` | a yes/no question | probability of *yes*, 0–1 |
| `choice` | which of several labels applies | the selected label, plus a probability per label |
| `score` | where the state falls on an ordered rubric | the expected score (0 = first rubric entry), plus a probability per level |

Use it for fast classification and routing decisions — triage, sentiment, policy checks — where a
full chat completion would be slower and harder to branch on.

## Setup

Connection settings come from the activity input or, when omitted, from the worker's environment:

| Input field | Environment variable | Fallback |
| --- | --- | --- |
| `base_url` | `TYPESAFE_DEFAULT_BASE_URL` | `https://api.typesafe.ai` |
| `apikey_secret_key` | `TYPESAFE_DEFAULT_API_KEY` (the key itself) | a placeholder key |
| `model` | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` |

`apikey_secret_key` names a stored secret, as elsewhere — see
[Secret Activities](./secret.md). The environment variable holds the key itself.

### Using a local Laya server

Point the worker at the server and leave the key unset:

```bash
TYPESAFE_DEFAULT_BASE_URL=http://localhost:8001
```

`laya-serve` checks an API key only when it was started with `LAYA_API_KEY`. The SDK refuses to run
without *some* key, so when none is configured the activity sends a placeholder. If you set
`LAYA_API_KEY` on the server, store the same value as a secret and pass its name in
`apikey_secret_key`, or set `TYPESAFE_DEFAULT_API_KEY` on the worker.

Two things differ from the hosted API:

- **Every question needs `instructions`.** Laya rejects a question without them with a 400.
- **`model`** selects a Laya checkpoint only when it names one: `english`, `multilingual` or
  `typed-decisions`. Any other value, including the default `jev-latest`, lets Laya choose the
  checkpoint from the text's language. The response's `raw.routing` shows what it picked.

### Using moco-systemone

`moco-systemone` is a small server that ships with Moco. It implements the same protocol on top of
a local [Ollama](https://ollama.com) model, `qwen3:0.6b` by default. Start it on port 8002 and
point the worker at it:

```bash
TYPESAFE_DEFAULT_BASE_URL=http://localhost:8002
```

- `instructions` is optional. A question without it gets a generic prompt for its type.
- `model` picks a model alias configured on the server. Any other name, including the default
  `jev-latest`, uses the server's default model.
- Answers come from a small model and are coarser than the hosted API's. `choice` and `score`
  questions work best with short, distinct labels and rubric entries, such as `calm`,
  `frustrated` and `angry`.

## Defaults

| Activity | Timeout | Max attempts |
| --- | --- | --- |
| `typesafe.system_one` | 60 s | 3 |

The timeout is generous because the first request to a CPU-hosted Laya checkpoint can be slow.
Retries are left to the activity's retry policy; the SDK's own retries are turned off. A request
the server rejects as malformed (a 4xx other than 408, 409 or 429) fails immediately and is not
retried.

---

## `typesafe.system_one`

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `state` | str \| dict \| list | yes | — | The text or JSON to evaluate |
| `questions` | dict[str, [Question](#question)] | yes | — | Questions keyed by the name their answer is returned under; at least one |
| `model` | str | no | `TYPESAFE_DEFAULT_MODEL` | Model name |
| `base_url` | str | no | `TYPESAFE_DEFAULT_BASE_URL` | API root, without `/v1/systemone` |
| `apikey_secret_key` | str | no | `TYPESAFE_DEFAULT_API_KEY` | Name of a secret holding the API key |
| `extra_body` | dict | no | `null` | Extra top-level request-body fields, merged over the request body |

#### Question

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `noul` \| `choice` \| `score` | yes | Question type |
| `instructions` | str \| dict \| list | no (yes for Laya) | The question to ask |
| `criteria` | dict \| list | `choice` and `score` | See below |

`criteria` depends on the type:

- `noul`: optional `{"true": ..., "false": ...}` describing the two outcomes.
- `choice`: a dict of labels to descriptions. Use `null` for a label that needs no description.
- `score`: a non-empty, ordered list of rubric descriptions. The first entry is score 0.

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `model` | str | The model that answered |
| `usage` | `{input_tokens, output_tokens}` | Token counts, when reported |
| `nouls` | dict[str, float] | Probability of *yes*, per `noul` question |
| `choices` | dict[str, str] | Selected label, per `choice` question |
| `scores` | dict[str, float] | Expected score, per `score` question |
| `answers` | dict[str, dict] | The full answer objects, per question: `noul`, or `choice`/`score` with `confidence` and `probabilities` (and `legend` for scores) |
| `raw` | dict | The response body exactly as the server returned it, including fields the SDK does not model. Laya adds `answer_confidence` and `action` to each answer, and a top-level `routing` |

**Example**

```yaml
- task_name: triage-ticket
  activity:
    type: typesafe.system_one
    input:
      state: "{{ ticket_body }}"
      questions:
        billing:
          type: noul
          instructions: Is this ticket about billing?
        tone:
          type: choice
          instructions: What is the tone of the customer?
          criteria:
            calm: null
            frustrated: null
            angry: null
        urgency:
          type: score
          instructions: How urgent is this ticket?
          criteria: [low, medium, high]
  output:
    as: triage
- task_name: escalate
  skip_if:
    not: "{{ triage['nouls']['billing'] > 0.5 and triage['choices']['tone'] == 'angry' }}"
  set:
    - route: billing-escalation
```

Output for this example from a local Laya server, with `answers` and `raw` omitted:

```json
{
  "model": "laya-rl-agent",
  "usage": {"input_tokens": 103, "output_tokens": 0},
  "nouls": {"billing": 0.9151},
  "choices": {"tone": "angry"},
  "scores": {"urgency": 1.5508}
}
```
