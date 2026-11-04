# Homeframe

Homeframe shows calm, AI-first dashboards for wall tablets and desktop
monitors. As an add-on it
runs inside Home Assistant and opens from the sidebar; Home Assistant handles
login, and the add-on talks to Home Assistant with its own Supervisor token.
No long-lived access token is needed, and none is ever sent to a browser.

## Options

- **allow_control** (default `true`): dashboards may switch lights, set
  climate targets and start or dock a vacuum. Locks, alarms and garage doors
  are status-only in Homeframe and can never be changed, whatever this says.

- **locale** (default `en`): language of the dashboards Homeframe creates
  by itself (`en` or `da`).

- **regenerate_dashboard** (default `false`): rebuild every template
  dashboard (`home-tablet`, `home-desktop` and any other dashboard made from
  a template) from the current template on every start, and bring back a
  removed `home-tablet`/`home-desktop`. Turn it on after an update to pick up
  template improvements (or after adding a camera or solar sensor), restart
  the add-on once, then turn it off again so later edits are kept.
  Dashboards made by an agent, the planner or by hand are never touched.

## Your own house photo

Put `home-day.jpg` (and optionally `home-night.jpg`; `.webp` and `.png` work
too) in the add-on's config folder, `/addon_configs/<id>_homeframe/` (visible
over the Samba or File editor add-ons). Without a photo the home scene draws
the live sky instead.

## Dashboards

The add-on fills in two templates from your home, each once, when it is
missing:

- `home-tablet` for a 10" wall tablet (1280×800): hero picture, locks,
  climate, forecast, agenda or vacuum, live energy flow (with solar or a
  grid meter), two cameras and four rooms.
- `home-desktop` for a desktop monitor (2560×1440 or 1920×1080): the same
  and more — every thermostat with current and target temperature, who is
  home, up to four cameras and up to eight rooms — filling the screen
  without scrolling.

Homeframe picks the dashboard from the window: a tablet gets `home-tablet`,
a window wider than 1400 px gets `home-desktop`. The side navigation links
to the other screen's dashboard too. A dashboard you delete is not
recreated (unless `regenerate_dashboard` is on). Dashboards are stored in
the add-on's `/data` and survive updates and backups; later starts never
overwrite them unless `regenerate_dashboard` is on.
