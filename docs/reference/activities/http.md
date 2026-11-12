---
sidebar_label: HTTP
---

# HTTP Activities

One activity, `http.request`, makes an HTTP call from a workflow. It is the most common way to
reach a service that has no dedicated activity provider.

## Setup

No configuration is required. Two environment variables on the worker affect every call:

| Variable | Effect |
| --- | --- |
| `MOCO_HTTP_PROXY` | Used as the proxy when `proxy` is not set on the activity |
| `MOCO_HTTP_PROXY_BYPASS` | Semicolon-separated host patterns that skip the proxy, `*` glob supported — e.g. `localhost;127.0.0.1;*.internal.corp` |

Bearer authentication uses an **encrypted** token rather than a secret key name — see
[Authentication](#authentication) below.

:::note Destinations can be restricted
Every call asserts the `internal.http_activities / invoke` privilege with the target's
`<scheme>://<host>` as evidence, so a deployment can allowlist destinations. If no such policy is
deployed the check passes — see [Authz Activities](./authz.md).
:::

---

## `http.request`

Sends an HTTP request and returns the status, headers and body. The body is returned as text by
default, or parsed JSON with `output_json: true`.

A non-2xx response is **not** an error by default: the activity returns normally with
`is_success: false`. Set `raise_for_status: true` to fail the activity instead.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `method` | str | yes | — | HTTP method: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, … |
| `url` | str | yes | — | Target URL |
| `content` | str | no | `null` | Raw string body. Use for plain text or a pre-serialized payload |
| `data` | dict | no | `null` | Form body, sent as `application/x-www-form-urlencoded` |
| `json_data` | any | no | `null` | JSON body. Sets `Content-Type: application/json` |
| `headers` | dict[str, str] | no | `null` | Extra request headers |
| `encrypted_auth_token` | [EncryptedData](#encrypteddata) | no | `null` | Encrypted bearer token, decrypted inside the activity and sent as `Authorization: Bearer <token>` |
| `follow_redirects` | bool | no | client default | Follow 3xx redirects |
| `proxy` | str | no | `MOCO_HTTP_PROXY` | Proxy URL, e.g. `http://proxy.example.com:8080` |
| `output_json` | bool | no | `false` | Parse the response body as JSON into `json` instead of returning `text` |
| `skip_cert_verify` | bool | no | `false` | Skip TLS certificate verification |
| `raise_for_status` | bool | no | `false` | Fail the activity on a 4xx/5xx response |

Only one of `content`, `data` and `json_data` should be set.

#### EncryptedData

The output of [`builtin.secret.get`](./secret.md#builtinsecretget). Pass it through unchanged.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `encrypted_data` | str | yes | The encrypted secret |
| `encrypt_key_name` | str | yes | Name of the key it was encrypted with |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `status_code` | int | HTTP status code |
| `is_success` | bool | True for a 2xx response |
| `headers` | dict[str, str] | Response headers |
| `text` | str | Response body, when `output_json` is false or unset |
| `json` | any | Parsed response body, when `output_json` is true |

`text` and `json` are mutually exclusive — exactly one of them is present.

**Examples**

A GET with an explicit retry policy, reading the parsed body:

```yaml
- task_name: fetch-with-retry
  activity:
    type: http.request
    input:
      method: GET
      url: https://httpbin.org/get?demo=retry
      output_json: true
    options:
      retry_policy:
        timeout_sec: 10
        max_attempts: 3
        initial_interval_sec: 1
        backoff_coefficient: 2.0
        non_retryable_error_types:
          - ValueError
  output:
    set:
      - fetched_args: '{{ _["json"].get("args") }}'
```

A POST with a JSON body, keeping the whole response:

```yaml
- task_name: create-order
  activity:
    type: http.request
    input:
      method: POST
      url: https://api.example.com/orders
      headers:
        Accept: application/json
      json_data:
        order_id: '{{ order_id }}'
        items: '{{ items }}'
      output_json: true
      raise_for_status: true
    options:
      retry_policy:
        max_attempts: 1      # POST is not idempotent
  output:
    as: created              # -> status_code, is_success, headers, json
```

A non-2xx response is data unless `raise_for_status` is set, so branch on `is_success`. With
`raise_for_status: true`, handle the failure with `on_error` instead:

```yaml
- task_name: lookup-customer
  activity:
    type: http.request
    input:
      method: GET
      url: 'https://api.example.com/customers/{{ customer_id }}'
      output_json: true
      raise_for_status: true
  output:
    data: '{{ _["json"] }}'
    as: customer
  on_error:
    catch: true              # the error is consumed; `do`'s result becomes the task's result
    do:
      set:
        - customer: null
        - lookup_error: '{{ _["error_message"] }}'
```

More request shapes (form body, bearer token, 404 as data) are in
`moco-examples/activities/http-request.yaml`.

## Authentication

`http.request` does not take a `*_secret_key` field. Fetch the token with
[`builtin.secret.get`](./secret.md#builtinsecretget), which returns it **still encrypted**, and
hand the blob straight to `encrypted_auth_token` — the activity decrypts it internally, so the
plaintext token never enters workflow context.

```yaml
- task_name: get-token
  activity:
    type: builtin.secret.get
    input:
      secret_name: PARTNER_API_TOKEN
  output:
    as: api_token

- task_name: list-accounts
  activity:
    type: http.request
    input:
      method: GET
      url: https://api.partner.example.com/v1/accounts
      encrypted_auth_token: '{{ api_token }}'
      output_json: true
  output:
    as: accounts
```

For any other scheme — an API key header, basic auth — build the header yourself, but note that
doing so puts the credential into workflow context and history.

:::caution The default retry policy retries writes
`http.request` inherits the platform default of 3 attempts. A `POST` that is not idempotent will
be sent up to three times on transient failures; set `options.retry_policy.max_attempts: 1` for those.
:::

:::note Request timeout
When `options.retry_policy.timeout_sec` is not set, the underlying HTTP client uses a 45-second timeout —
shorter than the 60-second activity default. Set `timeout_sec` explicitly for slow endpoints.
:::
