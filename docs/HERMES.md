# Hermes integration

Homeframe treats Hermes as an external agent that can understand the repository and, when available, inspect Home Assistant through MCP.

Hermes is **not** required to run Homeframe.

## Intended setup

```text
Homeframe repository ─────┐
                          ├─→ Hermes
Home Assistant MCP ───────┘
                              ↓
                       dashboard change
```

Hermes gets two kinds of context:

1. the Homeframe repository, which tells it what the framework can render
2. Home Assistant MCP, which tells it what exists in the user's home

## Typical task

A user asks:

> Put my robot vacuum on the home screen and show whether it is cleaning or docked.

Hermes should:

1. read `AGENTS.md`
2. inspect the available Home Assistant entities through MCP
3. identify a `vacuum` capability
4. find an existing appliance/vacuum card manifest
5. update the dashboard manifest/binding
6. validate the manifest
7. only change Vue code if the framework genuinely lacks the required reusable UI

## Repository permissions

An agent that can write to the repository should still use normal software-engineering safeguards:

- work on a branch
- run typecheck/tests/build
- describe what changed
- use a pull request for non-trivial framework changes

Installation-specific dashboard configuration may eventually live outside the framework repository. Until that persistence model is finalized, agents should avoid committing secrets or private Home Assistant data.
