# Changelog

## 0.5.0

- New appliance card for washers, dryers and dishwashers: "38 min tilbage ·
  Færdig kl. 14.35", the program and today's energy while it runs, and
  "Vasketøjet er færdigt" / "Opvasken er færdig" when it is done. A small
  drawing of the machine turns its drum only while it runs (still with
  reduced motion). Status only, no buttons.
- Appliances are found per device for LG ThinQ (also SmartThinQ), Home
  Connect (Bosch/Siemens), Miele, SmartThings, Electrolux and generic status
  sensors, named in Danish or English. Without an integration a smart plug
  named after the machine is enough: running above 10 W, finished when it
  has gone quiet.
- `home-tablet` and `home-desktop` show the appliance in the agenda/vacuum
  slot only while it runs or is finished; otherwise nothing changes. In the
  tall desktop slot the agenda stays visible below it. Homes without
  appliances get exactly the same dashboards as before.
- Regenerate the dashboards (`regenerate_dashboard`) to add the appliance to
  existing `home-tablet`/`home-desktop` dashboards.
- Thanks to skyrotter/ha-appliance-electromenager-cards (MIT) for ideas for
  the status rules.

## 0.4.1

- Homeframe reconnects to Home Assistant by itself after a restart, an update
  or a network drop, and when the add-on starts before Home Assistant does
  (it used to keep showing old values until the add-on was restarted). It
  retries after 1, 2, 5, 10 and then every 30 seconds, and a ping every
  30 seconds catches connections that died without closing.
- After reconnecting, every screen gets the whole home again, so changes made
  during the outage show up without reloading the page.
- While the connection is down the screen says so: "Forbindelse til Home
  Assistant mistet — viser senest kendte værdier · Genforbinder… · Sidst
  opdateret 20.37 (for 2 minutter siden)" (in English for English
  dashboards). The cards are dimmed and the controls paused until the values
  are live again; the message disappears by itself.

## 0.4.0

- New `home-desktop` dashboard for a 27" monitor (2560×1440, equally at
  1920×1080): side navigation, the house as hero, locks, forecast, every
  thermostat with current and target temperature, who is home, live energy
  flow (with solar or a grid meter), agenda or vacuum, and a band of up to
  four cameras and up to eight rooms. It fills the screen without
  scrolling; type and spacing scale with the window for reading from a desk.
- The add-on creates `home-tablet` and `home-desktop`, each once, when
  missing: updating from 0.3.x adds `home-desktop` on the first start. A
  dashboard you delete is not recreated.
- `regenerate_dashboard` now rebuilds every template dashboard (also
  `home-desktop` and dashboards made from a template with another id) and
  still never touches dashboards made by an agent, the planner or by hand.
- A browser window wider than 1400 px opens the desktop dashboard (the
  tablet's when there is none); a 1280×800 tablet keeps `home-tablet`. The
  side navigation links to the other screens' dashboards.
- The `desktop` profile is now 2560×1440 with 16 columns (was 1440×900, 12).

## 0.3.2

- The drawn house follows daylight instead of always looking like night.
- Rooms without a room thermometer show their lights instead of "—°".
- Cameras: one camera per device (the main/high-resolution stream; package,
  insecure and low-res streams are skipped, offline cameras rank last), so
  two camera slots show two different cameras. Titles drop the
  "High resolution channel" suffix.
- People: integration/service logins (no device tracker and a local-only,
  system or deactivated user, e.g. MQTT) no longer appear as household members.
- Room temperature ignores equipment sensors (inverter, CPU, battery,
  diagnostic…) and implausible readings; such a room shows no temperature.
- Names that repeat themselves ("L50 Ultra  L50 Ultra") are tidied.
- Energy flow on the home-tablet dashboard when the home has solar or a grid
  meter, in the status column (climate overview gives way, the
  agenda/vacuum slot becomes a two-row strip). W/kW sensors without a device
  class (ESPHome inverter loggers such as Solplanet/SunMate) are now
  recognised; whole-home load outranks single plugs. Energy-flow labels are
  translated (da).
- New option `regenerate_dashboard` (default off): rebuild the auto-created
  `home-tablet` dashboard from the current template on start. Turn it on once
  after this update to get the fixes above, then off again.

## 0.3.1

- Energy-flow card: live flow between solar, grid, battery, home and EV,
  with self-sufficiency and spot price.
- Electricity prices use one capability kind (`price`).

## 0.3.0

- First add-on release: ingress panel, Supervisor connection, home-tablet
  template with home scene, cameras, forecast, agenda and presence.
