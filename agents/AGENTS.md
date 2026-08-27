# Homeframe agent contract

This repository is intentionally AI-first. Agents are first-class contributors, not code generators bolted on later.

## Non-negotiable architecture rules

1. Never hardcode Home Assistant entity IDs inside visual components.
2. Visual components consume semantic capabilities or explicit bindings.
3. New cards MUST ship with a machine-readable manifest matching `schemas/card-manifest.schema.json`.
4. Every control action MUST declare a risk level: `read`, `control`, or `security`.
5. Security-sensitive actions (locks, alarms, garage doors) MUST require an explicit user interaction; agents may not silently trigger them.
6. Home Assistant integration belongs in `packages/core`, not in cards.
7. Keep the UI calm: state is communicated through hierarchy and restrained accent, not a wall of colored tiles.
8. Prefer additive compatibility with Home Assistant registries; do not depend on undocumented frontend internals.

## Agent workflow for a new card

1. Read `docs/ARCHITECTURE.md` and `docs/AI-FIRST.md`.
2. Identify required semantic capabilities.
3. Create/update a manifest before writing UI.
4. Implement the card against semantic props.
5. Add mock/demo data.
6. Add action bindings only through the core service layer.
7. Run `npm run typecheck && npm run build`.

## Definition of done

A card is not done until an agent can understand when to use it solely from its manifest and docs.
