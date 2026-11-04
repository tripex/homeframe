# Homeframe

Homeframe shows calm, AI-first dashboards for wall tablets. As an add-on it
runs inside Home Assistant and opens from the sidebar; Home Assistant handles
login, and the add-on talks to Home Assistant with its own Supervisor token.
No long-lived access token is needed, and none is ever sent to a browser.

## Options

- **allow_control** (default `true`): dashboards may switch lights, set
  climate targets and start or dock a vacuum. Locks, alarms and garage doors
  are status-only in Homeframe and can never be changed, whatever this says.

- **locale** (default `en`): language of the dashboard Homeframe creates on
  its first start (`en` or `da`).

- **regenerate_dashboard** (default `false`): rebuild the auto-created
  `home-tablet` dashboard from the current template on every start. Turn it
  on after an update to pick up template improvements (or after adding a
  camera or solar sensor), restart the add-on once, then turn it off again so
  later edits are kept. Only the `home-tablet` dashboard is replaced, and only
  while it is still template-generated; other dashboards are never touched.

## Your own house photo

Put `home-day.jpg` (and optionally `home-night.jpg`; `.webp` and `.png` work
too) in the add-on's config folder, `/addon_configs/<id>_homeframe/` (visible
over the Samba or File editor add-ons). Without a photo the home scene draws
the live sky instead.

## Dashboards

On its first start, when no dashboard exists yet, the add-on fills in the
`home-tablet` template from your home: hero picture, locks, climate,
forecast, agenda or vacuum, live energy flow (with solar or a grid meter),
cameras and rooms. Dashboards are stored in the add-on's `/data` and survive
updates and backups; later starts never overwrite them unless
`regenerate_dashboard` is on.
