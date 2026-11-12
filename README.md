# Moco Documentation

This directory contains the Docusaurus-based documentation site for the Moco Workflow Platform.

## Development

### Installation

```bash
npm install
```

### Local Development

```bash
npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Deployment

Using SSH:

```bash
USE_SSH=true npm run deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> npm run deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

## Documentation Structure

```
docs/
├── intro.md                    # Introduction to Moco
├── quick-start.md              # Quick start guide
├── concepts/                   # Core concepts
│   ├── overview.md
│   ├── dual-runtime.md
│   ├── workflowspec.md
│   ├── expressions.md
│   └── activities.md
├── reference/                  # Complete reference
│   ├── workflowspec.md        # Full workflowspec technical docs
│   ├── statements.md
│   ├── expressions.md
│   ├── activities.md
│   ├── state-machines.md
│   └── events.md
├── guides/                     # How-to guides
│   ├── development-setup.md
│   ├── writing-workflows.md
│   ├── creating-activities.md
│   └── testing.md
└── architecture/               # Architecture docs
    ├── overview.md
    ├── workflow-engine.md
    ├── runtime.md
    └── activity-system.md
```

## Contributing

When adding new documentation:

1. Place files in the appropriate directory
2. Update `sidebars.ts` if adding new sections
3. Use clear, descriptive filenames
4. Include code examples where appropriate
5. Add cross-references to related pages

## Building Locally

```bash
npm run build
npm run serve
```

This will build and serve the static site locally for testing.
