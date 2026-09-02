// Tests for semantic discovery. Run with: node --test packages/core/test/
//
// These import the compiled output (../dist/index.js) rather than the
// TypeScript source, since this package has no TS-aware test loader yet.
// Run `npm run build -w @homeframe/core` before running these tests.
import { test } from "node:test";
import assert from "node:assert/strict";

import { discoverHome } from "../dist/index.js";

/**
 * Build a minimal RegistrySnapshot from a short-hand entity list.
 *
 * Each entity in `entities` may specify:
 *   - entity_id (required)
 *   - state (defaults to "on")
 *   - attributes (defaults to {})
 *   - name (defaults to undefined, falls back to entity_id in discovery)
 *   - area_id / device_id / entity_category / disabled_by (registry fields)
 *
 * `areas` and `devices` are passed through mostly as-is, keyed by id.
 */
function buildSnapshot({ areas = [], devices = [], entities = [] } = {}) {
  return {
    areas: areas.map((area) => ({ area_id: area.id, name: area.name })),
    devices: devices.map((device) => ({
      id: device.id,
      area_id: device.area_id ?? null,
    })),
    entities: entities.map((entity) => ({
      entity_id: entity.entity_id,
      device_id: entity.device_id ?? null,
      area_id: entity.area_id ?? null,
      name: entity.name ?? null,
      entity_category: entity.entity_category ?? null,
      disabled_by: entity.disabled_by ?? null,
    })),
    states: entities.map((entity) => ({
      entity_id: entity.entity_id,
      state: entity.state ?? "on",
      attributes: entity.attributes ?? {},
      last_changed: "2026-01-01T00:00:00Z",
      last_updated: "2026-01-01T00:00:00Z",
    })),
  };
}

/** Find a capability by entity_id across all areas and the unassigned list. */
function findCapability(home, entityId) {
  for (const area of home.areas) {
    const found = area.capabilities.find((cap) => cap.entityId === entityId);
    if (found) return found;
  }
  return home.unassigned.find((cap) => cap.entityId === entityId);
}

test("alarm_control_panel is classified as alarm", () => {
  const home = discoverHome(
    buildSnapshot({ entities: [{ entity_id: "alarm_control_panel.home" }] }),
  );
  assert.equal(findCapability(home, "alarm_control_panel.home").kind, "alarm");
});

test("cover with device_class garage is garage, plain cover stays cover", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [
        {
          entity_id: "cover.garage_door",
          attributes: { device_class: "garage" },
        },
        { entity_id: "cover.living_room_blinds" },
      ],
    }),
  );
  assert.equal(findCapability(home, "cover.garage_door").kind, "garage");
  assert.equal(findCapability(home, "cover.living_room_blinds").kind, "cover");
});

test("binary_sensor with device_class garage_door is a door contact sensor, not a garage", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [
        {
          entity_id: "binary_sensor.garage_contact",
          attributes: { device_class: "garage_door" },
        },
      ],
    }),
  );
  assert.equal(findCapability(home, "binary_sensor.garage_contact").kind, "door");
});

test("dryer and washer are distinguished by name, unrelated light domain is untouched", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [
        { entity_id: "sensor.tumble_dryer_state" },
        { entity_id: "sensor.washing_machine_state" },
        { entity_id: "light.dryer_room_light" },
      ],
    }),
  );
  assert.equal(findCapability(home, "sensor.tumble_dryer_state").kind, "dryer");
  assert.equal(findCapability(home, "sensor.washing_machine_state").kind, "washer");
  assert.equal(findCapability(home, "light.dryer_room_light").kind, "light");
});

test("a combined washer/dryer name resolves to washer", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [{ entity_id: "sensor.washer_dryer_state" }],
    }),
  );
  assert.equal(findCapability(home, "sensor.washer_dryer_state").kind, "washer");
});

test("existing classification behaviour is unchanged", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [
        { entity_id: "climate.living_room" },
        {
          entity_id: "sensor.outdoor_temp",
          attributes: { device_class: "temperature" },
        },
      ],
    }),
  );
  assert.equal(findCapability(home, "climate.living_room").kind, "climate");
  assert.equal(findCapability(home, "sensor.outdoor_temp").kind, "temperature");
});

test("an entity assigned to an area via its device lands in that area", () => {
  const home = discoverHome(
    buildSnapshot({
      areas: [{ id: "kitchen", name: "Kitchen" }],
      devices: [{ id: "device-1", area_id: "kitchen" }],
      entities: [{ entity_id: "light.kitchen_ceiling", device_id: "device-1" }],
    }),
  );
  const kitchen = home.areas.find((area) => area.id === "kitchen");
  assert.ok(kitchen);
  assert.ok(kitchen.capabilities.some((cap) => cap.entityId === "light.kitchen_ceiling"));
});

test("disabled entities are skipped", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [{ entity_id: "light.disabled_lamp", disabled_by: "user" }],
    }),
  );
  assert.equal(findCapability(home, "light.disabled_lamp"), undefined);
});

test("diagnostic entity_category lowers the score", () => {
  const home = discoverHome(
    buildSnapshot({
      entities: [
        { entity_id: "sensor.plain_temp", attributes: { device_class: "temperature" } },
        {
          entity_id: "sensor.diagnostic_temp",
          attributes: { device_class: "temperature" },
          entity_category: "diagnostic",
        },
      ],
    }),
  );
  const plain = findCapability(home, "sensor.plain_temp");
  const diagnostic = findCapability(home, "sensor.diagnostic_temp");
  assert.ok(diagnostic.score < plain.score);
});
