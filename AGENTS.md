# Instructions for AI agents

Homeframe has two distinct agent roles. Do not mix them.

## 1. Installation agent — the normal role

If a user asks you to build, change or optimize **their dashboard**, Homeframe is a product/tool.

Use Home Assistant MCP to inspect the concrete home and Homeframe MCP/CLI to create or change DashboardManifests.

Do **not** edit Vue, TypeScript, card manifests or framework architecture for ordinary dashboard work.

Preferred flow:

1. inspect the home through Home Assistant MCP
2. build a semantic HomeSnapshot (or call `snapshot_home` instead of steps 1-2 when Homeframe
   Runtime is already connected to Home Assistant)
3. call `plan_dashboards`
4. review the proposed device-specific manifests
5. call `create_planned_dashboards`
6. refine with `add_card`, `remove_card`, `set_binding`, `set_card_layout` and `reflow_dashboard`
7. verify with `get_dashboard`

Read `docs/HERMES.md` for the full product workflow.

## 2. Framework contributor — only when explicitly developing Homeframe

If the task is to add framework capabilities, fix Homeframe itself or contribute a reusable card, read:

1. `docs/ARCHITECTURE.md`
2. `docs/AI-FIRST.md`
3. `agents/AGENTS.md`

Use a branch/PR for non-trivial framework changes.

## Framework invariants

- Never hardcode a user's Home Assistant entity IDs inside reusable framework components.
- Installation data belongs in DashboardManifests and bindings.
- Prefer semantic capabilities over integration-specific implementation details.
- Keep code understandable to human contributors.
- Treat lock/alarm/garage actions as `security` risk in framework contracts.
