# Hermes integration

Homeframe treats Hermes as a **user of the framework** during normal dashboard work.

Hermes should not edit Homeframe source code to configure a home. It should use Home Assistant MCP to understand the home and Homeframe MCP to create and change dashboard manifests.

Framework development is a separate contributor workflow.

## The two MCP servers

```text
Home Assistant MCP
  → What exists in this concrete home?

Homeframe MCP
  → What can Homeframe render, and how do I create/change dashboards safely?
```

Together:

```text
User request
    ↓
Hermes
    ├── Home Assistant MCP → areas, devices, entities, states
    └── Homeframe MCP      → cards, planner, manifests, bindings, layout
              ↓
       saved dashboards
              ↓
       Homeframe Runtime
              ↓
 tablet / Nest Hub / mobile / desktop
```

## Normal dashboard workflow

When the user says something like:

> Build dashboards for my wall tablet, Nest Hub and phone.

Hermes should:

1. Inspect Home Assistant through its MCP server.
2. Convert the relevant findings into Homeframe's neutral `HomeSnapshot` shape.
3. Call `list_cards` if it needs to understand the available visual building blocks.
4. Call `plan_dashboards` with the desired target profiles.
5. Review the plan for obvious bad bindings or unwanted security surfaces.
6. Call `create_planned_dashboards` to persist the dashboards.
7. Use `set_binding`, `add_card`, `remove_card` and `set_card_layout` for refinements.
8. Call `get_dashboard` to confirm the saved result.
9. Do **not** edit Vue/TypeScript source for ordinary installation changes.

## HomeSnapshot

Homeframe intentionally does not depend on one particular Home Assistant MCP implementation. Hermes supplies a small semantic snapshot:

```json
{
  "name": "My Home",
  "areas": [
    {
      "id": "living-room",
      "name": "Living room",
      "capabilities": {
        "temperature": ["sensor.living_room_temperature"],
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

Concrete Home Assistant entity IDs are correct **inside bindings and HomeSnapshot**. They are not allowed inside reusable framework components.

## Device profiles

Homeframe currently ships these planning profiles:

| Profile | Intended use | Default viewport | Grid |
| --- | --- | --- | --- |
| `tablet-10` | 10-inch wall/tabletop tablet | 1280×800 landscape | 12 columns |
| `nest-hub` | Google Nest Hub-style display | 1024×600 landscape | 8 columns |
| `mobile` | phone | 390×844 portrait | 4 columns |
| `desktop` | browser/large monitor | 1440×900 landscape | 12 columns |
| `custom` | manually specified layout | user-defined | 12 columns by default |

Different devices should normally get separate DashboardManifests. They may reuse the same Home Assistant bindings while showing different cards and layouts.

## Homeframe MCP write tools

The important installation-level tools are:

- `list_dashboards`
- `get_dashboard`
- `plan_dashboards`
- `create_planned_dashboards`
- `create_dashboard`
- `save_dashboard`
- `add_card`
- `remove_card`
- `set_binding`
- `set_card_layout`
- `reflow_dashboard`
- `delete_dashboard`

Framework discovery tools remain available:

- `project_info`
- `installation_info`
- `list_cards`
- `get_card`
- `validate_dashboard`

## Persistence

Dashboard manifests are installation data. By default Homeframe stores them in:

```text
~/.homeframe/dashboards/
```

For a server/container deployment, set a persistent directory explicitly:

```bash
export HOMEFRAME_DATA_DIR=/var/lib/homeframe
```

The framework repository and this data directory should be kept separate.

## Running the MCP server from a cloned repository

```bash
npm install
npm run build

export HOMEFRAME_ROOT=/path/to/homeframe
export HOMEFRAME_DATA_DIR=/var/lib/homeframe
node /path/to/homeframe/packages/mcp/dist/server.js
```

Configure Hermes to start that command as a stdio MCP server.

## Rendering different dashboards

Homeframe Runtime serves saved manifests to the browser.

A device can request an exact dashboard:

```text
http://homeframe-host:4173/?dashboard=my-home-tablet-10
http://homeframe-host:4173/?dashboard=my-home-nest-hub
http://homeframe-host:4173/?dashboard=my-home-mobile
```

Without `?dashboard=...`, the frontend infers a device profile from the viewport and loads the first saved dashboard for that profile.

## Security rule

Homeframe's dashboard MCP changes configuration only. It does not directly unlock doors, disarm alarms or open garages.

Cards declare action risk as `read`, `control` or `security`. Any future execution path for `security` actions must require explicit user approval in the product contract, not merely a prompt instruction.

## When source-code changes are appropriate

Only switch from installation work to framework development when Homeframe genuinely lacks a reusable capability/card needed by the user.

That is a contributor task and should happen on a branch/PR. It is not part of normal dashboard creation.
