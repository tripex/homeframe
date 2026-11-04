# Home Assistant add-on

Homeframe can run inside Home Assistant OS / Supervised as an add-on (Home
Assistant now also calls these "apps"). It then opens from the Home
Assistant sidebar through **ingress**: Home Assistant handles login, and no
port is exposed on your network.

## Install

1. In Home Assistant open **Settings → Add-ons → Add-on store**.
2. **⋮ → Repositories**, add `https://github.com/tripex/homeframe` and close.
3. Open **Homeframe** in the store and press **Install**. The Supervisor
   builds the image on your machine (amd64 or aarch64); this takes a few
   minutes on a Raspberry Pi.
4. Optionally set the options (below), then **Start** and enable
   **Show in sidebar**.

The add-on fills in two templates from your home, each once, when missing:
`home-tablet` (10" wall tablet, 1280×800) and `home-desktop` (27" monitor,
2560×1440 or 1920×1080). Open Homeframe through the Home Assistant app or
browser (the device's Home Assistant login is what protects it); a window
wider than 1400 px shows `home-desktop`, a tablet `home-tablet`, and
`?dashboard=<id>` picks one explicitly. Which auto dashboards were created is
recorded in `/data/auto-dashboards.json`, so one you delete stays deleted and
an update that adds a new screen creates only that one.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `allow_control` | `true` | Dashboards may switch lights, set climate targets and start/dock a vacuum. |
| `locale` | `en` | Language of the dashboards the add-on creates (`en` or `da`). |
| `regenerate_dashboard` | `false` | Rebuild every template dashboard (`generatedBy: homeframe-template:<template>`, e.g. `home-tablet` and `home-desktop`) from its current template on every start, and recreate a missing `home-tablet`/`home-desktop`. Dashboards made by an agent, the planner or by hand are never touched. Turn on after an update, restart once, turn off. |

Why an option and not automatic: dashboards are installation data that
agents and users refine (`add_card`, `set_binding`…), and the stored manifest
does not record whether it was edited since it was generated. Replacing it
silently on update could throw such work away, so it only happens when asked.

Locks, alarms and garage doors are always status-only. A screen cannot change
them whatever the options say, and the runtime refuses any card action whose
service call would touch such an entity — even if a manifest binds one by
mistake.

### Your own house photo

The home scene shows `home-day.(jpg|webp|png)` by day and `home-night.*` after
sunset (a dimmed day photo if there is no night one). Put the files in the
add-on's config folder, `/addon_configs/<id>_homeframe/`, e.g. with the Samba
or File editor add-on. Without a photo the scene draws the live sky.

## How it connects

```text
tablet ──ingress (HA login)──▶ Homeframe runtime :8099 ──SUPERVISOR_TOKEN──▶ ws://supervisor/core/websocket
                                    │                                         http://supervisor/core/api
                                    └─ /data: dashboards, options
```

- `homeassistant_api: true` gives the add-on a `SUPERVISOR_TOKEN`. The
  runtime uses it server-side for states, service calls, forecasts, calendar
  events and camera stills. The browser never receives a token and only talks
  to the runtime, on the same origin.
- The runtime only accepts connections from the ingress proxy (172.30.32.2)
  and loopback.
- All dashboard URLs are relative, so the app works under the
  `/api/hassio_ingress/<token>/` prefix.
- Cameras are proxied as stills (`api/camera_proxy/<camera>`), only for
  cameras that a saved dashboard binds.

## Updates and data

Dashboards and options live in the add-on's `/data`, which the Supervisor
keeps across updates and includes in backups. Updating the add-on rebuilds
the image from the new source and never rewrites existing dashboards.

### Why the image clones a tag

The Supervisor builds an add-on with only its own folder (`homeframe/`) as
the Docker build context, so the Dockerfile cannot `COPY` the monorepo next
to it. It clones `https://github.com/tripex/homeframe` at the tag
`v<version>` instead, where `<version>` is `version` in
`homeframe/config.yaml` (the Supervisor passes it as `BUILD_VERSION`).

Releasing an add-on version therefore means:

1. bump `version` in `homeframe/config.yaml` (and `homeframe/CHANGELOG.md`),
2. merge to `main`,
3. tag that commit `v<version>` and push the tag.

Until the tag exists, installing that version fails at the clone step.

For local testing you can build any branch:

```bash
docker build --build-arg BUILD_VERSION=0.3.0 --build-arg HOMEFRAME_REF=main -t homeframe-addon homeframe/
```

## Running the same image without Home Assistant OS

The image also runs as a plain container, but then nothing authenticates
the browser: ingress is what protects the add-on. **If you run it
standalone you must provide your own authentication** (a reverse proxy with
login, a VPN, or a trusted network), and pass a Home Assistant URL and
long-lived token yourself:

```bash
docker run -p 8099:8099 -v homeframe-data:/data \
  -e HOMEFRAME_HA_URL=http://homeassistant.local:8123 \
  -e HOMEFRAME_HA_TOKEN=... \
  homeframe-addon
```

Without `SUPERVISOR_TOKEN` the ingress-only check is off, and controls stay
disabled unless you also set `HOMEFRAME_ALLOW_CONTROL=true`.
