# Changelog

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
