# Contributing to Homeframe

Thanks for helping build Homeframe.

The project has one unusual constraint: it is designed for both human contributors and AI agents. Human readability wins whenever those goals conflict.

## Before changing code

Read:

1. `docs/ARCHITECTURE.md`
2. `docs/AI-FIRST.md`
3. `AGENTS.md` if you are using an AI coding agent

## Code style

Keep code boring in the good sense:

- use descriptive names
- keep functions small and focused
- prefer straightforward control flow
- avoid abstractions until they solve a real repeated problem
- comment *why* something exists, not what a line of code obviously does
- keep Home Assistant-specific details in `packages/core`
- never put installation-specific entity IDs inside reusable components

A contributor should be able to understand a file without first learning an internal vocabulary invented by Homeframe.

## Adding a card

A reusable card needs:

1. a semantic input contract
2. a machine-readable manifest in `catalog/cards`
3. a Vue implementation
4. demo data or a fixture that makes the card visible without Home Assistant
5. documentation when the behavior is not obvious

See `agents/skills/create-card.md` for the same process written as an agent workflow.

## Sensitive actions

Actions are classified as:

- `read` — displays or queries state
- `control` — changes ordinary device state such as lights or climate
- `security` — locks, alarms, doors, garages or similarly sensitive actions

Security actions always require an explicit human interaction. Do not create autonomous agent behavior that bypasses this rule.

## Before opening a pull request

Run:

```bash
npm run typecheck
npm run test
npm run build
```

If a command cannot be run in your environment, say so clearly in the pull request.
