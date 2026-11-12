---
sidebar_position: 1
---

# Development Setup

This guide will help you set up your development environment for working with Moco.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.10 or higher**
- **Node.js 18 or higher** (for CLI tools)
- **Git**
- **Docker and Docker Compose** (for Temporal.io runtime)

## Repository Setup

### 1. Clone the Repository

```bash
git clone https://github.com/moco-workflow/moco.git
cd moco-workspace
```

### 2. Initialize Git Submodules

The Moco workspace uses git submodules for some components:

```bash
git submodule update --init --recursive
```

This will initialize:
- `moco-db/` - Database schemas and migrations

## Python Environment

### 1. Virtual Environment

A shared virtual environment is located at `.venv/` in the workspace root:

```bash
# If .venv doesn't exist, create it
python3 -m venv .venv

# Activate it (Linux/macOS)
source .venv/bin/activate

# Activate it (Windows)
.venv\Scripts\activate
```

**Important**: Always use `.venv/bin/python` for all Python commands throughout the workspace.

### 2. Install Dependencies

Install dependencies for each Python project:

```bash
# moco-core (workflow engine)
.venv/bin/pip install -r moco-core/requirements.txt
.venv/bin/pip install -r moco-core/requirements-dev.txt
.venv/bin/pip install -e moco-core/

# moco-server (FastMCP HTTP API)
.venv/bin/pip install -r moco-server/requirements.txt
.venv/bin/pip install -e moco-server/

# moco-worker (Temporal.io worker)
.venv/bin/pip install -r moco-worker/requirements.txt
.venv/bin/pip install -e moco-worker/

# moco-activities (activity providers)
.venv/bin/pip install -r moco-activities/requirements.txt
.venv/bin/pip install -e moco-activities/
```

### 3. Verify Installation

```bash
.venv/bin/python -c "from moco.core.workflow.engine import WorkflowEngine; print('Moco core installed successfully!')"
```

## TypeScript Tools (Optional)

### 1. Install Dependencies

```bash
cd moco-tools
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Create Distribution Packages

```bash
npm run pack
```

This creates:
- `moco-lib-0.1.0.tgz` - Shared library
- `moco-cli-0.1.0.tgz` - CLI tool
- `moco-vscode-0.1.0.tgz` - VSCode extension

### 4. Install CLI Globally (Optional)

```bash
npm i -g moco-lib-0.1.0.tgz moco-cli-0.1.0.tgz
```

Now you can use the `moco` command anywhere:

```bash
moco --version
moco run workflow.yaml --input '{"key": "value"}'
```

## Infrastructure Setup

For Temporal.io runtime and other services:

### 1. Start Services

```bash
docker compose -f docker-compose-env.yml up -d
```

This starts:
- **Temporal Server**
  - Web UI: http://localhost:8234
  - gRPC: localhost:7234
- **PostgreSQL**: localhost:5431
- **Kafka**: localhost:9292 (insecure), localhost:9293 (IAM)
  - Kafka UI: http://localhost:8290
- **RabbitMQ**
  - Management UI: http://localhost:3001
  - AMQP: localhost:5672

### 2. Verify Services

```bash
# Check running containers
docker compose -f docker-compose-env.yml ps

# View logs
docker compose -f docker-compose-env.yml logs -f
```

### 3. Stop Services

```bash
docker compose -f docker-compose-env.yml down
```

To remove volumes as well:

```bash
docker compose -f docker-compose-env.yml down -v
```

## IDE Setup

### VS Code

The project includes a multi-folder workspace configuration. Open `moco.code-workspace` in VS Code:

```bash
code moco.code-workspace
```

This provides:
- Proper Python/TypeScript settings for each subproject
- Ruff as default Python formatter
- Auto-organize imports on save
- Consistent tab size (4 spaces for Python)

Recommended VS Code extensions:
- Python
- Pylance
- Ruff
- ESLint
- Prettier
- YAML

### PyCharm

1. Open the `moco-workspace` directory
2. Configure Python interpreter to use `.venv/bin/python`
3. Mark `moco-core/src`, `moco-server/src`, etc. as source roots
4. Enable Ruff for formatting

## Environment Configuration

### For Development (In-Memory Runtime)

Create `.env.local` in project directories (e.g., `moco-core/tests/.env.local`):

```env
# No MOCO_RUNTIME_TYPE means in-memory runtime
LOG_LEVEL=DEBUG
```

### For Temporal Runtime

Create `.env.local`:

```env
MOCO_RUNTIME_TYPE=temporal
MOCO_TEMPORALIO_ENDPOINT=localhost:7234
MOCO_TEMPORALIO_NAMESPACE=moco
MOCO_TEMPORALIO_TASK_QUEUE=default
LOG_LEVEL=INFO
```

### Environment File Priority

1. `.env.local` (highest priority, gitignored)
2. `.env.devcontainer` (devcontainer environment)
3. `.env.wsl` (WSL environment)
4. Default values in code

## Running Tests

### Unit Tests

```bash
# Run all unit tests
.venv/bin/pytest moco-core/tests/unit/

# Run specific test file
.venv/bin/pytest moco-core/tests/unit/test_workflow_engine.py

# Run specific test function
.venv/bin/pytest moco-core/tests/unit/test_workflow_engine.py::test_basic_transform
```

### Integration Tests

Integration tests require running infrastructure:

```bash
# Start services
docker compose -f docker-compose-env.yml up -d

# Run integration tests
.venv/bin/pytest moco-core/tests/integration/ -m integration

# Stop services
docker compose -f docker-compose-env.yml down
```

### Test Coverage

```bash
# Generate coverage report
.venv/bin/pytest --cov=moco.core --cov-report=html moco-core/

# View report
open htmlcov/index.html
```

## Code Quality

### Type Checking

```bash
# Type check with mypy
.venv/bin/mypy moco-core/src/
```

### Linting

```bash
# Lint with ruff
.venv/bin/ruff check moco-core/src/

# Lint with pylint
.venv/bin/pylint moco-core/src/
```

### Formatting

```bash
# Format with ruff
.venv/bin/ruff format moco-core/src/

# Check formatting
.venv/bin/ruff format --check moco-core/src/
```

## Running the API Server

```bash
# From workspace root
.venv/bin/uvicorn moco_server.main:app --reload
```

API will be available at http://localhost:8000

## Running a Temporal Worker

```bash
# Start worker
.venv/bin/python -m moco_worker.main
```

The worker will:
1. Connect to Temporal server
2. Register workflows and activities
3. Start polling for tasks
4. Execute workflows and activities

## Troubleshooting

### Python Import Errors

If you get import errors, ensure you've installed packages in editable mode:

```bash
.venv/bin/pip install -e moco-core/
```

### Temporal Connection Issues

Check that Temporal is running:

```bash
docker compose -f docker-compose-env.yml ps
```

Verify endpoint:

```bash
# Test connection
temporal workflow list --address localhost:7234
```

### Port Conflicts

If ports are already in use, edit `docker-compose-env.yml` to use different ports.

### Submodule Issues

If submodules aren't initialized:

```bash
git submodule update --init --recursive
```

## Next Steps

- [Writing Workflows](./writing-workflows.md)
- [Creating Custom Activities](./creating-activities.md)
- [Testing Workflows](./testing.md)
