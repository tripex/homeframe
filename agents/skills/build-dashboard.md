# Skill: build dashboards with Homeframe

Use this skill when the user wants a dashboard for their own Home Assistant installation.

This is an **installation task**, not a Homeframe source-code task.

## Goal

Turn the user's real Home Assistant setup into one or more saved Homeframe DashboardManifests using Homeframe MCP operations.

## Inputs

- the user's requested screens and priorities
- Home Assistant MCP access
- Homeframe MCP access

## Procedure

1. Inspect Home Assistant areas, devices and entities.
2. Group relevant entities into semantic capabilities.
3. Build a HomeSnapshot. If Homeframe Runtime is already connected to Home Assistant, call
   `snapshot_home` instead of steps 1-3 to get one directly.
4. Choose target profiles.
5. Call `plan_dashboards` first.
6. Check that entity bindings are high-confidence and that important devices are represented.
7. Call `create_planned_dashboards`.
8. Refine each target separately with Homeframe write tools.
9. Read the saved manifests back with `get_dashboard`.
10. Report dashboard IDs/URLs to the user.

## Target guidance

### tablet-10

Use as the richest everyday overview. Rooms, climate, energy, appliances and important security status can coexist. Prefer glanceable cards over tiny controls.

### nest-hub

Treat screen space as scarce. Prioritize current state, a few important rooms, climate, active appliances and immediate attention items. Remove low-value cards rather than shrinking everything.

### mobile

Prefer a simple vertical flow. Put attention/state first, then common controls and room navigation. A phone dashboard does not need to mirror the wall tablet.

### desktop

Use the extra width for a broad overview and diagnostics, but keep the calm Homeframe hierarchy.

## Binding rules

- Concrete Home Assistant entity IDs belong in manifest bindings.
- Do not put entity IDs in reusable framework source.
- Prefer one high-confidence entity over several uncertain ones.
- Use arrays only for capabilities that naturally aggregate, such as lights or multiple climate zones.
- Do not invent an entity ID.

## Security

Creating a security status card is configuration and is allowed.

Do not execute lock, alarm or garage state changes as part of dashboard creation. Those are separate `security`-risk actions and require the product's explicit approval path.

## When Homeframe lacks a card

Do not silently edit framework source.

Tell the user that the installed Homeframe version lacks a reusable card/capability. Framework development is a separate contributor task.
