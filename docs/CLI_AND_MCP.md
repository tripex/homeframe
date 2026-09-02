# CLI and MCP

Homeframe exposes the same dashboard engine through two primary interfaces:

- **CLI** for humans, shell scripts and automation
- **MCP** for Hermes and other Model Context Protocol agents

Both call `@homeframe/tooling`. The business logic does not live in the CLI or MCP server, so both interfaces operate on the same manifests, validation rules and persistent installation store.

## Installation data

By default Homeframe stores dashboards in:

```text
~/.homeframe/dashboards/
```

For server or container use, set a persistent directory:

```bash
export HOMEFRAME_DATA_DIR=/var/lib/homeframe
```

When running from a cloned source tree, also tell tooling where framework schemas and the card catalog live:

```bash
export HOMEFRAME_ROOT=/path/to/homeframe
```

To let `home snapshot` and `dashboard plan live` find a running Homeframe Runtime without passing `--runtime` every time:

```bash
export HOMEFRAME_RUNTIME_URL=http://127.0.0.1:4173
```

## Build

```bash
npm install
npm run check
```

## CLI

Run the development CLI with:

```bash
node packages/cli/dist/cli.js --help
```

### Inspect the framework

```bash
node packages/cli/dist/cli.js cards list
node packages/cli/dist/cli.js cards show room
node packages/cli/dist/cli.js agent-info
node packages/cli/dist/cli.js installation-info
node packages/cli/dist/cli.js doctor
```

### Read the live home

```bash
node packages/cli/dist/cli.js home snapshot
```

Prints a `HomeSnapshot` built from whichever live source is configured: a Homeframe Runtime
(`--runtime <url>`, `HOMEFRAME_RUNTIME_URL`, or the default `http://127.0.0.1:4173`), or a
direct `HOMEFRAME_HA_URL`/`HOMEFRAME_HA_TOKEN` connection when no runtime is available. Add
`--name <name>` to set the snapshot's `name`, or `--out <file>` to write it to a file instead
of stdout.

### Work with dashboards

```bash
node packages/cli/dist/cli.js dashboard list
node packages/cli/dist/cli.js dashboard show my-home-mobile
node packages/cli/dist/cli.js dashboard validate dashboard.json
node packages/cli/dist/cli.js dashboard save dashboard.json
node packages/cli/dist/cli.js dashboard create wall-tablet "Wall tablet" tablet-10
node packages/cli/dist/cli.js dashboard delete wall-tablet
node packages/cli/dist/cli.js dashboard reflow wall-tablet
```

### Plan several screens at once

```bash
node packages/cli/dist/cli.js dashboard plan \
  examples/home-snapshot.json \
  tablet-10,nest-hub,mobile
```

Pass `live` instead of a file path to plan straight from a live home (see `home snapshot` above):

```bash
node packages/cli/dist/cli.js dashboard plan live tablet-10,nest-hub,mobile
```

Add `--save` to persist the plan:

```bash
node packages/cli/dist/cli.js dashboard plan \
  examples/home-snapshot.json \
  tablet-10,nest-hub,mobile \
  --save
```

### Add cards and bindings

```bash
node packages/cli/dist/cli.js card add \
  my-home-mobile room room-kitchen kitchen

node packages/cli/dist/cli.js binding set \
  my-home-mobile room-kitchen temperature sensor.kitchen_temperature

node packages/cli/dist/cli.js layout set \
  my-home-mobile room-kitchen 0 0 4 3
```

## MCP

Start the stdio server:

```bash
export HOMEFRAME_ROOT=/path/to/homeframe
export HOMEFRAME_DATA_DIR=/var/lib/homeframe
node /path/to/homeframe/packages/mcp/dist/server.js
```

Configure that process as an MCP server in the agent that should manage the installation.

## MCP tools

### Framework and installation discovery

`project_info`
: Explains Homeframe's public model, device profiles and preferred mutation strategy.

`installation_info`
: Shows where the current installation stores dashboards.

`list_cards`
: Returns reusable card contracts with semantic capability requirements and action-risk levels.

`get_card`
: Returns one reusable card contract.

`validate_dashboard`
: Validates a candidate DashboardManifest without saving it.

### Dashboard reads

`list_dashboards`
: Lists saved dashboards.

`get_dashboard`
: Reads one saved dashboard by ID.

### Planning

`snapshot_home`
: Reads the live home through Homeframe Runtime (or a direct Home Assistant connection via
`HOMEFRAME_HA_URL`/`HOMEFRAME_HA_TOKEN`) and returns a `HomeSnapshot` ready for
`plan_dashboards`/`create_planned_dashboards`. Agents that already have a Home Assistant MCP
server may still hand-build the snapshot from that instead.

`plan_dashboards`
: Accepts a neutral semantic HomeSnapshot plus one or more device profiles and returns deterministic proposed manifests without writing anything.

`create_planned_dashboards`
: Runs the same planner and persists the resulting device-specific manifests.

Use `plan_dashboards` first when an agent is creating a new installation so the plan can be reviewed before it is saved.

### Dashboard writes

`create_dashboard`
: Creates an empty dashboard for a target profile.

`save_dashboard`
: Validates and saves a complete manifest. Prefer smaller operations for routine edits.

`add_card`
: Adds a reusable card instance and reflows the grid.

`remove_card`
: Removes a card instance and reflows the grid.

`set_binding`
: Binds a semantic card capability to one or more concrete Home Assistant entity IDs.

`set_card_layout`
: Moves/resizes a card using grid coordinates.

`reflow_dashboard`
: Recalculates a clean deterministic layout.

`delete_dashboard`
: Deletes one saved manifest. It does not modify Home Assistant.

## Why Homeframe MCP is separate from Home Assistant MCP

They have deliberately different jobs:

```text
Home Assistant MCP
  → What exists in this specific home?

Homeframe MCP
  → What can Homeframe render and how do I configure it?
```

The intended agent workflow is:

```text
User request
    ↓
Hermes
    ├── Home Assistant MCP
    │      ↓
    │   areas / devices / entities
    │      ↓
    │   semantic HomeSnapshot
    │
    └── Homeframe MCP
           ↓
       plan_dashboards
           ↓
       create_planned_dashboards
           ↓
       bindings / layout refinements
           ↓
       saved DashboardManifests
           ↓
       Homeframe Runtime
```

Homeframe does not depend on one particular Home Assistant MCP server. The agent translates whatever HA discovery interface it has into Homeframe's small neutral HomeSnapshot shape.

## HomeSnapshot example

```json
{
  "name": "My Home",
  "areas": [
    {
      "id": "living-room",
      "name": "Living room",
      "capabilities": {
        "temperature": ["sensor.living_room_temperature"],
        "humidity": ["sensor.living_room_humidity"],
        "light": ["light.living_room"],
        "climate": ["climate.living_room"]
      }
    }
  ],
  "capabilities": {
    "power": ["sensor.home_power"],
    "vacuum": ["vacuum.robot"]
  }
}
```

Entity IDs are correct in this installation-level object and in DashboardManifest bindings. They remain forbidden in reusable framework components.

## Safety boundary

The Homeframe MCP server and CLI change **dashboard configuration**, not Home Assistant device state.

Card contracts label possible actions as:

- `read`
- `control`
- `security`

Homeframe Runtime can execute `control` actions on behalf of a screen (see below). It refuses every `security` action. Creating or editing a security-status card is not the same as executing a security action.

## Runtime

After dashboards have been created:

```bash
npm start
```

A screen may load an exact dashboard:

```text
http://homeframe-host:4173/?dashboard=my-home-tablet-10
```

Or load `/` and allow the frontend to infer a device profile and select the first matching saved dashboard.

### Card actions

Screens can execute the `control` actions a card declares in `catalog/cards`, for example toggling a room's lights, adjusting a climate target or docking a vacuum. Execution is off by default:

```bash
export HOMEFRAME_ALLOW_CONTROL=true
npm start
```

A screen posts a card action, never a raw service call:

```http
POST /api/actions
{ "dashboardId": "my-home-tablet-10", "instanceId": "room-kitchen", "actionId": "toggle-lights" }
```

The runtime looks up the card in the saved dashboard, checks the action's risk in the card catalog and builds the Home Assistant service call from the card's own bindings. Responses carry a stable `reason`:

| Status | Reason | Meaning |
| --- | --- | --- |
| 200 | | executed; `call` shows the service call that ran |
| 400 | `invalid-request`, `invalid-input`, `no-bound-entities`, `entity-not-bound`, `unsupported-action` | the request cannot be mapped to a service call |
| 403 | `control-disabled` | runtime started without `HOMEFRAME_ALLOW_CONTROL=true` |
| 403 | `security-approval-required` | lock, alarm and garage actions are always refused |
| 404 | `unknown-dashboard`, `unknown-card-instance`, `unknown-action` | nothing matches the saved dashboard or catalog |
| 503 | `home-assistant-unavailable` | runtime is not connected to Home Assistant |

`GET /api/health` reports `controlActions: "enabled" | "disabled"` so a screen can hide controls that would be refused.
