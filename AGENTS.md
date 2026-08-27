# Instructions for AI agents

Homeframe is AI-first, but every change must remain easy for a human contributor to understand.

Before changing code, read:

1. `docs/ARCHITECTURE.md`
2. `docs/AI-FIRST.md`
3. `docs/HERMES.md` when working through Hermes or Home Assistant MCP

The detailed contributor contract lives in `agents/AGENTS.md`.

## Default decision order

When asked to change a dashboard, try these options in order:

1. change a dashboard manifest or binding
2. reuse an existing card
3. extend semantic discovery
4. add a new reusable card
5. change framework architecture only when the previous options cannot solve the problem cleanly

Never hardcode a user's Home Assistant entity IDs inside reusable framework components.
