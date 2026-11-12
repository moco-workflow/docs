---
sidebar_label: LlamaIndex (RAG)
---

# LlamaIndex Activities

Eight activities build, query and drop a vector index over your own documents, so an LLM can answer from
them instead of from its training data — retrieval-augmented generation.

Documents are chunked and embedded into a [pgvector](https://github.com/pgvector/pgvector) table by
one of the `llama_index.index_*` activities, and `llama_index.query` finds the chunks closest to a
question. `llama_index.drop_table` deletes an index once it is no longer needed.

There is one indexing activity per document source:

| Activity | Indexes |
| --- | --- |
| [`llama_index.index_web`](#llama_indexindex_web) | Pages or documents at a list of URLs |
| [`llama_index.index_site`](#llama_indexindex_site) | Every page reachable from one seed — a sitemap, a feed, or a crawl |
| [`llama_index.index_github`](#llama_indexindex_github) | The files of a GitHub or GitHub Enterprise repository |
| [`llama_index.index_gdrive`](#llama_indexindex_gdrive) | A Google Drive folder, file list or query |
| [`llama_index.index_files`](#llama_indexindex_files) | Files already on the worker's disk |
| [`llama_index.index_docs`](#llama_indexindex_docs) | **Deprecated** — use `index_web` |

They all share the same chunking, embedding and metadata handling, so a single table can hold
documents from several sources: every chunk carries `source_url`, `file_name` and `source_type`,
whichever activity wrote it.

## Setup

Every activity here takes the same two nested blocks. Build them once in `context` and reuse them —
the embedding model **must** be identical on both sides, or the similarity scores are meaningless:

```yaml
context:
  vectordb_info:
    connection_string_secret_key: "MOCO_PGVECTOR_CONN"  # secret holding postgresql://...; omit to use the MOCO_PGVECTOR_CONN env var
    table_name: "product_docs"                          # physical table is data_product_docs
  embed_model_info:
    apikey_secret_key: "MY_LLM_TOKEN"
    base_url: "https://my-gateway/v1"       # or MOCO_LLM_DEFAULT_EMBED_MODEL_BASE_URL, then MOCO_LLM_DEFAULT_BASE_URL
    model_name: "text-embedding-3-small"    # or MOCO_LLM_DEFAULT_EMBED_MODEL_NAME
    embed_dim: 1536                         # must match the model and the existing table
```

#### VectorDbInfo

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `connection_string_secret_key` | str | no | the `MOCO_PGVECTOR_CONN` environment variable | Secret name holding a `postgresql://` connection string |
| `table_name` | str | yes | — | Logical table name; the physical table is `data_<table_name>` |
| `schema_name` | str | no | `"public"` | PostgreSQL schema |

#### EmbedModelInfo

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apikey_secret_key` | str | no | a placeholder key | Secret name holding the embedding API key. Leave unset or empty for an endpoint that needs no key, such as Ollama |
| `base_url` | str | no | `MOCO_LLM_DEFAULT_EMBED_MODEL_BASE_URL`, then `MOCO_LLM_DEFAULT_BASE_URL` | OpenAI-compatible endpoint, version path included |
| `model_name` | str | no | `MOCO_LLM_DEFAULT_EMBED_MODEL_NAME` | Embedding model |
| `embed_dim` | int | no | `1536` | Vector dimension; must match the model and the existing table |

#### LlmModelInfo

Only used by [`llama_index.query`](#llama_indexquery) with `response_mode: synthesize`.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apikey_secret_key` | str | no | the embedding key | Secret name holding the chat API key |
| `base_url` | str | no | `MOCO_LLM_DEFAULT_BASE_URL` | OpenAI-compatible endpoint |
| `model_name` | str | no | `MOCO_LLM_DEFAULT_MODEL_NAME` | Chat model |

:::caution `base_url` is used exactly as given — include the version path
That is `https://my-gateway/v1` for most gateways, `http://localhost:11434/v1` for Ollama, and
`https://generativelanguage.googleapis.com/v1beta/openai/` for Gemini. The same rule applies to
[`openai.chat.completions`](./openai.md).
:::

### Environment

| Variable | Used by |
| --- | --- |
| `MOCO_LLM_DEFAULT_BASE_URL`, `MOCO_LLM_DEFAULT_MODEL_NAME`, `MOCO_LLM_DEFAULT_EMBED_MODEL_BASE_URL`, `MOCO_LLM_DEFAULT_EMBED_MODEL_NAME` | Model defaults |
| `MOCO_PGVECTOR_CONN` | The `postgresql://` connection string itself, used when `connection_string_secret_key` is unset or empty |
| `MOCO_RAG_FILE_DIR` | Root for `index_files`; a path escaping it is rejected |
| `MOCO_HTTP_PROXY` | The `download` and `readability` web loaders |
| `MOCO_CHROME_DRIVER_PATH`, `MOCO_CHROME_PATH` | The `whole_site` crawler only |

The database needs the `vector` extension enabled; `moco-db` does this for you.

## Shared indexing input

Every `index_*` activity accepts these in addition to its own source fields:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `vectordb_info` | [VectorDbInfo](#vectordbinfo) | yes | — | Where the index lives |
| `embed_model_info` | [EmbedModelInfo](#embedmodelinfo) | yes | — | How chunks are embedded |
| `chunk_size` | int | no | `1024` | Characters per chunk |
| `chunk_overlap` | int | no | `200` | Overlap between consecutive chunks |
| `overwrite` | bool | no | `false` | Empty the table before writing — see the caution below |
| `metadata` | dict | no | `{}` | Attached to every chunk; filterable at query time |
| `embed_batch_size` | int | no | `64` | Chunks per embedding batch; mainly affects progress cadence |

## Shared indexing output

Every `index_*` activity except the deprecated `index_docs` returns:

| Field | Type | Description |
| --- | --- | --- |
| `indexed_sources` | list[str] | Sources successfully indexed |
| `failed_sources` | list[object] | Sources that could not be loaded, each `{source, error}` |
| `document_count` | int | Documents loaded |
| `node_count` | int | Chunks written |
| `table_name` | str | Table written to |
| `source_type` | enum | `web`, `site`, `github`, `gdrive` or `file` |

## Defaults

| Activity | Timeout | Max attempts |
| --- | --- | --- |
| `index_web`, `index_files`, `index_docs` | 600 s | 1 |
| `index_site`, `index_github`, `index_gdrive` | 1800 s | 1 |
| `query`, `drop_table` | 120 s | 3 |

:::note Indexing is never retried
Every `index_*` activity writes rows and ships `max_attempts: 1` — a retry would duplicate chunks
rather than repair anything. Use `overwrite: true` to make re-runs idempotent.
:::

:::caution `overwrite: true` empties the whole table
Not just the documents that activity is about to write. When you feed one `table_name` from several
sources — say web pages plus a repository — set it on the first activity only, or the second will
discard what the first just indexed.
:::

---

## `llama_index.index_web`

Fetches each URL, parses it, and indexes the result. A URL that fails is reported in
`failed_sources` rather than failing the run.

**Input**

The [shared indexing fields](#shared-indexing-input), plus:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `urls` | list[str] | yes | — | URLs to fetch |
| `loader` | enum | no | `"download"` | How a URL becomes text — see the table below |
| `download_dir` | str | no | `null` | Directory the `download` loader writes to |
| `proxy` | str | no | `MOCO_HTTP_PROXY` | Proxy for the fetch |
| `skip_cert_verify` | bool | no | `false` | Skip TLS verification |
| `html_to_text` | bool | no | `true` | Convert HTML to text rather than indexing markup |
| `concurrency` | int | no | `10` | Parallel fetches |

The `loader` decides how a URL becomes text. Only `download` handles non-HTML formats, and the
`simple` and `async` loaders fetch pages themselves, so they do not see moco's proxy settings:

| `loader` | Extracts | Handles PDF/DOCX | Honours `MOCO_HTTP_PROXY` |
| --- | --- | --- | --- |
| `download` *(default)* | The file, parsed by extension | Yes | Yes |
| `trafilatura` | The main article, without navigation boilerplate | No | Yes |
| `readability` | The main article, via a headless browser (sees client-rendered pages) | No | Yes |
| `beautiful_soup` | All page text | No | Yes |
| `simple` | The whole HTML page as text | No | No |
| `async` | The whole HTML page as text, fetched concurrently | No | No |

Keep `download` unless the pages are HTML *and* the boilerplate is hurting retrieval quality — then
reach for `trafilatura`, which indexes the article and leaves the navigation behind.

**Output**

The [shared indexing output](#shared-indexing-output).

**Example**

Indexing a list of URLs:

```yaml
- task_name: index-documents
  activity:
    type: llama_index.index_web
    input:
      urls: "{{ document_urls }}"
      loader: download
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      chunk_size: 1024
      chunk_overlap: 200
      overwrite: true
      metadata:
        collection: "rag-demo"
    options:
      retry_policy:
        timeout_sec: 600
        max_attempts: 1
  output:
    as: index_result
```

---

## `llama_index.index_site`

Takes one seed URL and expands it. `sitemap` reads `sitemap.xml`; `rss` reads a feed (indexing each
entry's **summary**, not the linked article); `whole_site` walks links with a real browser.

**Input**

The [shared indexing fields](#shared-indexing-input), plus:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | str | yes | — | Seed URL — a sitemap, a feed, or a page to crawl from |
| `crawler` | enum | no | `"sitemap"` | `sitemap`, `rss` or `whole_site` |
| `prefix` | str | no | `null` | Only follow URLs under this prefix |
| `max_depth` | int | no | `3` | Crawl depth, `whole_site` only |
| `limit` | int | no | `50` | Maximum pages to index |
| `url_filter` | str | no | `null` | Only index URLs containing this substring |
| `html_to_text` | bool | no | `true` | Convert HTML to text |

**Output**

The [shared indexing output](#shared-indexing-output). These readers do not report which pages they
skipped, so `failed_sources` is always empty.

**Example**

```yaml
- task_name: index-site
  activity:
    type: llama_index.index_site
    input:
      url: "https://docs.example.com/sitemap.xml"
      crawler: sitemap
      limit: 200                      # bound the crawl
      url_filter: "/guides/"          # only sitemap entries containing this
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

:::note `whole_site` needs a browser
The `whole_site` crawler drives Chrome and requires `MOCO_CHROME_DRIVER_PATH` on the worker.
Prefer `sitemap` where the site publishes one.
:::

---

## `llama_index.index_github`

Reads one branch or one `commit_sha`, narrowed by include/exclude filters.

**Input**

The [shared indexing fields](#shared-indexing-input), plus:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `auth` | [GithubAuthInfo](#githubauthinfo) | yes | — | GitHub credentials and endpoint |
| `owner` | str | yes | — | Repository owner |
| `repo` | str | yes | — | Repository name |
| `branch` | str | no | `null` | Branch to read |
| `commit_sha` | str | no | `null` | Exact commit to read instead of a branch |
| `include_directories` | list[str] | no | `[]` | Only these directories |
| `exclude_directories` | list[str] | no | `[]` | Skip these directories |
| `include_extensions` | list[str] | no | `[]` | Only these file extensions |
| `exclude_extensions` | list[str] | no | `[]` | Skip these file extensions |
| `use_parser` | bool | no | `false` | Parse files by type rather than reading them as text |
| `concurrent_requests` | int | no | `5` | Parallel GitHub API requests |
| `timeout_sec` | int | no | `30` | Per-request timeout |

#### GithubAuthInfo

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `token_secret_key` | str | no | `null` | Secret name holding a GitHub token. Without it the reader is anonymous, which reaches public repositories at a much lower rate limit |
| `base_url` | str | no | `"https://api.github.com"` | Use `https://<ghe-host>/api/v3` for GitHub Enterprise |
| `api_version` | str | no | `"2022-11-28"` | GitHub API version header |

**Output**

The [shared indexing output](#shared-indexing-output).

**Example**

Indexing a repository:

```yaml
- task_name: index-repository
  activity:
    type: llama_index.index_github
    input:
      auth:
        token_secret_key: "GH_TOKEN"
        base_url: "https://api.github.com"    # or https://<ghe-host>/api/v3
      owner: "{{ owner }}"
      repo: "{{ repo }}"
      branch: "{{ branch }}"
      include_directories: ["docs"]
      include_extensions: [".md", ".mdx"]
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      overwrite: true
      metadata:
        collection: "rag-github-demo"
    options:
      retry_policy:
        timeout_sec: 1800
        max_attempts: 1
  output:
    as: index_result
```

---

## `llama_index.index_gdrive`

Indexes a Drive folder, a list of file ids, or a Drive query. Takes the same `auth` block as the
[`gdrive.*` activities](./gdrive.md), so define it once and share it. Google-native documents are
exported automatically.

**Input**

The [shared indexing fields](#shared-indexing-input), plus:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `auth` | [DriveAuthInfo](./gdrive.md#driveauthinfo) | yes | — | Service-account credentials |
| `folder_id` | str | no | `null` | Folder to index |
| `file_ids` | list[str] | no | `[]` | Specific files to index |
| `drive_id` | str | no | `null` | Shared drive to search within |
| `query_string` | str | no | `null` | A raw Drive query, e.g. `name contains 'Q1'` |

**Output**

The [shared indexing output](#shared-indexing-output).

**Example**

```yaml
- task_name: index-drive-folder
  activity:
    type: llama_index.index_gdrive
    input:
      auth: "{{ gdrive_auth }}"       # credentials_secret_key -> service-account key JSON
      folder_id: "{{ folder_id }}"    # or file_ids: [...], or query_string: "name contains 'Q1'"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

:::caution `impersonate_user` and `scopes` are rejected here
`index_gdrive` **rejects** them rather than silently ignoring them: the underlying reader always
acts as the service account itself. Either share the folder with the service account, or — if you
need domain-wide delegation — use [`gdrive.download`](./gdrive.md#gdrivedownload) (which does
support it) with `output_format: file`, then `llama_index.index_files` over the downloaded
directory.
:::

---

## `llama_index.index_files`

Parses a directory already on the worker, by file type. Pairs with
[`gdrive.download`](./gdrive.md#gdrivedownload) in `file` mode and with
[`shell.run`](./shell.md).

**Input**

The [shared indexing fields](#shared-indexing-input), plus:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `path` | str | yes | — | Directory to index, resolved under `MOCO_RAG_FILE_DIR` |
| `recursive` | bool | no | `true` | Descend into subdirectories |
| `required_extensions` | list[str] | no | `[]` | Only index files with these extensions |

**Output**

The [shared indexing output](#shared-indexing-output).

**Example**

```yaml
- task_name: index-local-files
  activity:
    type: llama_index.index_files
    input:
      path: "reports/q1"              # relative to MOCO_RAG_FILE_DIR
      required_extensions: [".pdf", ".md"]
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

:::note The path is confined
`path` is resolved under `MOCO_RAG_FILE_DIR` and a path escaping that root is rejected.
:::

---

## `llama_index.index_docs`

:::info Deprecated
`llama_index.index_docs` still works but is deprecated in favour of
[`llama_index.index_web`](#llama_indexindex_web), whose default `loader: download` reproduces its
behaviour exactly. To migrate: rename the activity, rename `document_urls` to `urls`, and read
`indexed_sources` / `failed_sources` instead of `indexed_urls` / `failed_urls`.
:::

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `document_urls` | list[str] | yes | — | URLs to download and index |
| `vectordb_info` | [VectorDbInfo](#vectordbinfo) | yes | — | Where the index lives |
| `embed_model_info` | [EmbedModelInfo](#embedmodelinfo) | yes | — | How chunks are embedded |
| `chunk_size` | int | no | `1024` | Characters per chunk |
| `chunk_overlap` | int | no | `200` | Overlap between chunks |
| `overwrite` | bool | no | `false` | Empty the table before writing |
| `download_dir` | str | no | `null` | Download directory |
| `metadata` | dict | no | `{}` | Attached to every chunk |
| `proxy` | str | no | `null` | Proxy for the download |
| `skip_cert_verify` | bool | no | `false` | Skip TLS verification |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `indexed_urls` | list[str] | URLs indexed |
| `failed_urls` | list[object] | URLs that failed, each `{url, error}` |
| `document_count` | int | Documents loaded |
| `node_count` | int | Chunks written |
| `table_name` | str | Table written to |

**Example**

```yaml
- task_name: index-docs
  activity:
    type: llama_index.index_docs      # prefer llama_index.index_web
    input:
      document_urls: "{{ document_urls }}"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      overwrite: true
  output:
    as: index_result         # -> indexed_urls, failed_urls, ...
```

---

## `llama_index.query`

Runs a semantic search against an index. Two modes:

- **`retrieve`** (default) returns the matching chunks and nothing else, leaving the prompt to you —
  useful when you want to force citations or a specific refusal.
- **`synthesize`** additionally has an LLM write the answer, grounded in those chunks.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | str | yes | — | The question |
| `vectordb_info` | [VectorDbInfo](#vectordbinfo) | yes | — | Index to search |
| `embed_model_info` | [EmbedModelInfo](#embedmodelinfo) | yes | — | Must match the model used to index |
| `top_k` | int | no | `5` | Chunks to retrieve |
| `response_mode` | enum | no | `"retrieve"` | `retrieve` or `synthesize` |
| `filters` | dict | no | `{}` | Exact-match metadata filters, combined with AND |
| `llm_model_info` | [LlmModelInfo](#llmmodelinfo) | no | `null` | Chat model, required in practice for `synthesize` |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `answer` | str | The synthesized answer; empty with `response_mode: retrieve` |
| `nodes` | list[object] | Retrieved chunks, each `{node_id, text, score, metadata}` |
| `node_count` | int | Number of chunks returned |

**Examples**

Retrieve mode:

```yaml
- task_name: retrieve-chunks
  activity:
    type: llama_index.query
    input:
      query: "{{ question }}"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      top_k: "{{ top_k }}"
      response_mode: retrieve
      filters:
        collection: "rag-demo"
    options:
      retry_policy:
        timeout_sec: 120
        max_attempts: 2
  output:
    as: retrieve_result   # -> nodes[{node_id, text, score, metadata}], node_count
```

Synthesize mode, which needs an `llm_model_info` block (its `apikey_secret_key` defaults to the
embedding one, since the two usually share a gateway):

```yaml
- task_name: answer-question
  activity:
    type: llama_index.query
    input:
      query: "{{ question }}"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      llm_model_info:
        model_name: "{{ chat_model }}"
      top_k: 5
      response_mode: synthesize
  output:
    as: rag_answer          # -> answer, nodes, node_count
```

A complete runnable example, contrasting both query modes over the same question, lives in
`moco-examples/activities/llama-index.yaml`.

---

## `llama_index.drop_table`

Drops the table behind an index (`data_<table_name>`), deleting every chunk in it. Dropping a table
that does not exist is not an error, so the activity is safe to retry.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `vectordb_info` | [VectorDbInfo](#vectordbinfo) | yes | — | Index to drop |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `table_name` | str | The logical table name |
| `dropped` | bool | `true` if the table existed and was dropped, `false` if there was nothing to drop |

**Example**

```yaml
- task_name: drop-index
  activity:
    type: llama_index.drop_table
    input:
      vectordb_info:
        table_name: "product_docs"   # connection from MOCO_PGVECTOR_CONN
  output:
    as: drop_result                  # -> table_name, dropped
```

---

## Watching an index run

Indexing a repository or a whole site takes minutes, most of it spent embedding. Run with `--debug`
and the activity reports each phase as it happens, instead of returning one result at the end:

```
$ moco run index-docs.yaml --debug
15:02:11 [llama_index.index_web] load_start  loading web sources
15:02:19 [llama_index.index_web] load_end  loaded 142 documents (3 failed)
15:02:21 [llama_index.index_web] chunk_end  split into 1832 chunks
15:02:21 [llama_index.index_web] write_start  embedding and writing 1832 chunks
15:02:34 [llama_index.index_web] write_progress 4%  embedded 64/1832 chunks
...
15:06:02 [llama_index.index_web] write_end  wrote 1832 chunks to product_docs
```

Running a local YAML file enables debug mode automatically, so the flag is only needed for a
deployed workflow. One progress line appears per `embed_batch_size` chunks — raise it for a quieter
run. Without debug mode nothing is published and the indexing itself is unchanged.
