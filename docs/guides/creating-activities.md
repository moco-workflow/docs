---
sidebar_label: Creating Custom Activities
sidebar_position: 3
---

# Creating Custom Activities

Activities are the bridge between Moco workflows and the outside world. Moco ships with built-in activities (`http.request`, `builtin.delay`, etc.), but you can add your own for database queries, proprietary APIs, complex calculations, or any other custom logic.

---

## Overview

The activity system has three layers:

1. **`IActivity`** — a single callable that does one thing
2. **`IActivityProvider`** — a collection of activities registered under type names
3. **`IActivityDispatcher`** — routes workflow requests to the right provider (managed by the runtime)

For most custom activities you only need to implement `IActivityProvider`.

---

## Step 1: Implement IActivityProvider

Create a class that inherits from `IActivityProvider` and implements two methods:

```python
from moco.core.workflow.activity.activity_types import (
    ActivityManifest,
    ActivityRequest,
    ActivityResponse,
    IActivityProvider,
)

class MyActivityProvider(IActivityProvider):
    def get_activity_manifests(self) -> list[ActivityManifest]:
        return [
            ActivityManifest(
                activity_type="myapp.greet",
                description="Returns a greeting for a given name",
                version="1.0.0",
            ),
            ActivityManifest(
                activity_type="myapp.calculate_tax",
                description="Calculates tax for a given amount and region",
                version="1.0.0",
            ),
        ]

    async def execute_activity(self, request: ActivityRequest) -> ActivityResponse:
        if request.activity_type == "myapp.greet":
            output = self._greet(request.input_data)
        elif request.activity_type == "myapp.calculate_tax":
            output = self._calculate_tax(request.input_data)
        else:
            raise ValueError(f"Unknown activity: {request.activity_type}")

        return ActivityResponse(
            activity_type=request.activity_type,
            activity_run_id=request.activity_run_id,
            output_data=output,
        )

    def _greet(self, input_data: dict) -> dict:
        name = input_data.get("name", "World")
        return {"message": f"Hello, {name}!"}

    def _calculate_tax(self, input_data: dict) -> dict:
        amount = input_data["amount"]
        region = input_data.get("region", "us")
        rate = {"us": 0.08, "eu": 0.20}.get(region, 0.10)
        return {"tax": round(amount * rate, 2), "total": round(amount * (1 + rate), 2)}
```

### ActivityManifest Fields

| Field | Type | Description |
|-------|------|-------------|
| `activity_type` | string | Unique type identifier used in workflow YAML |
| `description` | string | Human-readable description |
| `version` | string | Semver string (default: `"1.0.0"`) |
| `execute_locally` | bool | Always run locally, bypassing Temporal dispatch |
| `default_retry_policy` | RetryPolicy | Default timeout/retry configuration (default: `RetryPolicy(timeout_sec=60, max_attempts=3)`) |

Set `execute_locally=True` for work short enough that a queue round trip would dominate it, or
when several of your activities must share process-local state. The browser providers
(`selenium.*`, `playwright.*`) do the latter: a session handle only resolves in the process that
created it, so running locally keeps the whole session on one worker. See
[Activities that are already local by default](../concepts/activities.md#activities-that-are-already-local-by-default).

### ActivityRequest Fields

| Field | Type | Description |
|-------|------|-------------|
| `activity_type` | string | Which activity to run |
| `config_data` | Any | Static configuration from the workflow's `config_data` |
| `input_data` | Any | Dynamic input from the workflow's `input_data` |
| `user_info` | UserInfo | Caller identity |
| `sys_info` | SysInfo | Workflow execution context |
| `options` | ActivityRequestOptions | Timeout, retry, cache overrides |

---

## Step 2: Register the Provider

### Using CompositeActivityProvider

Compose multiple providers together:

```python
from moco.core.workflow.activity.providers.composite_activity_provider import CompositeActivityProvider
from moco.core.workflow.activity.providers.builtin import BuiltinActivityProvider

provider = CompositeActivityProvider(
    providers=[
        BuiltinActivityProvider(root_activity_provider=None),
        MyActivityProvider(),
    ]
)
```

### Building the In-Memory Runtime

For development and testing:

```python
from moco.core.workflow.runtime.in_memory_workflow_runtime_builder import InMemoryWorkflowRuntimeBuilder

builder = InMemoryWorkflowRuntimeBuilder(activity_provider=provider)
runtime = await builder.build()
```

### Building the Temporal Runtime

For production deployment, register your provider with the Temporal worker. See [Development Setup](./development-setup.md) for the worker configuration.

---

## Step 3: Use the Activity in a Workflow

Once registered, reference your activity by its `activity_type` string in YAML:

```yaml
wfspec_name: tax-calculator
wfspec_version: 1.0.0

input_data:
  amount:
  region: us

output_name: tax_info

body:
  sequence:
    elements:
      - activity:
          type: myapp.calculate_tax
          input_data:
            amount: "{{ amount }}"
            region: "{{ region }}"
          output_name: tax_info
          retry_policy:
            timeout_sec: 5
```

Use `config_data` for values that are the same every invocation (connection strings, API base URLs, fixed options) and `input_data` for values that vary per execution:

```yaml
- activity:
    type: myapp.database_query
    config_data:
      connection_string: "postgresql://localhost/mydb"
      schema: "public"
    input_data:
      query: "SELECT * FROM orders WHERE id = {{ order_id }}"
    output_name: db_result
```

Inside `execute_activity`, access these as `request.config_data` and `request.input_data`.

---

## Patterns and Best Practices

### Pydantic for Input Validation

Use Pydantic models to validate inputs and get clear error messages:

```python
from pydantic import BaseModel

class CalculateTaxInput(BaseModel):
    amount: float
    region: str = "us"

class MyActivityProvider(IActivityProvider):
    async def execute_activity(self, request: ActivityRequest) -> ActivityResponse:
        if request.activity_type == "myapp.calculate_tax":
            inp = CalculateTaxInput.model_validate(request.input_data)
            # inp.amount and inp.region are typed and validated
            ...
```

### Async for I/O

`execute_activity` is `async` — use `await` for any I/O:

```python
import httpx

async def _fetch_data(self, url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
```

### Idempotency

Activities may be retried on failure (transient errors, timeouts). Design them to be safe to run multiple times with the same inputs:

- For writes: use upsert semantics or check-then-write patterns
- For HTTP calls: prefer idempotent methods (GET, PUT) or include an idempotency key

### Separating Static Config from Dynamic Input

Store connection details and fixed options in `config_data` (evaluated once at workflow start) and per-call parameters in `input_data` (evaluated each time the activity runs):

```python
async def execute_activity(self, request: ActivityRequest) -> ActivityResponse:
    config = request.config_data or {}
    base_url = config.get("base_url", "https://api.default.com")

    inp = request.input_data or {}
    endpoint = inp.get("endpoint", "/data")

    result = await self._call_api(f"{base_url}{endpoint}")
    ...
```

---

## Grouping Activities with IActivity

For providers with many activities, you can implement `IActivity` per activity and compose them:

```python
from moco.core.workflow.activity.activity_types import IActivity, ActivityManifest

class GreetActivity(IActivity):
    @property
    def manifest(self) -> ActivityManifest:
        return ActivityManifest(
            activity_type="myapp.greet",
            description="Returns a greeting",
        )

    async def execute(self, execute_context, config_data, input_data) -> dict:
        name = (input_data or {}).get("name", "World")
        return {"message": f"Hello, {name}!"}
```

Then register it via `CompositeActivityProvider.add_activity(GreetActivity())`.

---

## Next Steps

- [Testing Workflows](./testing.md) — how to test workflows and activities
- [Activity System Concepts](../concepts/activities.md) — built-in activities and configuration options
- [Writing Workflows](./writing-workflows.md) — how to use activities in workflow specs
