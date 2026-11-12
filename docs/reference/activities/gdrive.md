---
sidebar_label: Google Drive
---

# Google Drive Activities

Six activities read and write files in Google Drive: `gdrive.download`, `gdrive.upload`,
`gdrive.list`, `gdrive.get_metadata`, `gdrive.create_folder` and `gdrive.delete`. Together they
cover picking up a file someone dropped in a shared folder, and publishing a generated report back
to one.

## Setup

All six authenticate as a **service account**, whose key JSON lives in the secret store. Define the
`auth` block once in `context` and reference it everywhere:

```yaml
context:
  gdrive_auth:
    credentials_secret_key: "GDRIVE_SERVICE_ACCOUNT"  # the whole key JSON, in the secret store
    # impersonate_user: "ops@example.com"   # optional: act as a user via domain-wide delegation
    # scopes: ["https://www.googleapis.com/auth/drive.readonly"]   # optional: narrow the access
```

#### DriveAuthInfo

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `credentials_secret_key` | str | yes | — | Secret name holding the service-account key JSON |
| `impersonate_user` | str | no | `null` | Act as this user via domain-wide delegation |
| `scopes` | list[str] | no | full Drive access | Narrow the granted scopes |

:::caution A service account has its own empty Drive
It can only see files and folders **explicitly shared with its email address** — so share the target
folder with the service account before the first run, or set `impersonate_user` and configure
domain-wide delegation. This is the most common cause of "file not found".
:::

### Environment

| Variable | Effect |
| --- | --- |
| `MOCO_GDRIVE_FILE_DIR` | Root directory for the `file` content format (default `/tmp/moco/gdrive`) |
| `MOCO_GDRIVE_MAX_FILE_SIZE_MB` | Per-transfer ceiling (default 256) |

## Content moves in one of two formats

Every download and upload picks a format:

| Format | Where the bytes live | Use it when |
| --- | --- | --- |
| `base64` (default) | Inline in workflow context, as a base64 string | The file is small and a later task needs its content |
| `file` | On the worker's filesystem, under `MOCO_GDRIVE_FILE_DIR` | The file is large, or a later `shell.run` needs it on disk |

`base64` copies the payload into workflow history, so keep it to small files. `file` paths are
always relative to `MOCO_GDRIVE_FILE_DIR`; paths that escape that directory are rejected.

## Defaults

| Activity | Timeout | Max attempts |
| --- | --- | --- |
| `gdrive.download` | 300 s | 3 |
| `gdrive.upload` | 300 s | **1** |
| `gdrive.list`, `gdrive.get_metadata` | 60 s | 3 |
| `gdrive.create_folder` | 60 s | **1** |
| `gdrive.delete` | 60 s | **1** |

:::note The three write activities are not retried
Drive allows several files to share a name in one folder, so a retried create leaves a duplicate
behind. The idempotent paths are `upload` with an explicit `file_id` (which replaces that file's
contents in place) and `create_folder` with `skip_if_exists: true`; with either of those set it is
safe to raise `max_attempts` in the task's `options.retry_policy`. `delete` is destructive, so a
retry after an ambiguous failure could remove a file recreated in between.
:::

#### DriveFile

Returned by `get_metadata`, `list` and `create_folder`.

| Field | Type | Description |
| --- | --- | --- |
| `file_id` | str | Drive file id |
| `name` | str | File name |
| `mime_type` | str | MIME type |
| `size_bytes` | int \| null | Size; absent for Google-native documents |
| `created_time` | str \| null | Creation timestamp |
| `modified_time` | str \| null | Last modification timestamp |
| `web_view_link` | str \| null | Link to open the file in Drive |
| `parents` | list[str] | Parent folder ids |
| `trashed` | bool \| null | Whether the file is in the trash |

---

## `gdrive.list`

Lists files, filtered by parent folder and/or name, or by a raw
[Drive query string](https://developers.google.com/drive/api/guides/search-files). Use it to
resolve a name to a `file_id`.

Returns one page; pass the returned `next_page_token` back as `page_token` for the next.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |
| `query` | str | no | `null` | Raw Drive query string; overrides the filters below |
| `parent_folder_id` | str | no | `null` | Only files in this folder |
| `name_contains` | str | no | `null` | Only files whose name contains this |
| `include_trashed` | bool | no | `false` | Include trashed files |
| `page_size` | int | no | `100` | Files per page |
| `page_token` | str | no | `null` | Token from a previous call |
| `order_by` | str | no | `null` | Sort order, e.g. `modifiedTime desc` |
| `drive_id` | str | no | `null` | Shared drive to search within |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `files` | list[[DriveFile](#drivefile)] | The page of results |
| `file_count` | int | Number of files in this page |
| `next_page_token` | str \| null | Token for the next page, or `null` when this is the last |

**Example**

```yaml
- task_name: find-latest-report
  activity:
    type: gdrive.list
    input:
      auth: "{{ gdrive_auth }}"
      parent_folder_id: "{{ inbox_folder_id }}"
      name_contains: "monthly-report"
      order_by: "modifiedTime desc"
      page_size: 10
  output:
    as: found      # -> files[{file_id, name, mime_type, size_bytes, ...}], file_count,
                   #    next_page_token
```

---

## `gdrive.download`

Downloads a file's content, either inline as base64 or onto the worker's disk.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `file_id` | str | yes | — | File to download |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |
| `output_format` | enum | no | `"base64"` | `base64` or `file` |
| `file_path` | str | no | `null` | Destination path under `MOCO_GDRIVE_FILE_DIR`, for `output_format: file` |
| `export_mime_type` | str | no | format-specific | Override the export format for a Google-native document |
| `acknowledge_abuse` | bool | no | `false` | Download a file Drive has flagged as abusive |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `file_id` | str | The file downloaded |
| `name` | str | File name |
| `mime_type` | str | MIME type of the returned content |
| `size_bytes` | int | Size of the content |
| `format` | enum | `base64` or `file` — which of the two `data` holds |
| `data` | str | The base64 content, or the absolute path it was written to |
| `exported` | bool | Whether a Google-native document was exported to get these bytes |

**Example**

```yaml
- task_name: fetch-report
  activity:
    type: gdrive.download
    input:
      file_id: "{{ found['files'][0]['file_id'] }}"
      auth: "{{ gdrive_auth }}"
      output_format: base64           # or 'file' plus a file_path
  output:
    as: report   # -> file_id, name, mime_type, size_bytes, format, data, exported
```

```yaml
- task_name: download-to-disk
  activity:
    type: gdrive.download
    input:
      file_id: "{{ uploaded_file_id }}"
      auth: "{{ gdrive_auth }}"
      output_format: file
      file_path: "gdrive-demo/{{ file_name }}"
  output:
    as: downloaded_file
```

`format` echoes which of the two `data` holds, so a downstream task can branch on it.

:::note Google-native documents are exported
Docs, Sheets, Slides and Drawings have no stored bytes and cannot be downloaded directly; they are
exported automatically to `.docx`, `.xlsx`, `.pptx` and `.pdf` respectively, and `exported: true`
says so. Set `export_mime_type: application/pdf` to get a PDF of any of them instead.
:::

---

## `gdrive.upload`

Creates a file from base64 content or from a file on the worker's disk — or replaces an existing
file's content when `file_id` is given.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | yes | — | File name in Drive |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |
| `source_format` | enum | no | `"base64"` | `base64` (use `data`) or `file` (use `file_path`) |
| `data` | str | no | `null` | Base64 content, for `source_format: base64` |
| `file_path` | str | no | `null` | Path under `MOCO_GDRIVE_FILE_DIR`, for `source_format: file` |
| `parent_folder_id` | str | no | Drive root | Folder to create the file in |
| `mime_type` | str | no | guessed from `name` | Target MIME type. A Google-native type converts the upload |
| `source_mime_type` | str | no | guessed from `name` | What the bytes actually are, needed for conversion |
| `file_id` | str | no | `null` | Replace this file's content instead of creating a new one |
| `description` | str | no | `null` | File description |
| `properties` | dict[str, str] | no | `null` | Custom file properties |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `file_id` | str | The created or updated file |
| `name` | str | File name |
| `mime_type` | str | MIME type in Drive |
| `size_bytes` | int \| null | Size |
| `web_view_link` | str \| null | Link to open the file |
| `parents` | list[str] | Parent folder ids |

**Examples**

```yaml
- task_name: publish-summary
  activity:
    type: gdrive.upload
    input:
      name: "summary-{{ run_date }}.csv"
      auth: "{{ gdrive_auth }}"
      data: "{{ base64.b64encode(summary_csv.encode()).decode() }}"
      parent_folder_id: "{{ output_folder_id }}"
      mime_type: "text/csv"       # optional; guessed from the file name when omitted
  output:
    as: published        # -> file_id, name, mime_type, size_bytes, web_view_link, parents
```

```yaml
- task_name: publish-large-export
  activity:
    type: gdrive.upload
    input:
      name: "export.parquet"
      auth: "{{ gdrive_auth }}"
      source_format: file
      file_path: "exports/export.parquet"   # relative to MOCO_GDRIVE_FILE_DIR
      parent_folder_id: "{{ output_folder_id }}"
  output:
    as: published
```

Set `mime_type` to a Google-native type (e.g. `application/vnd.google-apps.spreadsheet`) to have
Drive convert the upload into a native document as it lands. Conversion needs to know the format to
convert *from*, which is taken from the file name — add `source_mime_type` when the name has no
useful extension:

```yaml
- activity:
    type: gdrive.upload
    input:
      name: "Q3 numbers"          # no extension, so the source format can't be guessed
      auth: "{{ gdrive_auth }}"
      data: "{{ base64.b64encode(csv_text.encode()).decode() }}"
      mime_type: "application/vnd.google-apps.spreadsheet"   # target: a real Google Sheet
      source_mime_type: "text/csv"                           # what the bytes actually are
```

---

## `gdrive.get_metadata`

Returns one file's metadata without downloading its content.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `file_id` | str | yes | — | File to describe |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |

**Output**

A [DriveFile](#drivefile).

**Example**

```yaml
- task_name: describe-report
  activity:
    type: gdrive.get_metadata
    input:
      file_id: "{{ uploaded_file_id }}"
      auth: "{{ gdrive_auth }}"
  output:
    as: metadata  # -> file_id, name, mime_type, size_bytes, parents, ...
```

---

## `gdrive.create_folder`

Creates a folder. With `skip_if_exists: true` it reuses an existing folder of the same name under
the same parent instead of creating a second one — which also makes the activity safe to retry.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | yes | — | Folder name |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |
| `parent_folder_id` | str | no | Drive root | Parent folder |
| `skip_if_exists` | bool | no | `false` | Reuse a same-named folder under the same parent |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `folder` | [DriveFile](#drivefile) | The folder, created or reused |
| `created` | bool | `true` when it was created, `false` when an existing one was reused |

**Example**

```yaml
- activity:
    type: gdrive.create_folder
    input:
      name: "{{ run_date }}"
      auth: "{{ gdrive_auth }}"
      parent_folder_id: "{{ archive_folder_id }}"
      skip_if_exists: true      # reuse a folder of this name instead of creating a second one
  output:
    as: run_folder     # -> folder{file_id, name, ...}, created
```

---

## `gdrive.delete`

Moves a file or folder to the trash, or deletes it outright.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `file_id` | str | yes | — | File or folder to delete |
| `auth` | [DriveAuthInfo](#driveauthinfo) | yes | — | Service-account credentials |
| `permanent` | bool | no | `false` | Delete outright instead of trashing |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `file_id` | str | The file deleted |
| `permanent` | bool | Whether it was deleted outright |

**Example**

```yaml
- activity:
    type: gdrive.delete
    input:
      file_id: "{{ stale_file_id }}"
      auth: "{{ gdrive_auth }}"
      permanent: false          # move to trash (default); true deletes outright
  output:
    as: deleted        # -> file_id, permanent
```

:::caution Deleting a folder deletes its contents
And `permanent: true` cannot be undone. Prefer the default trash behaviour unless you are certain.
:::

---

A complete runnable example — create a folder, upload a file, list it, download it back and clean
up — lives in `moco-examples/activities/gdrive.yaml`.

To index Drive documents for retrieval, see
[`llama_index.index_gdrive`](./llama-index.md#llama_indexindex_gdrive), which reuses the same
`auth` block.
