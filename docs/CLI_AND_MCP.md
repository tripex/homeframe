# CLI and MCP

Homeframe exposes the same framework operations in two ways:

- **CLI** for humans, shell scripts and coding agents
- **MCP** for agents that support Model Context Protocol

Both use `@homeframe/tooling` underneath. This is intentional: there should be one implementation of Homeframe operations and multiple interfaces to it.

## CLI

After building the repository:

```bash
npm run build
```

Examples:

```bash
node packages/cli/dist/cli.js cards list
node packages/cli/dist/cli.js cards show room
node packages/cli/dist/cli.js dashboard validate examples/demo-dashboard.json
node packages/cli/dist/cli.js doctor
node packages/cli/dist/cli.js agent-info
```

The eventual published package will expose the shorter `homeframe` executable.

## MCP

The MCP package exposes Homeframe over stdio:

```bash
npm run build
node packages/mcp/dist/server.js
```

Current tools:

### `project_info`

Explains the framework architecture and where an agent should start.

### `list_cards`

Returns the reusable card catalog including capability requirements and action risk levels.

### `get_card`

Returns one complete card manifest.

### `validate_dashboard`

Validates a candidate dashboard manifest before the agent saves or proposes it.

## Why Homeframe MCP is separate from Home Assistant MCP

They answer different questions.

```text
Home Assistant MCP
  → What exists in this home?

Homeframe MCP
  → What can Homeframe build, and what is valid?
```

An agent such as Hermes can use both:

```text
User request
    ↓
Hermes
    ├── Home Assistant MCP → discovers real areas/entities/devices
    └── Homeframe MCP      → discovers cards/contracts/validation
              ↓
       DashboardManifest
              ↓
          Homeframe
```

## Planned write tools

The first MCP tools are intentionally read/validate-only. Future write-capable tools will be added around explicit framework operations such as:

- `plan_dashboard`
- `create_dashboard`
- `add_card`
- `update_card_binding`
- `remove_card`

Those tools should modify declarative manifests rather than arbitrary source files whenever possible.

Framework-code generation remains a coding-agent workflow and should happen only when no existing card/capability can satisfy the request.
