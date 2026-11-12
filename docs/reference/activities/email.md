---
sidebar_label: Email
---

# Email Activities

One activity, `email.send`, delivers a message over SMTP. Use it for notifications and alerts at
the end of a workflow.

## Setup

Every connection setting can come from the activity, from the worker's configuration, or from an
environment variable, resolved in that order:

| Setting | Input field | Environment variable | Fallback |
| --- | --- | --- | --- |
| Host | `smtp_host` | `MOCO_SMTP_HOST` | — |
| Port | `smtp_port` | `MOCO_SMTP_PORT` | `465` with `use_ssl`, otherwise `587` |
| Username | `username` | `MOCO_SMTP_USERNAME` | — |
| Password | `password_secret_key` | `MOCO_SMTP_PASSWORD` | — |

So a deployment with SMTP configured on the worker only needs the message fields:
`from_address`, `to_addresses`, `subject` and a body.

`password_secret_key` is the **name of a secret**, not the password. Authentication is attempted
only when a username *and* a password both resolve.

---

## `email.send`

Sends one message, optionally with an HTML body, CC/BCC recipients and attachments.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `from_address` | str | yes | — | Sender address |
| `to_addresses` | list[str] | yes | — | Primary recipients |
| `subject` | str | yes | — | Subject line |
| `body_text` | str | no | `null` | Plain-text body |
| `body_html` | str | no | `null` | HTML body. Set both bodies to send a multipart message |
| `cc_addresses` | list[str] | no | `null` | CC recipients |
| `bcc_addresses` | list[str] | no | `null` | BCC recipients |
| `reply_to` | str | no | `null` | `Reply-To` address |
| `custom_headers` | dict[str, str] | no | `null` | Extra message headers |
| `attachments` | list[[EmailAttachment](#emailattachment)] | no | `null` | Files to attach |
| `smtp_host` | str | no | `MOCO_SMTP_HOST` | SMTP server host |
| `smtp_port` | int | no | see [Setup](#setup) | SMTP server port |
| `username` | str | no | `MOCO_SMTP_USERNAME` | SMTP username |
| `password_secret_key` | str | no | `MOCO_SMTP_PASSWORD` | Secret name holding the SMTP password |
| `use_tls` | bool | no | `true` | STARTTLS on a plain connection |
| `use_ssl` | bool | no | `false` | Implicit TLS from the first byte (usually port 465) |
| `timeout` | int | no | `30` | Socket timeout in seconds, independent of the activity timeout |

#### EmailAttachment

Workers have no shared filesystem with the caller, so attachment content travels inline as base64.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `filename` | str | yes | — | Name shown to the recipient |
| `data` | str | yes | — | Base64-encoded file content |
| `content_type` | str | no | `"application/octet-stream"` | MIME type |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `success` | bool | True when **at least one** recipient was accepted — see the caution below |
| `message_id` | str \| null | `Message-ID` of the sent message |
| `recipients_accepted` | list[str] | Addresses the server accepted |
| `recipients_rejected` | dict | Addresses the server refused, mapped to the server's reason |

**Examples**

An alert with both bodies:

```yaml
- task_name: send-availability-alert
  activity:
    type: email.send
    input:
      smtp_host: '{{ smtp_host }}'
      smtp_port: '{{ smtp_port }}'
      username: '{{ smtp_username }}'
      password_secret_key: '{{ smtp_password_key }}'
      from_address: '{{ alert_from }}'
      to_addresses: '{{ alert_to }}'
      subject: 'NYU tour availability found ({{ len(found_dates) }} date(s))'
      body_text: >-
        Tour availability was found for NYU in-person visits.
      body_html: >-
        <h2>NYU Visit Tour availability found</h2>
    options:
      retry_policy:
        timeout_sec: 30
```

Attaching a generated report, relying on the worker's SMTP configuration:

```yaml
- task_name: mail-report
  activity:
    type: email.send
    input:
      from_address: reports@example.com
      to_addresses: [ops@example.com]
      subject: 'Daily report {{ run_date }}'
      body_text: 'The report for {{ run_date }} is attached.'
      attachments:
        - filename: 'report-{{ run_date }}.csv'
          content_type: text/csv
          data: '{{ base64.b64encode(report_csv.encode()).decode() }}'
  output:
    as: mail_result          # -> success, message_id, recipients_accepted, recipients_rejected
```

:::caution `success` does not mean every recipient got it
`success` is true when the server accepted *any* recipient. If you need all-or-nothing delivery,
check that `recipients_rejected` is empty:

```yaml
- task_name: require-all-recipients
  raise:
    if: '{{ len(mail_result["recipients_rejected"]) > 0 }}'
    type: error
    error_type: EmailRejected
    message: 'Rejected recipients: {{ mail_result["recipients_rejected"] }}'
```
:::

:::note Retries re-send the message
`email.send` defaults to 2 attempts and there is no deduplication — a retry after a timeout can
deliver the message twice. Set `options.retry_policy.max_attempts: 1` where a duplicate would be worse than a miss.
:::
