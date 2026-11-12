---
sidebar_label: Selenium (Browser)
---

# Selenium Activities

Twenty-three activities drive a Chrome browser through WebDriver: open a session, navigate,
interact with elements, read the page, and close it.

[Playwright activities](./playwright.md) cover the same ground with a different engine.
**Prefer Playwright** unless you specifically need Selenium — it needs no separate driver binary and
its waiting is more reliable. Use Selenium where an existing WebDriver setup or a Selenium-only
capability requires it.

The two providers differ in more than names: Selenium takes an **object** selector
(`{type, value}`) where Playwright takes a string plus `selector_type`, and its timeouts are in
**seconds** where Playwright's are in milliseconds.

## Sessions

`selenium.browser.create` returns a **`session_id`**; every other activity takes it. A session is a
live browser owned by one worker process, so the whole script — from `browser.create` to
`browser.close` — must stay on that worker.

**This is why every activity on this page runs locally by default**
(`options.execute_locally: true`). A local activity always runs in the calling workflow's own
worker, which pins the session.

```yaml
- task_name: open-browser
  activity:
    type: selenium.browser.create   # local by default
    input:
      browser_type: chrome
  output:
    as: session

- task_name: browse
  tasks:
    - task_name: open-page
      activity:
        type: selenium.nav.goto   # same worker as open-browser
        input:
          session_id: "{{ session['session_id'] }}"
          url: https://example.com
    # ... more page and element tasks
  on_error:
    do:   # runs on failure; the error still propagates
      task_name: close-after-error
      activity:
        type: selenium.browser.close
        input:
          session_id: "{{ session['session_id'] }}"

- task_name: close-browser
  activity:
    type: selenium.browser.close
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

No credentials. The worker needs **Chrome or Chromium plus a matching chromedriver** — the heavier
of the two browser providers to provision.

| Variable | Default | Effect |
| --- | --- | --- |
| `MOCO_CHROME_PATH` | — | Path to the Chrome binary |
| `MOCO_CHROME_DRIVER_PATH` | — | Path to chromedriver |
| `MOCO_SELENIUM_SESSION_TIMEOUT_SEC` | `3600` | Idle time before a session is reaped |
| `MOCO_SELENIUM_MAX_SESSIONS_PER_USER` | `5` | Concurrent sessions one user may hold |
| `MOCO_SELENIUM_SCREENSHOT_DIR` | — | Where `page.screenshot` writes in `file` mode |
| `MOCO_HTTP_PROXY`, `MOCO_HTTP_PROXY_BYPASS` | — | Defaults for the browser's proxy settings |

## Defaults

60 s timeout for `browser.create`, `nav.goto` and `wait.element`; 300 s for `wait.time`; 30 s for
everything else. All default to 3 attempts and to local execution.

:::caution Retries replay interactions
`max_attempts` is 3 throughout, so an `element.click` that times out after the click landed will be
clicked again. Set `max_attempts: 1` on any interaction that is not safe to repeat.
:::

## Common input fields

Most activities take these. They are not repeated in every table below.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | The session from `browser.create` |
| `selector` | [ElementSelector](#elementselector) | yes | — | Which element to act on |
| `wait_timeout` | int | no | `10` | Seconds to wait for the element |

#### ElementSelector

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | str | yes | — | The selector itself |
| `type` | enum | no | `"css"` | `css`, `xpath`, `id`, `name`, `class_name` or `tag_name` |

```yaml
selector:
  type: css
  value: "button.submit"
```

---

## Browser lifecycle

### `selenium.browser.create`

Launches Chrome and returns a session id.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `browser_type` | str | no | `"chrome"` | Browser to launch; only `chrome` is supported |
| `options` | [BrowserOptions](#browseroptions) | no | `null` | Launch options |

#### BrowserOptions

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `headless` | bool | no | `true` | Run without a visible window |
| `window_width` | int | no | `1920` | Window width |
| `window_height` | int | no | `1080` | Window height |
| `user_agent` | str | no | `null` | Custom user agent |
| `disable_gpu` | bool | no | `true` | Disable GPU acceleration |
| `disable_dev_shm` | bool | no | `true` | Disable `/dev/shm`, needed in many containers |
| `no_sandbox` | bool | no | `false` | Disable the Chrome sandbox, required in some Docker environments |
| `proxy` | str | no | `MOCO_HTTP_PROXY` | Proxy URL, e.g. `http://proxy:8080` |
| `proxy_bypass_list` | str | no | `MOCO_HTTP_PROXY_BYPASS` | Semicolon-separated bypass patterns, e.g. `localhost;127.0.0.1;*.local` |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `session_id` | str | Pass this to every other activity |
| `browser_type` | str | The browser launched |

**Example**

```yaml
- task_name: open-browser
  activity:
    type: selenium.browser.create
    input:
      browser_type: chrome
      options:
        headless: true
        window_width: 1440
        window_height: 900
  output:
    as: session
```

### `selenium.browser.close`

Closes the session.

**Input** — `session_id`. **Output** — `{success: bool}`.

```yaml
- task_name: close-browser
  activity:
    type: selenium.browser.close
    input:
      session_id: "{{ session['session_id'] }}"
```

### `selenium.browser.get_info`

**Input** — `session_id`.

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `browser_type` | str | The browser in use |
| `created_at` | str | When the session was created |
| `last_accessed` | str | When it was last used |
| `window_handles` | list[str] | Open window/tab handles |

---

## Navigation

### `selenium.nav.goto`

Navigates to a URL.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | Session |
| `url` | str | yes | — | URL to open |
| `timeout` | int | no | `30` | Navigation timeout in **seconds** |

**Output** — `{current_url: str, status: str}`.

```yaml
- task_name: open-login
  activity:
    type: selenium.nav.goto
    input:
      session_id: "{{ session['session_id'] }}"
      url: "https://app.example.com/login"
      timeout: 30
  output:
    as: landed
```

### `selenium.nav.back` / `selenium.nav.forward` / `selenium.nav.refresh`

Move through history, or reload the current page.

**Input** — `session_id`. **Output** — `{current_url: str}`.

---

## Element interaction

### `selenium.element.click`

Clicks the matched element.

**Input** — common fields, plus `scroll_into_view` (bool, default `true`).
**Output** — `{success: bool}`.

```yaml
- task_name: submit-login
  activity:
    type: selenium.element.click
    input:
      session_id: "{{ session['session_id'] }}"
      selector:
        type: css
        value: "button[type=submit]"
    options:
      retry_policy:
        max_attempts: 1        # submitting twice would be wrong
```

### `selenium.element.type`

Types text into an element, clearing it first by default.

**Input** — common fields, plus `text` (str, required) and `clear_first` (bool, default `true`).
**Output** — `{success: bool}`.

```yaml
- activity:
    type: selenium.element.type
    input:
      session_id: "{{ session['session_id'] }}"
      selector:
        type: id
        value: "username"
      text: "{{ username }}"
```

### `selenium.element.clear`

Empties an input. **Input** — common fields. **Output** — `{success: bool}`.

---

## Reading elements

### `selenium.element.find`

Locates one element or counts several.

**Input** — common fields, plus `multiple` (bool, default `false`).

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `found` | bool | Whether anything matched |
| `element_count` | int | Number of matches |
| `elements` | list | Matched element descriptors |

```yaml
- task_name: count-rows
  activity:
    type: selenium.element.find
    input:
      session_id: "{{ session['session_id'] }}"
      selector:
        type: css
        value: "table.results tbody tr"
      multiple: true
  output:
    as: rows        # -> found, element_count, elements
```

### `selenium.element.get_text`

**Input** — common fields. **Output** — `{text: str}`.

```yaml
- task_name: read-total
  activity:
    type: selenium.element.get_text
    input:
      session_id: "{{ session['session_id'] }}"
      selector:
        type: css
        value: ".order-total"
  output:
    as: total       # -> text
```

### `selenium.element.get_attribute`

Reads an HTML attribute as written in the markup.

**Input** — common fields, plus `attribute_name` (str, required).
**Output** — `{value: str \| null}`.

### `selenium.element.get_property`

Reads a live DOM property, which can differ from the attribute — `value` on an input the user has
typed into, for instance.

**Input** — common fields, plus `property_name` (str, required). **Output** — `{value: any}`.

### `selenium.element.is_visible`

**Input** — common fields. **Output** — `{visible: bool}`.

### `selenium.element.is_enabled`

**Input** — common fields. **Output** — `{enabled: bool}`.

---

## Page operations

### `selenium.page.get_html`

Returns the rendered page source. **Input** — `session_id`. **Output** — `{html: str}`.

This is the usual hand-off point: render with Selenium, then parse the HTML elsewhere.

### `selenium.page.get_title`

**Input** — `session_id`. **Output** — `{title: str}`.

### `selenium.page.get_url`

**Input** — `session_id`. **Output** — `{url: str}`.

### `selenium.page.screenshot`

Captures the page, or one element.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | Session |
| `element_selector` | [ElementSelector](#elementselector) | no | `null` | Capture just this element; omit for the whole page |
| `output_format` | enum | no | `"base64"` | `base64` returns the image inline; `file` writes it to disk |
| `file_path` | str | no | `null` | Destination path, required with `output_format: file` |

**Output** — `{data: str, format: str}` — the base64 image, or the path written to.

```yaml
- task_name: capture
  activity:
    type: selenium.page.screenshot
    input:
      session_id: "{{ session['session_id'] }}"
      output_format: base64
  output:
    as: shot        # -> data, format
```

:::note Prefer `file` for large captures
A base64 image travels through workflow context and history. Writing to `MOCO_SELENIUM_SCREENSHOT_DIR`
keeps it out, at the cost of the file only existing on that worker.
:::

### `selenium.page.execute_script`

Runs JavaScript in the page and returns its result.

**Input** — `session_id`, `script` (str, required), `args` (list, optional, passed to the script).
**Output** — `{result: any}`.

```yaml
- task_name: read-app-state
  activity:
    type: selenium.page.execute_script
    input:
      session_id: "{{ session['session_id'] }}"
      script: "return window.__APP_STATE__.orders.length;"
  output:
    as: order_count   # -> result
```

---

## Waiting

### `selenium.wait.element`

Waits for an element to reach a condition.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `session_id` | str | yes | — | Session |
| `selector` | [ElementSelector](#elementselector) | yes | — | Element to wait for |
| `condition` | enum | no | `"present"` | `present` (in the DOM), `visible`, or `clickable` (visible and enabled) |
| `timeout` | int | no | `30` | Wait timeout in **seconds** |

**Output** — `{success: bool, waited_seconds: number}`.

```yaml
- task_name: wait-for-results
  activity:
    type: selenium.wait.element
    input:
      session_id: "{{ session['session_id'] }}"
      selector:
        type: css
        value: "table.results"
      condition: visible
      timeout: 15
```

### `selenium.wait.time`

Waits a fixed number of seconds.

**Input** — `session_id`, `seconds` (number, required). **Output** — `{success: bool}`.

:::note Prefer waiting for a condition
A fixed wait is either too short on a slow day or wasted time on a fast one. Use `wait.element`
where you can.
:::
