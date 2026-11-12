---
sidebar_label: OpenAI
---

# OpenAI Activities

One activity, `openai.chat.completions`, sends a chat completion request to any OpenAI-compatible
endpoint and returns the assistant's message.

Use it for a single prompt-and-response task: classify something, extract fields, draft text. When
the work is open-ended enough that you cannot specify it in advance, use
[`claude_agent.query`](./claude-agent.md) instead — an agent loop reasons over several turns and
calls tools on its own.

## Setup

The API key is named, not inlined: `apikey_secret_key` is the name of a secret holding the key. A
bare `NAME` resolves a user-scoped secret, `global/NAME` a global one.

Endpoint and model fall back to the worker's defaults:

| Input field | Environment default |
| --- | --- |
| `base_url` | `MOCO_LLM_DEFAULT_BASE_URL` |
| `model_name` | `MOCO_LLM_DEFAULT_MODEL_NAME` |

A missing default is an error rather than a silent fallback, so a deployment either configures them
or every workflow supplies them.

:::caution `base_url` is used verbatim — include the version path
Nothing is appended. Use `https://my-gateway/v1`, `http://localhost:11434/v1` for Ollama, or
`https://generativelanguage.googleapis.com/v1beta/openai/` for Gemini. A bare host will not work.
The same rule applies to [`llama_index`](./llama-index.md) model blocks.
:::

## Defaults

60 s timeout, 3 attempts — the platform default, and **short for a real completion**. Raise
`options.retry_policy.timeout_sec` for anything longer than a sentence or two, and consider lowering `max_attempts`:
three attempts means paying for the generation up to three times.

Applied inside the activity when you do not set them: `max_tokens: 8000`, `temporature: 0.1`.
SDK-level retries are disabled; retrying is the workflow runtime's job.

---

## `openai.chat.completions`

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apikey_secret_key` | str | yes | — | Secret name holding the API key |
| `messages` | list[object] | yes | — | The conversation, in OpenAI chat format — see [Messages](#messages) |
| `base_url` | str | no | `MOCO_LLM_DEFAULT_BASE_URL` | Endpoint base URL, version path included |
| `model_name` | str | no | `MOCO_LLM_DEFAULT_MODEL_NAME` | Model to call |
| `proxy` | str | no | `null` | Proxy URL for this request |
| `response_format` | object | no | `null` | `{type: text}`, `{type: json_object}`, or a `json_schema` block for structured output |
| `tools` | list[object] | no | `null` | Function tool definitions the model may call |
| `tool_choice` | str \| object | no | `null` | `none`, `auto`, `required`, or a named tool |
| `stream` | bool | no | `false` | Stream the response internally — see the note below |
| `max_tokens` | int | no | `8000` | Maximum tokens to generate |
| `temporature` | number | no | `0.1` | Sampling temperature |

:::note `temporature`, not `temperature`
The field name carries a typo in the platform's input model. Spelling it correctly means the value
is ignored and the default of `0.1` applies.
:::

#### Messages

Each message is `{role, content}` with `role` one of `system`, `developer`, `user`, `assistant`,
`tool` or `function`. `content` is a string, or a list of typed parts for multimodal input (text,
`image_url`, `input_audio`, `file`). Assistant messages may carry `tool_calls`; tool messages carry
a `tool_call_id`.

The shapes are exactly the OpenAI SDK's — see the
[chat completions API reference](https://platform.openai.com/docs/api-reference/chat/create) for
the full set of fields, including `tools` and `response_format`.

**Output**

The assistant's message:

| Field | Type | Description |
| --- | --- | --- |
| `role` | str | Always `"assistant"` |
| `content` | str \| null | The generated text; `null` when the model only called tools |
| `tool_calls` | list[object] \| null | Tool calls the model made, each with `id`, `type` and `function{name, arguments}` |
| `refusal` | str \| null | Refusal message, when the model declined |

`function.arguments` is a **JSON string**, not an object — parse it before use.

**Examples**

Structured output, parsed in the task's `output`:

```yaml
- task_name: generate_reminders
  activity:
    type: openai.chat.completions
    input:
      apikey_secret_key: "{{ llm_apikey_secret_key }}"
      base_url: "{{ llm_base_url }}"
      model_name: "{{ llm_model_name }}"
      max_tokens: 800
      temporature: 0.2
      response_format:
        type: json_object
      messages:
        - role: system
          content: |
            You are a personal assistant that reads a weather forecast and
            writes short, actionable reminders for the day.
        - role: user
          content: "{{ forecast_text }}"
    options:
      retry_policy:
        timeout_sec: 120
        max_attempts: 2
  output:
    data: '{{ json.loads(_["content"]) }}'    # `_` is the assistant message
    as: reminders
```

Asking the model to pick a tool:

```yaml
- task_name: route-request
  activity:
    type: openai.chat.completions
    input:
      apikey_secret_key: "MY_LLM_TOKEN"
      model_name: "{{ llm_model_name }}"
      messages:
        - role: user
          content: "{{ user_request }}"
      tools:
        - type: function
          function:
            name: lookup_order
            description: Look up an order by its id
            parameters:
              type: object
              properties:
                order_id: {type: string}
              required: [order_id]
      tool_choice: auto
    options:
      retry_policy:
        timeout_sec: 120
  output:
    set:
      - routing: '{{ _ }}'
      - order_id: >-
          {{ json.loads(_["tool_calls"][0]["function"]["arguments"])["order_id"]
             if _["tool_calls"] else None }}
```

:::note Streaming is internal
`stream: true` streams from the provider and assembles the chunks inside the activity; the workflow
still receives one complete message. It exists to avoid gateway idle timeouts on long generations,
not to surface tokens to the workflow — there is no relay topic here. To stream progress to a
client, use [`claude_agent.query`](./claude-agent.md), which does.
:::

:::caution TLS verification is disabled for this provider
The OpenAI client is constructed with certificate verification off. Keep that in mind when pointing
`base_url` at anything outside a trusted network.
:::

:::note The proxy is not inherited
Unlike [`http.request`](./http.md), this provider ignores `MOCO_HTTP_PROXY`. Set `proxy`
explicitly if the endpoint needs one.
:::
