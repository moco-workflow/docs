---
sidebar_label: Playwright (Browser)
---

# Playwright Activities

Twenty-six activities drive a real browser: open a session, navigate, interact with elements, read
the page, and close it. Use them when a site needs JavaScript or a login flow, where
[`http.request`](./http.md) would only see the unrendered HTML.

[Selenium activities](./selenium.md) do the same job with a different engine. Prefer Playwright
unless you specifically need Selenium: it needs no separate driver binary and its waiting is more
reliable.

## Sessions

`playwright.browser.create` returns a **`session_id`**; every other activity takes it. A session is
a live browser owned by one worker process, so the whole script — from `browser.create` to
`browser.close` — must stay on that worker.

**This is why every activity on this page runs locally by default**
(`options.execute_locally: true`). A local activity always runs in the calling workflow's own
worker, which pins the session.

```yaml
- task_name: open-browser
  activity:
    type: playwright.browser.create   # local by default
    input:
      browser_type: chromium
  output:
    as: session

- task_name: browse
  tasks:
    - task_name: open-page
      activity:
        type: playwright.page.goto   # same worker as open-browser
        input:
          session_id: "{{ session['session_id'] }}"
          url: https://example.com
    # ... more page and element tasks
  on_error:
    do:   # runs on failure; the error still propagates
      task_name: close-after-error
      activity:
        type: playwright.browser.close
        input:
          session_id: "{{ session['session_id'] }}"

- task_name: close-browser
  activity:
    type: playwright.browser.close
    input:
      session_id: "{{ session['session_id'] }}"
```

:::caution Do not set `options.execute_locally: false`
The workflow will still validate and start, but the session is no longer pinned to one worker and
any task after `browser.create` can fail with an unknown session.
:::

:::caution Always close the session
Sessions are per user and expire on a timer, but the per-user cap means leaked sessions eventually
make `browser.create` fail. Close it in an `on_error.do` handler too, as above, so a failure
mid-script still releases the browser. A worker restart destroys every live session; there is no
reconnection.
:::

## Setup

No credentials. The worker needs the `playwright` package **and its browser binaries** installed in
the image.

| Variable | Default | Effect |
| --- | --- | --- |
| `MOCO_PLAYWRIGHT_SESSION_TIMEOUT_SEC` | `3600` | Idle time before a session is reaped |
| `MOCO_PLAYWRIGHT_MAX_SESSIONS_PER_USER` | `5` | Concurrent sessions one user may hold |
| `MOCO_HTTP_PROXY`, `MOCO_HTTP_PROXY_BYPASS` | — | Fall back into browser launch options |
| `MOCO_IGNORE_HTTPS_ERRORS` | — | Default for `ignore_https_errors` |

## Defaults

60 s timeout for `browser.create`, `page.goto`, `page.wait_for_selector` and `page.wait_for_url`;
300 s for `page.wait_for_timeout`; 30 s for everything else. All default to 3 attempts and to local
execution.

:::caution Retries replay interactions
`max_attempts` is 3 throughout, so a `element.click` that times out after the click landed will be
clicked again. Set `max_attempts: 1` on any interaction that is not safe to repeat — submitting a
form, confirming a purchase.
:::

## Common input fields

Most activities share these. They are not repeated in every table below.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | The session from `browser.create` |
| `selector` | str | yes | — | Element selector |
| `selector_type` | enum | no | `"css"` | `css`, `xpath`, `text` or `role` |
| `timeout` | int | no | `30000` | Timeout in **milliseconds** |

---

## Browser lifecycle

### `playwright.browser.create`

Launches a browser and returns a session id.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `browser_type` | enum | no | `"chromium"` | `chromium`, `firefox` or `webkit` |
| `options` | [BrowserOptions](#browseroptions) | no | `null` | Launch options |

#### BrowserOptions

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `headless` | bool | no | `true` | Run without a visible window |
| `viewport_width` | int | no | `1920` | Viewport width in pixels |
| `viewport_height` | int | no | `1080` | Viewport height in pixels |
| `slow_mo` | int | no | `null` | Slow every operation by this many milliseconds, for debugging |
| `proxy` | dict[str, str] | no | `MOCO_HTTP_PROXY` | `{server, bypass}`, e.g. `{'server': 'http://proxy:8080', 'bypass': 'localhost;*.local'}` |
| `args` | list[str] | no | `null` | Extra browser command-line arguments |
| `ignore_https_errors` | bool | no | `MOCO_IGNORE_HTTPS_ERRORS` | Accept self-signed certificates |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `session_id` | str | Pass this to every other activity |
| `browser_type` | str | The browser launched |
| `created_at` | str | Creation timestamp |

**Example**

```yaml
- task_name: open-browser
  activity:
    type: playwright.browser.create
    input:
      browser_type: chromium
      options:
        headless: true
        viewport_width: 1440
        viewport_height: 900
  output:
    as: session
```

### `playwright.browser.close`

Closes the session and frees the browser.

**Input** — `session_id`.

**Output** — `{success: bool}`.

```yaml
- task_name: close-browser
  activity:
    type: playwright.browser.close
    input:
      session_id: "{{ session['session_id'] }}"
```

### `playwright.browser.get_info`

Reports on a live session.

**Input** — `session_id`.

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `browser_type` | str | The browser in use |
| `created_at` | str | When the session was created |
| `last_accessed` | str | When it was last used |
| `session_count` | int | Sessions this user currently holds |

---

## Navigation

### `playwright.page.goto`

Navigates to a URL.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | Session |
| `url` | str | yes | — | URL to open |
| `timeout` | int | no | `30000` | Timeout in milliseconds |
| `wait_until` | enum | no | `"load"` | `load`, `domcontentloaded` or `networkidle` |

**Output** — `{url: str}`, the URL actually landed on after redirects.

```yaml
- task_name: open-login
  activity:
    type: playwright.page.goto
    input:
      session_id: "{{ session['session_id'] }}"
      url: "https://app.example.com/login"
      wait_until: networkidle
  output:
    as: landed
```

### `playwright.page.back` / `playwright.page.forward` / `playwright.page.reload`

Move through history, or reload the current page.

**Input** — `session_id`, `timeout` (default `30000`), `wait_until` (default `load`).

**Output** — `{url: str}`.

---

## Element interaction

All four take the [common fields](#common-input-fields).

### `playwright.element.click`

Clicks the matched element. **Output** — `{status: str}`.

```yaml
- task_name: submit-login
  activity:
    type: playwright.element.click
    input:
      session_id: "{{ session['session_id'] }}"
      selector: "button[type=submit]"
    options:
      retry_policy:
        max_attempts: 1        # submitting twice would be wrong
```

### `playwright.element.fill`

Sets an input's value in one operation — faster and more reliable than typing.

**Input** — common fields plus `text` (str, required). **Output** — `{status: str}`.

```yaml
- activity:
    type: playwright.element.fill
    input:
      session_id: "{{ session['session_id'] }}"
      selector: "#username"
      text: "{{ username }}"
```

### `playwright.element.type`

Types text key by key, firing keyboard events. Use it where a field reacts to keystrokes —
autocomplete, input masks.

**Input** — common fields, plus `text` (str, required) and `delay` (int, default `0`, milliseconds
between key presses). **Output** — `{status: str}`.

### `playwright.element.clear`

Empties an input. **Input** — common fields. **Output** — `{status: str}`.

### `playwright.element.select`

Chooses a `<select>` option by value, label or index — supply exactly one.

**Input** — common fields, plus `value` (str), `label` (str), `index` (int), all optional.
**Output** — `{status: str}`.

```yaml
- activity:
    type: playwright.element.select
    input:
      session_id: "{{ session['session_id'] }}"
      selector: "#region"
      label: "Europe"
```

---

## Reading elements

### `playwright.element.get_text`

**Input** — common fields. **Output** — `{text: str}`.

```yaml
- task_name: read-total
  activity:
    type: playwright.element.get_text
    input:
      session_id: "{{ session['session_id'] }}"
      selector: ".order-total"
  output:
    set:
      - order_total: "{{ float(_['text'].strip('$')) }}"
```

### `playwright.element.get_attribute`

**Input** — common fields, plus `attribute` (str, required). **Output** — `{value: str \| null}`.

### `playwright.element.is_visible`

**Input** — `session_id`, `selector`, `selector_type`. **Output** — `{visible: bool}`.

### `playwright.element.is_enabled`

**Input** — common fields. **Output** — `{enabled: bool}`.

### `playwright.element.query_selector`

Checks whether one element matches. **Input** — common fields. **Output** — `{found: bool}`.

### `playwright.element.query_selector_all`

Counts matching elements. **Input** — `session_id`, `selector`, `selector_type`.
**Output** — `{count: int}`.

```yaml
- task_name: count-rows
  activity:
    type: playwright.element.query_selector_all
    input:
      session_id: "{{ session['session_id'] }}"
      selector: "table.results tbody tr"
  output:
    as: rows        # -> count
```

---

## Page operations

### `playwright.page.content`

Returns the rendered HTML. **Input** — `session_id`. **Output** — `{content: str}`.

This is the usual hand-off point: render with Playwright, then parse the HTML elsewhere.

### `playwright.page.title`

**Input** — `session_id`. **Output** — `{title: str}`.

### `playwright.page.url`

**Input** — `session_id`. **Output** — `{url: str}`.

### `playwright.page.screenshot`

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | Session |
| `format` | enum | no | `"png"` | `png` or `jpeg` |
| `full_page` | bool | no | `false` | Capture the whole scrollable page |
| `quality` | int | no | `null` | JPEG quality, 0–100; ignored for PNG |

**Output** — `{screenshot: str, format: str}`, the image base64-encoded.

```yaml
- task_name: capture
  activity:
    type: playwright.page.screenshot
    input:
      session_id: "{{ session['session_id'] }}"
      format: png
      full_page: true
  output:
    as: shot        # -> screenshot (base64), format
```

:::note Screenshots are large
The base64 image travels through workflow context and history. Capture the smallest region you need,
or upload it straight out with [`gdrive.upload`](./gdrive.md#gdriveupload).
:::

### `playwright.page.evaluate`

Runs JavaScript in the page and returns its result.

**Input** — `session_id`, `script` (str, required). **Output** — `{result: any}`.

```yaml
- task_name: read-app-state
  activity:
    type: playwright.page.evaluate
    input:
      session_id: "{{ session['session_id'] }}"
      script: "() => window.__APP_STATE__.orders.length"
  output:
    as: order_count   # -> result
```

---

## Waiting

### `playwright.page.wait_for_selector`

Waits for an element to reach a state.

**Input** — common fields, plus `state` (enum, default `"visible"`: `attached`, `detached`,
`visible` or `hidden`). **Output** — `{status: str}`.

```yaml
- task_name: wait-for-results
  activity:
    type: playwright.page.wait_for_selector
    input:
      session_id: "{{ session['session_id'] }}"
      selector: "table.results"
      state: visible
      timeout: 15000
```

### `playwright.page.wait_for_url`

Waits until the page URL matches a pattern — how you wait out a redirect after a login.

**Input** — `session_id`, `url` (str, required; string or regex), `timeout` (default `30000`).
**Output** — `{url: str}`.

### `playwright.page.wait_for_timeout`

Waits a fixed number of milliseconds.

**Input** — `session_id`, `timeout` (int, required, milliseconds). **Output** — `{status: str}`.

:::note Prefer waiting for a condition
A fixed wait is either too short on a slow day or wasted time on a fast one. Use
`wait_for_selector` or `wait_for_url` where you can.
:::
