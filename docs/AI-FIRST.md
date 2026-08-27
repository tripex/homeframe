# AI-first design

AI-first means an agent can understand and extend Homeframe through stable contracts. It does **not** mean that the codebase should be optimized for machines at the expense of people.

## The goal

A user should eventually be able to ask an agent:

> Add the washing machine to the utility room and show time remaining when available.

The agent should not need to rewrite the dashboard component tree by hand.

The preferred path is:

```text
user request
    ↓
agent inspects Home Assistant
    ↓
agent identifies capabilities and existing cards
    ↓
agent updates bindings / dashboard manifest
    ↓
Homeframe renders the change
```

## Configuration before code

Agents should make the smallest durable change.

Preferred order:

1. update bindings
2. update a dashboard manifest
3. reuse an existing card
4. extend semantic discovery
5. create a new reusable card
6. modify framework architecture

This prevents every home from turning into a custom fork.

## Machine-readable contracts

Important framework concepts should be discoverable without scraping prose documentation.

Homeframe therefore uses:

- JSON schemas
- card manifests
- stable TypeScript types
- explicit action risk levels
- fixture data

Prose documentation explains intent and examples; schemas define the contract.

## Human-readable code is mandatory

Agent-generated code must follow the same standard as human-written code.

Prefer:

```ts
const rooms = discoverHome(snapshot);
```

when it communicates the idea clearly.

Avoid abstraction stacks whose only benefit is that an agent can mechanically generate them.

Names should describe the domain. Comments should explain non-obvious decisions. A maintainer should be able to debug the project without asking an AI what the code means.

## Safety model

Every card action declares one of three risk levels:

- `read`
- `control`
- `security`

Agents may propose security actions, but Homeframe must require explicit human interaction before executing them.

Examples include:

- unlocking a door
- opening a garage door
- changing alarm state

The risk declaration is part of the card/tool contract, not merely a prompt instruction.

## Hermes

Hermes is one possible agent runtime, not a dependency of the framework.

Homeframe should remain usable with other agents or without AI at all. The Hermes-specific integration is documented separately in `docs/HERMES.md`.
