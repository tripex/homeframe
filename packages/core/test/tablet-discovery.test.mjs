// Discovery rules behind the home-tablet template: one camera per device,
// household people only, plausible room temperatures, tidy names and
// inverter power sensors. Imports compiled output; run `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";

import { cameraTitle, discoverHome, tidyName } from "../dist/index.js";

function state(entity_id, value, attributes = {}) {
  return { entity_id, state: value, attributes, last_changed: "2026-01-01T00:00:00Z", last_updated: "2026-01-01T00:00:00Z" };
}

/** entities: [{ entity_id, state?, attributes?, ...registry fields }] */
function snapshot({ areas = [], devices = [], entities = [], users } = {}) {
  return {
    areas: areas.map(([area_id, name]) => ({ area_id, name })),
    devices,
    entities: entities.map(({ state: _s, attributes: _a, ...registry }) => ({ device_id: null, area_id: null, ...registry })),
    states: entities.map((entity) => state(entity.entity_id, entity.state ?? "on", entity.attributes ?? {})),
    ...(users ? { users } : {}),
  };
}

function all(home) {
  return [...home.areas.flatMap((area) => area.capabilities), ...home.unassigned];
}

function kindOf(home, entityId) {
  return all(home).find((capability) => capability.entityId === entityId)?.kind;
}

test("one camera per device: the main stream wins over package, insecure and low-res variants", () => {
  const home = discoverHome(
    snapshot({
      devices: [
        { id: "doorbell", name: "G4 Doorbell Pro" },
        { id: "bullet", name: "G6 Bullet", name_by_user: "Driveway" },
      ],
      entities: [
        { entity_id: "camera.doorbell_package_camera", device_id: "doorbell", original_name: "Package Camera", state: "idle" },
        { entity_id: "camera.doorbell_high_resolution_channel", device_id: "doorbell", original_name: "High resolution channel", state: "idle" },
        { entity_id: "camera.doorbell_low_resolution_channel", device_id: "doorbell", original_name: "Low resolution channel", state: "idle" },
        { entity_id: "camera.doorbell_insecure", device_id: "doorbell", original_name: "Insecure", state: "idle" },
        { entity_id: "camera.driveway_high_resolution_channel", device_id: "bullet", original_name: "High resolution channel", state: "recording" },
        { entity_id: "camera.driveway_medium_resolution_channel", device_id: "bullet", original_name: "Medium resolution channel", disabled_by: "integration" },
      ],
    }),
  );

  const cameras = all(home).filter((capability) => capability.kind === "camera").map((capability) => capability.entityId);
  assert.deepEqual(cameras.sort(), ["camera.doorbell_high_resolution_channel", "camera.driveway_high_resolution_channel"]);
  assert.equal(kindOf(home, "camera.doorbell_package_camera"), "generic");
});

test("an unavailable camera ranks below an online one", () => {
  const home = discoverHome(
    snapshot({
      entities: [
        { entity_id: "camera.shed", state: "unavailable" },
        { entity_id: "camera.garden", state: "idle" },
      ],
    }),
  );
  const [shed, garden] = ["camera.shed", "camera.garden"].map((id) => all(home).find((c) => c.entityId === id));
  assert.ok(garden.score > shed.score);
});

test("people: trackers always count; trackerless local-only or service logins do not", () => {
  const users = [
    { id: "u-anna", name: "Anna", system_generated: false, local_only: false, is_active: true },
    { id: "u-ben", name: "Ben", system_generated: false, local_only: false, is_active: true },
    { id: "u-broker", name: "mqtt", system_generated: false, local_only: true, is_active: true },
    { id: "u-app", name: "Wallpanel", system_generated: false, local_only: true, is_active: true },
    { id: "u-kid", name: "Kid", system_generated: false, local_only: true, is_active: true },
  ];
  const person = (id, user_id, device_trackers = []) => ({
    entity_id: `person.${id}`,
    state: device_trackers.length ? "home" : "unknown",
    attributes: { user_id, device_trackers, friendly_name: id },
  });
  const entities = [
    person("anna", "u-anna", ["device_tracker.anna_phone"]),
    person("ben", "u-ben"),
    person("mqtt", "u-broker"),
    person("wallpanel", "u-app"),
    person("kid", "u-kid", ["device_tracker.kid_watch"]),
  ];

  const withUsers = discoverHome(snapshot({ entities, users }));
  assert.equal(kindOf(withUsers, "person.anna"), "person");
  assert.equal(kindOf(withUsers, "person.ben"), "person", "a family member without a tracker stays");
  assert.equal(kindOf(withUsers, "person.kid"), "person", "a tracker beats a local-only login");
  assert.equal(kindOf(withUsers, "person.mqtt"), "generic");
  assert.equal(kindOf(withUsers, "person.wallpanel"), "generic");

  // Without an admin token there is no user list: only well-known service names go.
  const withoutUsers = discoverHome(snapshot({ entities }));
  assert.equal(kindOf(withoutUsers, "person.mqtt"), "generic");
  assert.equal(kindOf(withoutUsers, "person.wallpanel"), "person");
  assert.equal(kindOf(withoutUsers, "person.ben"), "person");
});

test("room temperature ignores equipment and implausible readings", () => {
  const temperature = (entity_id, value, extra = {}) => ({
    entity_id,
    area_id: "shed",
    state: String(value),
    attributes: { device_class: "temperature", unit_of_measurement: "°C", ...(extra.attributes ?? {}) },
    ...extra.registry,
  });
  const home = discoverHome(
    snapshot({
      areas: [["shed", "Shed"], ["garden", "Garden"], ["office", "Office"]],
      entities: [
        temperature("sensor.datalogger_pulse_temperature", 64.4, { registry: { entity_category: "diagnostic" } }),
        temperature("sensor.inverter_temperature", 36.2),
        temperature("sensor.shed_mystery", 63.9),
        temperature("sensor.battery_pack_temperature", 23),
        { ...temperature("sensor.garden_temperature", -8), area_id: "garden" },
        { ...temperature("sensor.office_temperature", 70, { attributes: { unit_of_measurement: "°F" } }), area_id: "office" },
        { ...temperature("sensor.office_cpu_temperature", 41), area_id: "office" },
      ],
    }),
  );

  const shed = home.areas.find((area) => area.id === "shed");
  assert.ok(!shed || !shed.capabilities.some((c) => c.kind === "temperature"), "the shed has no room temperature");
  assert.equal(kindOf(home, "sensor.garden_temperature"), "temperature", "winter outdoors is plausible");
  assert.equal(kindOf(home, "sensor.office_temperature"), "temperature", "70 °F is 21 °C");
  assert.equal(kindOf(home, "sensor.office_cpu_temperature"), "generic");
});

test("names: repeated phrases collapse, has_entity_name falls back to the device", () => {
  assert.equal(tidyName("L50 Ultra  L50 Ultra"), "L50 Ultra");
  assert.equal(tidyName(" Kitchen Kitchen light "), "Kitchen light");
  assert.equal(tidyName("Living room"), "Living room");
  assert.equal(cameraTitle("Driveway High resolution channel"), "Driveway");
  assert.equal(cameraTitle("G4 Doorbell Pro Package Camera"), "G4 Doorbell Pro Package Camera");

  const home = discoverHome(
    snapshot({
      devices: [{ id: "robot", name: "L50 Ultra", name_by_user: null }],
      entities: [
        { entity_id: "vacuum.robot_doubled", original_name: " L50 Ultra", has_entity_name: false, attributes: { friendly_name: "L50 Ultra  L50 Ultra" } },
        { entity_id: "vacuum.robot", device_id: "robot", has_entity_name: true, original_name: null, attributes: { friendly_name: "L50 Ultra" } },
      ],
    }),
  );
  assert.equal(all(home).find((c) => c.entityId === "vacuum.robot_doubled").label, "L50 Ultra");
  assert.equal(all(home).find((c) => c.entityId === "vacuum.robot").label, "L50 Ultra");
});

test("inverter loggers: W sensors without a device class still join the energy flow", () => {
  const watt = (entity_id, value, attributes = {}) => ({ entity_id, state: String(value), attributes: { unit_of_measurement: "W", ...attributes } });
  const home = discoverHome(
    snapshot({
      entities: [
        watt("sensor.logger_pulse_pv_totalpower", 6758, { device_class: "power" }),
        watt("sensor.logger_pulse_pv1_power", 3269),
        watt("sensor.logger_pulse_grid_out_total_power", -6063),
        watt("sensor.logger_pulse_load_w_totalpower", 716, { device_class: "power" }),
        watt("sensor.aquarium_plug_power", 12, { device_class: "power" }),
        { entity_id: "binary_sensor.relay_input_power", state: "off", attributes: { device_class: "power" } },
        { entity_id: "sensor.logger_pulse_grid_current_l1", state: "9", attributes: { unit_of_measurement: "A" } },
      ],
    }),
  );

  assert.equal(kindOf(home, "sensor.logger_pulse_pv_totalpower"), "solar_power");
  assert.equal(kindOf(home, "sensor.logger_pulse_pv1_power"), "solar_power");
  assert.equal(kindOf(home, "sensor.logger_pulse_grid_out_total_power"), "grid_power");
  assert.equal(kindOf(home, "binary_sensor.relay_input_power"), "generic", "on/off power detection is not watts");
  assert.equal(kindOf(home, "sensor.logger_pulse_grid_current_l1"), "generic");

  const load = all(home).find((c) => c.entityId === "sensor.logger_pulse_load_w_totalpower");
  const plug = all(home).find((c) => c.entityId === "sensor.aquarium_plug_power");
  assert.equal(load.kind, "power");
  assert.ok(load.score > plug.score, "the whole-home load outranks a plug");
});
