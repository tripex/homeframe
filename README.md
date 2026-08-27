# Homeframe

**A beautiful, adaptive and AI-first dashboard framework for Home Assistant.**

Homeframe is an open-source frontend for Home Assistant with a calm glass-inspired visual language. Home Assistant remains the automation backend and source of truth; Homeframe focuses on presenting the home clearly and giving humans and AI agents a safe, predictable way to extend the dashboard.

> **Project status:** early foundation (`v0.1`). The core architecture, Home Assistant WebSocket client, semantic discovery, card contracts and first dashboard UI are in place. It is not production-ready yet.

## What makes Homeframe different?

Home Assistant exposes hundreds of raw entities. A dashboard should not have to care whether your living-room temperature happens to be called `sensor.living_room_temperature_2`.

Homeframe adds a semantic layer between Home Assistant and the UI:

```text
Home Assistant
  ↓
areas / devices / entities / states
  ↓
semantic discovery
  ↓
temperature / lights / climate / vacuum / washer / energy / ...
  ↓
Homeframe cards and layouts
```

Reusable cards therefore consume concepts such as `temperature`, `lights` and `climate` instead of hardcoded entity IDs.

This is also the foundation for AI-first workflows. An agent such as Hermes can inspect a Home Assistant installation, understand the available capabilities and generate or update a dashboard manifest without rewriting the UI.

## Current features

- Vue 3 + TypeScript reference dashboard
- Glass-inspired design system
- Home Assistant WebSocket authentication
- Area, device, entity and state registry loading
- Realtime state subscriptions
- Semantic discovery of common Home Assistant capabilities
- Declarative dashboard and card manifests
- Machine-readable schemas for AI agents and tooling
- Initial cards for rooms, climate, energy and appliances
- Demo mode for development without a Home Assistant instance
- Agent contract and Hermes workflow documentation

## Quick start

### Requirements

- Node.js 20 or newer
- npm 10 or newer

### Install

```bash
npm install
```

### Start the dashboard

```bash
npm run dev
```

Then open:

```text
http://localhost:4173
```

Homeframe starts in demo mode, so you can work on the UI without connecting Home Assistant.

### Check the project

```bash
npm run typecheck
npm run build
```

## Connecting Home Assistant

The dashboard includes an early connection dialog for local development. It connects directly to Home Assistant's WebSocket API and loads the registries needed for discovery.

For development you can provide:

- your Home Assistant URL
- a long-lived access token

Never commit a token to the repository.

You can also use environment variables while developing locally:

```bash
cp .env.example .env
```

Then set:

```env
VITE_HA_URL=http://homeassistant.local:8123
VITE_HA_TOKEN=your-development-token
```

Direct long-lived-token authentication is a development convenience, not the intended production authentication model.

## Repository structure

```text
apps/dashboard/        Vue reference frontend
packages/core/         Home Assistant client and semantic discovery
packages/sdk/          Stable card and dashboard contracts
catalog/cards/         Machine-readable descriptions of built-in cards
schemas/               JSON schemas used by tooling and agents
fixtures/demo-home/    Fake Home Assistant installation for local development
agents/                 Rules and skills for AI contributors
examples/               Example dashboard manifests
docs/                   Human-readable architecture and contributor docs
```

If you are new to the project, read these in order:

1. [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
3. [`docs/AI-FIRST.md`](docs/AI-FIRST.md)

If you are an AI agent, start with [`AGENTS.md`](AGENTS.md).

## Design principles

1. **Home Assistant remains the source of truth.** Homeframe does not replace automations, integrations or device management.
2. **Reusable UI never hardcodes entity IDs.** Entity bindings belong at the installation/configuration boundary.
3. **Prefer semantic concepts over Home Assistant implementation details.** A room card should understand `temperature`; it should not care which integration produced it.
4. **AI configures before it codes.** Agents should update manifests and bindings when possible and only add framework code when a genuinely new capability or card is required.
5. **Humans must be able to understand the code.** AI-first does not mean AI-only. Clear names and simple control flow beat clever abstractions.
6. **Sensitive controls are explicit.** Locks, alarms, garage doors and similar actions must never be silently triggered by an agent.
7. **Calm UI over tile overload.** State should be communicated through hierarchy, spacing and restrained accents instead of a wall of colors.

## AI / Hermes

The intended workflow is:

```text
Hermes + Home Assistant MCP
          ↓
inspect the actual home
          ↓
map devices to semantic capabilities
          ↓
generate/update DashboardManifest
          ↓
Homeframe renders the result
```

Most agent-driven changes should therefore be configuration changes, not component rewrites.

Read [`docs/HERMES.md`](docs/HERMES.md) for the intended integration model.

## Roadmap

### v0.1 — Foundation

- core contracts
- WebSocket client
- semantic discovery
- reference renderer
- first cards
- demo fixtures
- human and agent documentation

### v0.2 — Usable configuration

- binding engine
- onboarding and settings
- persisted dashboard manifests
- better discovery scoring
- richer demo home

### v0.3 — Home Assistant distribution

- Home Assistant dashboard strategy adapter
- HACS-friendly packaging
- production authentication strategy

### v0.4 — Dashboard editor

- drag and resize
- responsive layouts
- theme editor
- card configuration UI

### v0.5 — AI dashboard planner

- generate a first dashboard from discovered capabilities
- explain generated choices
- safe agent-driven changes

### v1.0

- stable card SDK
- plugin/card registry
- compatibility and migration guarantees

## Contributing

Homeframe is intended to be understandable by ordinary frontend developers and Home Assistant enthusiasts, not only by agents.

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before making larger changes.

## License

MIT
