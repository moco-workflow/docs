---
sidebar_label: SQL
---

# SQL Activities

Two activities run parameterized SQL against a PostgreSQL database:
`sql.query` for statements that return rows, and `sql.execute` for writes and DDL.

## Setup

Both take `connection_string_secret_key` — the **name of a secret** holding the full connection
string, not the string itself. Upload it once with
[`builtin.secret.upload`](./secret.md#builtinsecretupload):

```
postgresql://user:password@host:5432/dbname
```

The URL must start with `postgresql://` (or an explicit `postgresql+psycopg2://` /
`postgresql+asyncpg://`); a bare `postgresql://` is rewritten to the asyncpg driver internally.
Credentials are resolved inside the activity and never enter workflow context.

## Parameters

Both activities use **named placeholders** — `:name` — bound from the `parameters` dict. Never
interpolate values into the SQL text with `{{ }}`; that is how SQL injection gets in, and the
placeholder form is also faster because the statement can be prepared.

```yaml
input:
  query: 'SELECT id, name FROM account WHERE tier = :tier AND created_at > :since'
  parameters:
    tier: '{{ tier }}'
    since: '{{ since_date }}'
```

## Defaults

| Activity | Timeout | Max attempts |
| --- | --- | --- |
| `sql.query` | 60 s | 3 |
| `sql.execute` | 60 s | **1** — a write may not be idempotent |

---

## `sql.query`

Runs a statement that produces a result set — a `SELECT`, or a write with `RETURNING` — and
returns the rows.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection_string_secret_key` | str | yes | — | Secret name holding the connection string |
| `query` | str | yes | — | SQL with `:name` placeholders |
| `parameters` | dict | no | `null` | Values bound to the placeholders |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `rows` | list[dict] | One dict per row, keyed by column name |
| `columns` | list[str] | Column names, in result order |
| `row_count` | int | Number of rows returned |

**Example**

```yaml
- task_name: load-active-accounts
  activity:
    type: sql.query
    input:
      connection_string_secret_key: REPORTING_DB_CONN
      query: |
        SELECT id, name, tier
        FROM account
        WHERE tier = :tier AND created_at > :since
        ORDER BY created_at DESC
      parameters:
        tier: '{{ tier }}'
        since: '{{ since_date }}'
  output:
    set:
      - accounts: '{{ _["rows"] }}'
      - account_names: '{{ [r["name"] for r in _["rows"]] }}'
```

---

## `sql.execute`

Runs an `INSERT`, `UPDATE`, `DELETE` or DDL statement inside a transaction and returns the number
of affected rows. Pass a **list** of dicts as `parameters` to run the statement once per dict
(`executemany`).

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection_string_secret_key` | str | yes | — | Secret name holding the connection string |
| `statement` | str | yes | — | SQL with `:name` placeholders |
| `parameters` | dict \| list[dict] | no | `null` | One dict, or a list of dicts for a batch |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `row_count` | int | Rows affected, or `-1` when the driver does not report a count |

**Examples**

Conditional DDL — `skip_if` skips the task when there is nothing to drop:

```yaml
- task_name: drop-domain-table
  skip_if: '{{ not (drop_table and existing.get("table_name")) }}'
  activity:
    type: sql.execute
    input:
      connection_string_secret_key: '{{ existing.get("pgvector_secret_key") or "MOCO_PGVECTOR_CONN" }}'
      statement: 'DROP TABLE IF EXISTS data_{{ re.sub(r"[^a-z0-9_]", "_", str(existing["table_name"]).strip().lower()) }}'
```

A batch insert:

```yaml
- task_name: record-results
  activity:
    type: sql.execute
    input:
      connection_string_secret_key: REPORTING_DB_CONN
      statement: 'INSERT INTO run_result (run_id, symbol, score) VALUES (:run_id, :symbol, :score)'
      parameters: '{{ [{"run_id": run_id, "symbol": r["symbol"], "score": r["score"]} for r in results] }}'
  output:
    set:
      - inserted_count: '{{ _["row_count"] }}'
```

:::note Each call opens its own connection
An engine is created and disposed per activity — there is no pooling across activities. Prefer one
statement over many small ones; use `executemany` for batches.
:::

:::caution Raising `max_attempts` on a write
`sql.execute` ships `max_attempts: 1` on purpose. Only raise it for a statement that is safe to
repeat — an idempotent `UPDATE ... SET`, or an `INSERT ... ON CONFLICT DO NOTHING`.
:::
