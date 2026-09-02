# Homeframe

**A beautiful, adaptive and AI-first dashboard framework for Home Assistant.**

Homeframe is an open-source frontend and dashboard framework for Home Assistant with a calm, glass-inspired visual language. Home Assistant remains the automation backend and source of truth; Homeframe turns raw entities into reusable semantic capabilities and declarative dashboards that humans and AI agents can safely configure.

> **Project status:** `v0.2` development preview. Homeframe can now persist, plan and render multiple device-specific dashboards and exposes write-capable CLI/MCP operations. It is ready for real installation testing, but production authentication, packaging and broader device/card coverage are still in progress.

## The idea

A reusable card should not care whether one installation calls a sensor:

```text
sensor.living_room_temperature_2
```

It should care that:

```text
Living room has capability: temperature
```

Homeframe keeps those concerns separate:

```text
Home Assistant
    ↓
areas / devices / entities / states
    ↓
semantic capabilities
    ↓
installation bindings
    ↓
DashboardManifest
    ↓
reusable Homeframe cards
    ↓
Vue renderer
```

Concrete Home Assistant entity IDs belong in installation bindings. They do not belong in reusable framework components.

## Open-source installation model

Homeframe framework code and a user's home configuration are deliberately separate:

```text
Homeframe repository
├── core
├── sdk
├── tooling
├── cards
├── MCP / CLI
└── renderer

User installation data
└── ~/.homeframe/
    └── dashboards/
        ├── my-home-tablet-10.json
        ├── my-home-nest-hub.json
        └── my-home-mobile.json
```

Set `HOMEFRAME_DATA_DIR` to use another persistent location, for example a Docker volume or `/var/lib/homeframe`.

This means Homeframe can be upgraded without overwriting a user's dashboards.

## Multi-device dashboards

Different screens should normally get different manifests instead of forcing one responsive dashboard to serve every context.

Built-in planning profiles:

| Profile | Intended use | Default viewport | Grid |
| --- | --- | --- | --- |
| `tablet-10` | 10-inch wall/tabletop tablet | 1280×800 landscape | 12 columns |
| `nest-hub` | Google Nest Hub-style display | 1024×600 landscape | 8 columns |
| `mobile` | phone | 390×844 portrait | 4 columns |
| `desktop` | browser/large monitor | 1440×900 landscape | 12 columns |
| `custom` | custom display | user-defined | 12 columns by default |

The same Home Assistant entities can be reused across all of them while cards, priority and layout differ per screen.

## AI-first architecture

Homeframe is designed so an agent such as Hermes can use it as a **product**, not as a codebase it must rewrite.

```text
                     Hermes
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
 Home Assistant MCP           Homeframe MCP
 "What exists here?"         "How do I build it?"
          │                         │
          └────────────┬────────────┘
                       ▼
                 HomeSnapshot
                       ↓
                plan_dashboards
                       ↓
           create_planned_dashboards
                       ↓
                saved manifests
                       ↓
               Homeframe Runtime
```

Normal dashboard work should use MCP/CLI operations. Editing Vue/TypeScript is a separate framework-contributor workflow.

## Current features

- Vue 3 + TypeScript dashboard renderer
- glass-inspired default visual system
- Home Assistant WebSocket client
- area/device/entity/state registry loading
- realtime state subscriptions
- semantic discovery of common Home Assistant capabilities
- declarative card and dashboard contracts
- JSON Schema 2020-12 manifest validation
- persistent installation dashboard store
- deterministic multi-device dashboard planner
- grid layout and per-card bindings/props
- CLI for dashboard operations
- stdio MCP server with read **and write** dashboard tools
- read-only runtime HTTP API for screens
- exact dashboard selection by URL or automatic profile selection
- room, climate, energy, appliance, vacuum and security card contracts
- conservative security-state rendering
- demo/reference mode without Home Assistant
- smoke tests and GitHub Actions CI
- explicit agent rules separating installation work from framework development

## Quick start

### Requirements

- Node.js 20 or newer
- npm 10 or newer

### Install and verify

```bash
git clone https://github.com/tripex/homeframe.git
cd homeframe
npm install
npm run check
```

### Create demo dashboards

The repository includes a neutral example HomeSnapshot:

```bash
export HOMEFRAME_ROOT="$PWD"
export HOMEFRAME_DATA_DIR="$PWD/.homeframe-local"

node packages/cli/dist/cli.js dashboard plan \
  examples/home-snapshot.json \
  tablet-10,nest-hub,mobile \
  --save
```

List the generated dashboards:

```bash
node packages/cli/dist/cli.js dashboard list
```

### Start Homeframe Runtime

```bash
npm start
```

Open:

```text
http://localhost:4173/
```

The frontend infers a device profile from the viewport and loads the first saved dashboard for that profile.

Or select an exact dashboard:

```text
http://localhost:4173/?dashboard=demo-home-tablet-10
http://localhost:4173/?dashboard=demo-home-nest-hub
http://localhost:4173/?dashboard=demo-home-mobile
```

## Homeframe MCP

Build the repository first, then start the stdio server:

```bash
export HOMEFRAME_ROOT=/path/to/homeframe
export HOMEFRAME_DATA_DIR=/var/lib/homeframe
node /path/to/homeframe/packages/mcp/dist/server.js
```

Important dashboard tools include:

```text
list_dashboards
get_dashboard
plan_dashboards
create_planned_dashboards
create_dashboard
save_dashboard
add_card
remove_card
set_binding
set_card_layout
reflow_dashboard
delete_dashboard
```

Discovery/validation tools include:

```text
project_info
installation_info
list_cards
get_card
validate_dashboard
```

See [`docs/HERMES.md`](docs/HERMES.md) for the intended agent workflow and [`docs/CLI_AND_MCP.md`](docs/CLI_AND_MCP.md) for the tool interfaces.

## Connecting Home Assistant

The preferred way to connect a real home is through Homeframe Runtime, which keeps the Home Assistant token on the server and only sends states and semantic discovery data to screens:

```bash
export HOMEFRAME_HA_URL=http://homeassistant.local:8123
export HOMEFRAME_HA_TOKEN=your-long-lived-access-token
npm start
```

The reference frontend also contains a development connection flow that talks to Home Assistant's WebSocket API directly from the browser.

For local development you can use:

```bash
cp .env.example .env
```

and set:

```env
VITE_HA_URL=http://homeassistant.local:8123
VITE_HA_TOKEN=your-development-token
```

**Do not treat `VITE_HA_TOKEN` as the production authentication model.** Anything embedded in a browser build is visible to the browser. Production authentication/session handling is still an explicit roadmap item.

For AI-driven dashboard creation, Hermes should inspect the home through Home Assistant MCP and provide Homeframe with a semantic `HomeSnapshot`. Homeframe does not require one specific HA MCP implementation.

## Repository structure

```text
apps/dashboard/        Vue dashboard frontend
packages/core/         Home Assistant client and semantic discovery
packages/sdk/          Public card/dashboard TypeScript contracts
packages/tooling/      Dashboard engine, planner, persistence and validation
packages/cli/          Human/script command-line interface
packages/mcp/          Agent-facing Model Context Protocol server
packages/runtime/      Read-only HTTP/static runtime for screens
catalog/cards/         Machine-readable reusable card contracts
schemas/               JSON schemas
agents/                 Agent rules and skills
examples/               Neutral installation examples
docs/                   Human-readable documentation
```

Start here as a human:

1. [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
3. [`docs/CLI_AND_MCP.md`](docs/CLI_AND_MCP.md)

Start with [`AGENTS.md`](AGENTS.md) as an AI agent.

## Design principles

1. **Home Assistant remains the source of truth.** Homeframe does not replace integrations, automations or device management.
2. **Installation data is separate from framework source.** Updating Homeframe must not overwrite a user's dashboards.
3. **Reusable UI never hardcodes entity IDs.** Entity IDs live at the binding boundary.
4. **Semantic capabilities are the common language.** Cards consume concepts such as `temperature`, `light`, `climate` and `vacuum`.
5. **AI uses operations before code.** Normal dashboard creation uses manifests, planner, CLI and MCP.
6. **AI-first does not mean AI-only.** Code and docs must remain clear to human contributors.
7. **Sensitive actions are explicit.** Lock/alarm/garage actions are `security` risk and require a deliberate approval path.
8. **Different screens can have different dashboards.** A Nest Hub should not be a shrunken wall-tablet layout.
9. **Calm UI over entity overload.** Prioritize hierarchy, glanceability and context.

## Roadmap

### v0.2 — Agent-usable installation foundation

- persistent manifests
- multi-device target profiles
- dashboard planner
- write-capable CLI/MCP
- runtime API and renderer
- installation-agent contract

### Next

- production-safe Home Assistant authentication/session model
- richer capability discovery and confidence scoring
- more reusable cards and interactions
- screen-aware planning beyond the initial deterministic rules
- visual dashboard editor and drag/resize
- theme system and additional official themes
- Home Assistant-native/community-dashboard packaging
- HACS-friendly distribution
- stable migration/versioning guarantees
- approved runtime action execution for `control` and `security` operations

## Contributing

Homeframe should be understandable by ordinary frontend developers and Home Assistant enthusiasts, not only AI agents.

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before larger framework changes.

## License

MIT
