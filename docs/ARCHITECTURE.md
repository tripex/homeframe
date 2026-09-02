# Architecture

Homeframe intentionally has a small number of layers. Each layer should have one obvious responsibility.

## 1. Home Assistant adapter — `packages/core`

This package knows how Home Assistant works.

It is responsible for:

- WebSocket authentication
- loading area, device and entity registries
- loading entity states
- subscribing to state changes
- calling Home Assistant services

Other packages should not duplicate Home Assistant protocol details.

## 2. Semantic discovery — `packages/core/src/discovery.ts`

Home Assistant exposes raw entities. Homeframe turns those entities into capabilities that are easier for dashboards and agents to reason about.

Examples:

```text
sensor.living_room_temperature → temperature
light.ceiling                  → light
climate.floor_heating          → climate
vacuum.robot                   → vacuum
```

A capability still keeps its entity ID at this boundary because Homeframe eventually needs to read or control the entity. The important rule is that reusable visual components do not hardcode those IDs.

Discovery is deliberately heuristic. Home Assistant installations vary widely, so future versions will combine registry metadata, device classes, integration information, user bindings and optional AI-assisted suggestions.

## 3. Framework contracts — `packages/sdk`

The SDK defines stable data structures that cards, dashboard manifests and tools can share.

This is the contract between:

- Homeframe itself
- custom cards
- configuration tooling
- AI agents

Keep these contracts small. Do not move implementation details into the SDK merely because more than one file uses them.

## 4. Presentation — `apps/dashboard`

The Vue application renders semantic models into the Homeframe interface.

It owns:

- layout
- navigation
- card presentation
- interaction design
- the visual design system

It should not contain Home Assistant registry logic.

## 5. Runtime — `packages/runtime`

Homeframe Runtime is the process a screen talks to. It serves the built dashboard, the saved manifests and a read-only stream of Home Assistant states, and it is the only place that holds the Home Assistant token.

Card actions follow the same boundary. A screen never sends an entity id or a service name; it sends a dashboard id, a card instance id and an action id from the card catalog. `packages/tooling/src/actions.ts` turns that into a Home Assistant service call using the card's saved bindings, so the catalog's declared risk level decides what may happen:

```text
screen  →  POST /api/actions { dashboardId, instanceId, actionId }
             ↓
        card catalog (risk: read | control | security)
             ↓
        saved bindings → Home Assistant service call
```

`control` actions run only when the runtime is started with `HOMEFRAME_ALLOW_CONTROL=true`. `security` actions are refused unconditionally until Homeframe has an explicit approval path.

## Dependency direction

The intended direction is:

```text
presentation
    ↓
runtime / tooling
    ↓
SDK / semantic contracts
    ↓
Home Assistant adapter
```

Do not make `packages/core` import the dashboard application.

## Standalone and Home Assistant-native delivery

Homeframe is designed to support two delivery modes.

### Standalone frontend

The reference Vue application runs independently and connects to Home Assistant.

This is the easiest environment for development and is the current implementation.

### Home Assistant community dashboard adapter

A future thin adapter can register Homeframe as a Home Assistant dashboard strategy / community dashboard.

The adapter should reuse the same renderer and contracts. It must not become a second implementation of Homeframe.

## Why WebSocket?

Home Assistant uses WebSocket APIs for realtime frontend data and registry access. Homeframe follows the same model so state changes appear without polling.

## What is intentionally not decided yet?

The following are still product decisions, not architecture guarantees:

- production authentication
- dashboard persistence location
- visual editor implementation
- plugin distribution format
- AI provider/runtime

Keeping these open avoids baking temporary decisions into the core.
