// Appliance discovery and state logic. Run `npm run build -w @homeframe/core` first.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applianceStatus,
  discoverAppliances,
  discoverHome,
  normaliseApplianceState,
  PLUG_CYCLE_GAP_MS,
  PLUG_FINISHED_FOR_MS,
  programLabel,
} from "../dist/index.js";

const NOW = Date.parse("2026-11-06T13:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

/** Registry + states from `{ devices: [{ id, name, model, area_id }], entities: [{ entity_id, state, attributes, ...registry }] }`. */
function snapshot({ devices = [], entities = [] }) {
  return {
    areas: [],
    devices: devices.map((device) => ({ name_by_user: null, manufacturer: null, model: null, area_id: null, ...device })),
    entities: entities.map(({ state: _state, attributes: _attributes, last_changed: _changed, ...registry }) => ({
      name: null,
      original_name: null,
      device_id: null,
      area_id: null,
      has_entity_name: true,
      ...registry,
    })),
    states: entities.map((entity) => ({
      entity_id: entity.entity_id,
      state: String(entity.state ?? "unknown"),
      attributes: entity.attributes ?? {},
      last_changed: entity.last_changed ?? iso(NOW),
      last_updated: entity.last_changed ?? iso(NOW),
    })),
  };
}

function statesOf(snap, appliance) {
  const byId = new Map(snap.states.map((state) => [state.entity_id, state]));
  return Object.fromEntries(Object.entries(appliance.entities).map(([role, entityId]) => [role, byId.get(entityId)]));
}

// --- Discovery -----------------------------------------------------------------

const lgWasher = snapshot({
  devices: [{ id: "lg", name: "Vaskemaskine", manufacturer: "LGE", model: "VCDWL2QEUK (DEVICE_WASHER)", area_id: "entre" }],
  entities: [
    { entity_id: "sensor.vaskemaskine_current_status", device_id: "lg", translation_key: "current_state", original_name: "Current status", state: "spinning", attributes: { device_class: "enum", options: ["power_off", "running", "spinning", "end"] } },
    { entity_id: "sensor.vaskemaskine_remaining_time", device_id: "lg", translation_key: "remain", original_name: "Remaining time", state: iso(NOW + 25 * 60_000), attributes: { device_class: "timestamp" } },
    { entity_id: "sensor.vaskemaskine_total_time", device_id: "lg", translation_key: "total", original_name: "Total time", state: "100", attributes: { device_class: "duration", unit_of_measurement: "min" } },
    { entity_id: "sensor.vaskemaskine_delayed_end", device_id: "lg", translation_key: "relative_to_stop_wm", original_name: "Delayed end", state: "unknown", attributes: { device_class: "timestamp" } },
    { entity_id: "sensor.vaskemaskine_cycles", device_id: "lg", translation_key: "cycle_count", original_name: "Cycles", state: "51" },
    { entity_id: "binary_sensor.vaskemaskine_remote_start", device_id: "lg", translation_key: "remote_control_enabled", original_name: "Remote start", state: "off" },
    { entity_id: "select.vaskemaskine_operation", device_id: "lg", translation_key: "operation_mode", original_name: "Operation", state: "unknown", attributes: { options: ["start", "stop", "power_off"] } },
    { entity_id: "sensor.entre_vaskemaskine_energy_today", device_id: "lg", translation_key: "energy_usage_today", original_name: "Energy today", state: "350", attributes: { device_class: "energy", unit_of_measurement: "Wh" } },
    { entity_id: "sensor.vaskemaskine_energy_this_month", device_id: "lg", translation_key: "energy_usage_this_month", original_name: "Energy this month", state: "1595", attributes: { device_class: "energy", unit_of_measurement: "Wh" } },
    { entity_id: "switch.vaskemaskine_power", device_id: "lg", translation_key: "operation_power", original_name: "Power", state: "on", attributes: { device_class: "switch" } },
  ],
});

test("LG ThinQ washer: roles from translation keys, Danish device name", () => {
  const [washer, ...rest] = discoverAppliances(lgWasher);
  assert.equal(rest.length, 0);
  assert.equal(washer.kind, "washer");
  assert.equal(washer.name, "Vaskemaskine");
  assert.equal(washer.areaId, "entre");
  assert.equal(washer.source, "status");
  assert.deepEqual(washer.entities, {
    status: "sensor.vaskemaskine_current_status",
    remaining: "sensor.vaskemaskine_remaining_time",
    total: "sensor.vaskemaskine_total_time",
    energy: "sensor.entre_vaskemaskine_energy_today",
    switch: "switch.vaskemaskine_power",
  });

  const reading = applianceStatus(statesOf(lgWasher, washer), { now: NOW });
  assert.equal(reading.state, "running");
  assert.equal(reading.phase, "spin");
  assert.equal(reading.remainingMinutes, 25);
  assert.equal(reading.endsAt.toISOString(), iso(NOW + 25 * 60_000));
  assert.equal(reading.progress, 75, "derived from total time");
  assert.equal(reading.energyTodayKwh, 0.35);
});

test("Home Connect dishwasher named 'Opvaskemaskine' (contains 'vaskemaskine')", () => {
  const snap = snapshot({
    devices: [{ id: "bosch", name: "Opvaskemaskine", manufacturer: "Bosch", model: "SMV6ZCX49E" }],
    entities: [
      { entity_id: "sensor.opvaskemaskine_operation_state", device_id: "bosch", translation_key: "operation_state", state: "run", attributes: { device_class: "enum" } },
      { entity_id: "sensor.opvaskemaskine_program_finish_time", device_id: "bosch", translation_key: "program_finish_time", state: iso(NOW + 90 * 60_000), attributes: { device_class: "timestamp" } },
      { entity_id: "sensor.opvaskemaskine_program_progress", device_id: "bosch", translation_key: "program_progress", state: "40", attributes: { unit_of_measurement: "%" } },
      { entity_id: "select.opvaskemaskine_active_program", device_id: "bosch", translation_key: "active_program", state: "dishcare_dishwasher_program_eco_50", attributes: { options: ["dishcare_dishwasher_program_eco_50"] } },
      { entity_id: "select.opvaskemaskine_selected_program", device_id: "bosch", translation_key: "selected_program", state: "dishcare_dishwasher_program_eco_50" },
      { entity_id: "binary_sensor.opvaskemaskine_door", device_id: "bosch", translation_key: "door", state: "off", attributes: { device_class: "door" } },
      { entity_id: "switch.opvaskemaskine_power", device_id: "bosch", translation_key: "power", state: "on" },
    ],
  });
  const [dishwasher] = discoverAppliances(snap);
  assert.equal(dishwasher.kind, "dishwasher");
  assert.equal(dishwasher.entities.status, "sensor.opvaskemaskine_operation_state");
  assert.equal(dishwasher.entities.end_time, "sensor.opvaskemaskine_program_finish_time");
  assert.equal(dishwasher.entities.progress, "sensor.opvaskemaskine_program_progress");
  assert.equal(dishwasher.entities.program, "select.opvaskemaskine_active_program", "the running program, not the selected one");
  assert.equal(dishwasher.entities.door, "binary_sensor.opvaskemaskine_door");

  const reading = applianceStatus(statesOf(snap, dishwasher), { now: NOW });
  assert.equal(reading.state, "running");
  assert.equal(reading.remainingMinutes, 90);
  assert.equal(reading.progress, 40);
  assert.equal(reading.program, "Eco 50");
  assert.equal(reading.doorOpen, false);
});

test("Miele tumble dryer: status in_use, remaining minutes, program", () => {
  const snap = snapshot({
    devices: [{ id: "miele", name: "Tumble dryer", manufacturer: "Miele", model: "TWV 780 WP" }],
    entities: [
      { entity_id: "sensor.tumble_dryer", device_id: "miele", translation_key: "status", state: "in_use", attributes: { device_class: "enum" } },
      { entity_id: "sensor.tumble_dryer_remaining_time", device_id: "miele", translation_key: "remaining_time", state: "45", attributes: { device_class: "duration", unit_of_measurement: "min" } },
      { entity_id: "sensor.tumble_dryer_elapsed_time", device_id: "miele", translation_key: "elapsed_time", state: "30", attributes: { device_class: "duration", unit_of_measurement: "min" } },
      { entity_id: "sensor.tumble_dryer_program", device_id: "miele", translation_key: "program_id", state: "cottons" },
      { entity_id: "sensor.tumble_dryer_program_phase", device_id: "miele", translation_key: "program_phase", state: "drying" },
    ],
  });
  const [dryer] = discoverAppliances(snap);
  assert.equal(dryer.kind, "dryer");
  assert.equal(dryer.entities.status, "sensor.tumble_dryer");
  assert.equal(dryer.entities.remaining, "sensor.tumble_dryer_remaining_time");
  assert.equal(dryer.entities.program, "sensor.tumble_dryer_program");
  assert.equal(dryer.entities.phase, "sensor.tumble_dryer_program_phase");
  const reading = applianceStatus(statesOf(snap, dryer), { now: NOW });
  assert.deepEqual([reading.state, reading.phase, reading.remainingMinutes, reading.program], ["running", "dry", 45, "Cottons"]);
  assert.equal(reading.endsAt.toISOString(), iso(NOW + 45 * 60_000));
});

test("SmartThings washer: the kind comes from translation keys when the device is just 'Samsung'", () => {
  const snap = snapshot({
    devices: [{ id: "st", name: "Samsung", manufacturer: "Samsung Electronics", model: "WW90T" }],
    entities: [
      { entity_id: "sensor.samsung_machine_state", device_id: "st", translation_key: "washer_machine_state", state: "run" },
      { entity_id: "sensor.samsung_job_state", device_id: "st", translation_key: "washer_job_state", state: "rinse" },
      { entity_id: "sensor.samsung_completion_time", device_id: "st", translation_key: "washer_completion_time", state: iso(NOW + 12 * 60_000), attributes: { device_class: "timestamp" } },
      { entity_id: "sensor.samsung_power", device_id: "st", translation_key: "power", state: "320", attributes: { device_class: "power", unit_of_measurement: "W" } },
    ],
  });
  const [washer] = discoverAppliances(snap);
  assert.equal(washer.kind, "washer");
  assert.deepEqual(washer.entities, {
    status: "sensor.samsung_machine_state",
    phase: "sensor.samsung_job_state",
    end_time: "sensor.samsung_completion_time",
    power: "sensor.samsung_power",
  });
  const reading = applianceStatus(statesOf(snap, washer), { now: NOW });
  assert.deepEqual([reading.state, reading.phase, reading.remainingMinutes, reading.powerW], ["running", "rinse", 12, 320]);
});

test("SmartThinQ washer: run_state text and an h:mm remaining time", () => {
  const snap = snapshot({
    devices: [{ id: "thinq", name: "Washer", manufacturer: "LG", model: "F4V9RWP2E" }],
    entities: [
      { entity_id: "sensor.washer_run_state", device_id: "thinq", translation_key: "run_state", state: "Washing" },
      { entity_id: "sensor.washer_remain_time", device_id: "thinq", translation_key: "remain_time", state: "1:05" },
      { entity_id: "sensor.washer_current_course", device_id: "thinq", translation_key: "current_course", state: "Cotton+" },
      { entity_id: "binary_sensor.washer_door_open", device_id: "thinq", translation_key: "door_open", state: "off" },
    ],
  });
  const [washer] = discoverAppliances(snap);
  assert.equal(washer.entities.status, "sensor.washer_run_state");
  assert.equal(washer.entities.remaining, "sensor.washer_remain_time");
  assert.equal(washer.entities.program, "sensor.washer_current_course");
  assert.equal(washer.entities.door, "binary_sensor.washer_door_open");
  const reading = applianceStatus(statesOf(snap, washer), { now: NOW });
  assert.deepEqual([reading.state, reading.phase, reading.remainingMinutes, reading.program], ["running", "wash", 65, "Cotton+"]);
});

test("smart-plug fallback: a plug named after the appliance, or a generic plug whose power sensor is", () => {
  const snap = snapshot({
    devices: [
      { id: "plug1", name: "Opvaskemaskine stik", manufacturer: "Shelly", model: "Plug S" },
      { id: "plug2", name: "Stikkontakt 3", manufacturer: "Shelly", model: "Plug S" },
      { id: "plug3", name: "Kaffemaskine", manufacturer: "Shelly", model: "Plug S" },
    ],
    entities: [
      { entity_id: "sensor.opvaskemaskine_stik_power", device_id: "plug1", state: "1850", attributes: { device_class: "power", unit_of_measurement: "W" } },
      { entity_id: "sensor.opvaskemaskine_stik_energy_today", device_id: "plug1", state: "0.9", attributes: { device_class: "energy", unit_of_measurement: "kWh" } },
      { entity_id: "switch.opvaskemaskine_stik", device_id: "plug1", state: "on" },
      { entity_id: "sensor.stikkontakt_3_power", device_id: "plug2", name: "Tørretumbler effekt", state: "2", attributes: { device_class: "power", unit_of_measurement: "W" } },
      { entity_id: "sensor.kaffemaskine_power", device_id: "plug3", state: "1200", attributes: { device_class: "power", unit_of_measurement: "W" } },
    ],
  });
  const appliances = discoverAppliances(snap);
  assert.deepEqual(
    appliances.map((appliance) => [appliance.kind, appliance.source, appliance.entities.power]),
    [
      ["dryer", "power", "sensor.stikkontakt_3_power"],
      ["dishwasher", "power", "sensor.opvaskemaskine_stik_power"],
    ],
  );
  assert.equal(appliances[1].entities.energy, "sensor.opvaskemaskine_stik_energy_today");
  assert.equal(appliances[1].entities.switch, "switch.opvaskemaskine_stik");
  assert.equal(applianceStatus(statesOf(snap, appliances[1]), { now: NOW }).state, "running");

  // The plug's power sensor now stands for the dishwasher, not for home power.
  const home = discoverHome(snap);
  const kinds = Object.fromEntries(home.unassigned.map((capability) => [capability.entityId, capability.kind]));
  assert.equal(kinds["sensor.opvaskemaskine_stik_power"], "dishwasher");
  assert.equal(kinds["sensor.kaffemaskine_power"], "power");
});

test("one washer with a status and one washer plug are the same machine", () => {
  const snap = snapshot({
    devices: [...lgWasher.devices, { id: "plug", name: "Vaskemaskine stik" }],
    entities: [
      ...lgWasher.entities.map((entity) => ({ ...entity, ...lgWasher.states.find((state) => state.entity_id === entity.entity_id) })),
      { entity_id: "sensor.vaskemaskine_stik_power", device_id: "plug", state: "450", attributes: { device_class: "power", unit_of_measurement: "W" } },
    ],
  });
  const appliances = discoverAppliances(snap);
  assert.equal(appliances.length, 1);
  assert.equal(appliances[0].entities.power, "sensor.vaskemaskine_stik_power");
  assert.equal(appliances[0].entities.status, "sensor.vaskemaskine_current_status");
});

test("not appliances: a lamp named after the washer, a robot vacuum that washes its mop", () => {
  const snap = snapshot({
    devices: [
      { id: "hue", name: "Stort bad - vaskemaskine", manufacturer: "Signify", model: "Hue white spot" },
      { id: "dreame", name: "L50 Ultra", manufacturer: "Dreametech", model: "dreame.vacuum.r9493a" },
    ],
    entities: [
      { entity_id: "light.stort_bad_vaskemaskine", device_id: "hue", state: "off" },
      { entity_id: "vacuum.l50_ultra", device_id: "dreame", state: "docked" },
      { entity_id: "sensor.l50_ultra_self_wash_base_status", device_id: "dreame", translation_key: "self_wash_base_status", state: "idle" },
      { entity_id: "switch.l50_ultra_smart_mop_washing", device_id: "dreame", translation_key: "smart_mop_washing", state: "off" },
      { entity_id: "sensor.l50_ultra_drying_left", device_id: "dreame", translation_key: "drying_left", state: "0", attributes: { device_class: "duration", unit_of_measurement: "min" } },
    ],
  });
  assert.deepEqual(discoverAppliances(snap), []);
  const home = discoverHome(snap);
  assert.equal(home.appliances, undefined, "no appliances key at all");
  assert.equal(home.unassigned.find((capability) => capability.entityId === "switch.l50_ultra_smart_mop_washing").kind, "generic");
});

test("device-less helpers: a template status sensor and an input_boolean", () => {
  const snap = snapshot({
    entities: [
      { entity_id: "sensor.washing_machine_state", state: "Rinsing", attributes: { friendly_name: "Washing machine state" } },
      { entity_id: "input_boolean.dryer_running", state: "on", attributes: { friendly_name: "Dryer running" } },
    ],
  });
  const appliances = discoverAppliances(snap);
  assert.deepEqual(appliances.map((appliance) => [appliance.kind, appliance.name, appliance.entities.status]), [
    ["washer", "Washing machine", "sensor.washing_machine_state"],
    ["dryer", "Dryer", "input_boolean.dryer_running"],
  ]);
  assert.equal(applianceStatus(statesOf(snap, appliances[0]), { now: NOW }).phase, "rinse");
  assert.equal(applianceStatus(statesOf(snap, appliances[1]), { now: NOW }).state, "running");
});

// --- State logic ----------------------------------------------------------------

const status = (state, extra = {}) => ({ entity_id: "sensor.x_status", state, attributes: {}, last_changed: iso(NOW - 10 * 60_000), last_updated: iso(NOW), ...extra });
const power = (watts) => ({ entity_id: "sensor.x_power", state: String(watts), attributes: { device_class: "power", unit_of_measurement: "W" }, last_changed: iso(NOW), last_updated: iso(NOW) });

test("raw states across integrations normalise to running/paused/finished/error/idle/off", () => {
  const cases = {
    // LG ThinQ
    running: "running", rinsing: "running", spinning: "running", end: "finished", power_off: "off", initial: "idle", pause: "paused", error: "error",
    // Home Connect
    run: "running", finished: "finished", ready: "idle", inactive: "off", actionrequired: "paused",
    // Miele
    in_use: "running", program_ended: "finished", programmed: "idle", failure: "error", off: "off",
    // Electrolux / free text
    "End of cycle": "finished", "Ready to start": "idle", Running: "running", Washing: "running",
    // Danish
    "Kører": "running", "Færdig": "finished", Slukket: "off",
    unknown: "unavailable", unavailable: "unavailable", "": "unavailable",
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(normaliseApplianceState(raw).state, expected, raw);
  }
  assert.deepEqual(normaliseApplianceState("delayedstart"), { state: "idle", delayed: true });
  assert.deepEqual(normaliseApplianceState("reserved"), { state: "idle", delayed: true });
});

test("finished keeps the time it finished; idle, off and unavailable carry no times", () => {
  const finished = applianceStatus({ status: status("end"), remaining: status("0", { attributes: { unit_of_measurement: "min" } }) }, { now: NOW });
  assert.equal(finished.state, "finished");
  assert.equal(finished.endsAt.toISOString(), iso(NOW - 10 * 60_000));
  assert.equal(finished.remainingMinutes, undefined);

  for (const [raw, expected] of [["ready", "idle"], ["power_off", "off"], ["unavailable", "unavailable"]]) {
    const reading = applianceStatus({ status: status(raw), remaining: status("20", { attributes: { unit_of_measurement: "min" } }) }, { now: NOW });
    assert.equal(reading.state, expected);
    assert.equal(reading.endsAt, undefined);
    assert.equal(reading.remainingMinutes, undefined);
  }
});

test("remaining time: durations in min/h/s, clock text, timestamps; end time follows", () => {
  const remaining = (state, attributes) => applianceStatus({ status: status("run"), remaining: status(state, { attributes }) }, { now: NOW });
  assert.equal(remaining("1.5", { unit_of_measurement: "h" }).remainingMinutes, 90);
  assert.equal(remaining("600", { unit_of_measurement: "s" }).remainingMinutes, 10);
  assert.equal(remaining("01:20:00", {}).remainingMinutes, 80);
  const atTime = remaining(iso(NOW + 42 * 60_000), { device_class: "timestamp" });
  assert.equal(atTime.remainingMinutes, 42);
  assert.equal(atTime.endsAt.toISOString(), iso(NOW + 42 * 60_000));
  assert.equal(remaining("20", { unit_of_measurement: "min" }).endsAt.toISOString(), iso(NOW + 20 * 60_000));
});

test("a plug still drawing power turns 'finished' back into running; a switched-off plug is off", () => {
  assert.equal(applianceStatus({ status: status("finished"), power: power(900) }, { now: NOW }).state, "running");
  const off = applianceStatus({ power: power(0), switch: { ...power(0), entity_id: "switch.x", state: "off" } }, { now: NOW });
  assert.equal(off.state, "off");
});

test("plug only: running above the threshold, finished after the gap, idle later; unavailable without reading", () => {
  const running = applianceStatus({ power: power(1800) }, { now: NOW });
  assert.equal(running.state, "running");
  assert.equal(running.memory.lastActiveAt, NOW);

  // Soaking: a few quiet minutes are still the same cycle.
  const soaking = applianceStatus({ power: power(3) }, { now: NOW + PLUG_CYCLE_GAP_MS - 1000, memory: running.memory });
  assert.equal(soaking.state, "running");

  const finished = applianceStatus({ power: power(3) }, { now: NOW + PLUG_CYCLE_GAP_MS + 1000, memory: running.memory });
  assert.equal(finished.state, "finished");
  assert.equal(finished.endsAt.getTime(), NOW);

  const later = applianceStatus({ power: power(3) }, { now: NOW + PLUG_FINISHED_FOR_MS + 1000, memory: running.memory });
  assert.equal(later.state, "idle");

  assert.equal(applianceStatus({ power: power(3) }, { now: NOW }).state, "idle", "a fresh page does not invent a finished cycle");
  assert.equal(applianceStatus({ power: power(25) }, { now: NOW, thresholdW: 30 }).state, "idle", "threshold is configurable");
  assert.equal(applianceStatus({ power: { ...power(0), state: "unavailable" } }, { now: NOW }).state, "unavailable");
  assert.equal(applianceStatus({}, { now: NOW }).state, "unavailable");
});

test("kW plugs, energy in Wh, Home Connect program keys", () => {
  const reading = applianceStatus(
    { power: { ...power(1.2), attributes: { unit_of_measurement: "kW" } }, energy: { ...power(1250), attributes: { unit_of_measurement: "Wh" } } },
    { now: NOW },
  );
  assert.equal(reading.powerW, 1200);
  assert.equal(reading.energyTodayKwh, 1.25);
  assert.equal(programLabel("laundry_care_washer_program_cotton_eco"), "Cotton eco");
  assert.equal(programLabel("Bomuld 40°"), "Bomuld 40°");
});
