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

Conservative rules that keep a generated screen honest (all entities stay bindable by id):

- **One camera per device.** Integrations such as UniFi Protect expose several streams per camera (high/medium/low resolution, insecure, a doorbell's package camera). The best stream — main/high resolution, online — stays `camera`; the others become `generic`.
- **People are household members.** A person with a device tracker always counts. One without a tracker is left out only on evidence that it is a service login: its Home Assistant user is system-generated, deactivated or `local_only` (read via `config/auth/list` when the token is admin), or, without the user list, its name is a well-known service (`mqtt`, `node-red`…).
- **Room temperatures are air temperatures.** Temperature sensors that are diagnostic/config, named like equipment (inverter, CPU, battery, chip, internal…) or read outside −30…45 °C are `generic`; a room with only such sensors shows no temperature rather than a wrong one. The range is wider than indoors on purpose: outdoor areas read below zero in winter.
- **Power without a device class.** A sensor in W/kW without `device_class` (common for ESPHome inverter loggers) is still power and joins the energy flow by name (`pv…` solar, `grid…` grid). A `binary_sensor` with device class power is on/off, not watts. Whole-home load sensors outrank single plugs, and home-wide capability lists are ordered by score, so templates bind the best sensor first.
- **Names.** Labels collapse an exactly repeated leading phrase ("L50 Ultra L50 Ultra") and fall back to the device name when `has_entity_name` is set without an entity name.

- **Appliances are devices, not entities.** Washers, dryers and dishwashers are recognised per device (`appliances.ts`): the kind from the device name/model (Danish and English) or a kind-specific translation key, the roles from translation keys and names. A device that also has a light, vacuum or climate entity is something else (a lamp named "vaskemaskine", a robot vacuum washing its mop). A power sensor named after the appliance is a smart-plug appliance; one plug and one integration appliance of the same kind are merged. The state rules (`applianceStatus`) are pure and take the clock and the plug memory as arguments.

Templates (`catalog/templates`) can give a stacked column a `rows` budget: cards are kept by `priority` until it is full and cards with `grow` take what is left, in listed order. The home-tablet status column uses this to fit the energy-flow card (when solar or grid power exists) by dropping the lowest-priority climate overview and shrinking the agenda/vacuum slot to two rows.

A stack slot can carry **stand-ins** (`standIns`): status-only cards, today the home's appliances, that borrow the slot while they are active. They are resolved at plan time but never laid out; the renderer shows the active one in the slot (finished laundry first) and, in a slot of four rows or more, keeps the regular card underneath. The layout never changes with the washer, so a screen cannot start to scroll.

A screen-filling template (home-desktop) sets `rows` on the template itself and ends with a **tile band**: tiles from several sources (cameras at their 16:9 width, then rooms, thermometer rooms first) packed into at most `maxRows` rows of equal height. The band re-cuts its rows so none is left half empty, widens tiles to close each row (rooms before cameras, never beyond `maxW`) and, when a row cannot be filled, drops a tile and uses one row fewer. The band sits at the foot of the screen; stacks without their own `rows` get what it leaves, so a home with few cameras and rooms gets a taller hero and status column instead of a hole. The desktop grid stretches its rows to the window height (`desktop.css`), so the template's rows always fit the screen.

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

`control` actions run only when the runtime is started with `HOMEFRAME_ALLOW_CONTROL=true` (or, as a Home Assistant add-on, with the `allow_control` option). `security` actions are refused unconditionally until Homeframe has an explicit approval path, and `packages/tooling/src/service-policy.ts` re-checks every resolved service call so a lock, alarm or garage bound by mistake into another card is still refused.

Cards that need more than states read through the runtime as well, always by dashboard and card instance: `api/forecast` and `api/agenda` (via the read-only `weather.get_forecasts` and `calendar.get_events`), `api/camera_proxy/<camera>` (stills, only for cameras on a saved dashboard) and `api/assets/<name>` (the installation's own house photos).

The Home Assistant connection heals itself (`packages/runtime/src/home-assistant.ts`). The core client reports an unintended drop exactly once (`onDisconnect`; a deliberate `close()` never does) and sends Home Assistant `ping`s, because a vanished host can leave a socket looking open for minutes. The runtime then reports status `disconnected` on its event stream, keeps the last known states, retries with backoff (1, 2, 5, 10, then 30 s, with a little jitter, forever; also when Home Assistant is not up at start) and, once back, fetches a fresh snapshot, rediscovers the home, resubscribes and sends every screen a full `snapshot` event: Home Assistant does not replay changes made while we were away. Screens apply the same rule to their own event stream: after it was interrupted they reload `api/ha/snapshot`. The pure decision of when a screen calls its data stale lives in `packages/core/src/connection.ts` (`liveDataHealth`), next to the backoff (`reconnectDelayMs`).

The runtime finds Home Assistant in one of three ways (`packages/runtime/src/config.ts`): `HOMEFRAME_HA_URL` + `HOMEFRAME_HA_TOKEN`, the Supervisor proxy when it runs as an add-on (`SUPERVISOR_TOKEN`, see `docs/ADDON.md`), or not at all.

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
