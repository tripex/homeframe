import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverHome, parseCalendarResponse, parseForecastResponse } from "../dist/index.js";

test("daily forecasts are read for the requested weather entity only", () => {
  const response = {
    "weather.home": {
      forecast: [
        { datetime: "2026-11-04T11:00:00+00:00", condition: "rainy", temperature: 9.4, templow: 4, precipitation_probability: 80 },
        { condition: "sunny" },
        { datetime: "2026-11-05T11:00:00+00:00", condition: "sunny", temperature: "11", templow: null },
      ],
    },
    "weather.other": { forecast: [{ datetime: "x", condition: "snowy" }] },
  };

  assert.deepEqual(parseForecastResponse(response, "weather.home"), [
    { date: "2026-11-04T11:00:00+00:00", condition: "rainy", high: 9.4, low: 4, precipitation: undefined, precipitationProbability: 80 },
    { date: "2026-11-05T11:00:00+00:00", condition: "sunny", high: 11, low: undefined, precipitation: undefined, precipitationProbability: undefined },
  ]);
  assert.deepEqual(parseForecastResponse({}, "weather.home"), []);
  assert.deepEqual(parseForecastResponse(null, "weather.home"), []);
});

test("calendar events from several calendars are merged and sorted, all-day first", () => {
  const events = parseCalendarResponse({
    "calendar.family": {
      events: [
        { start: "2026-11-05T16:30:00+01:00", end: "2026-11-05T17:30:00+01:00", summary: "Football" },
        { start: "2026-11-04T08:00:00+01:00", end: "2026-11-04T09:00:00+01:00", summary: "Dentist", location: "Town" },
      ],
    },
    "calendar.waste": { events: [{ start: "2026-11-05", end: "2026-11-06", summary: "Bins" }, { summary: "broken" }] },
  });

  assert.deepEqual(
    events.map((event) => [event.calendar, event.summary, event.allDay]),
    [
      ["calendar.family", "Dentist", false],
      ["calendar.waste", "Bins", true],
      ["calendar.family", "Football", false],
    ],
  );
  assert.equal(events[0].location, "Town");
});

test("cameras, calendars and people are discovered by domain; vacuum maps are not cameras", () => {
  const entity = (entity_id) => ({ entity_id, area_id: null, device_id: null, name: null });
  const state = (entity_id) => ({ entity_id, state: "idle", attributes: {}, last_changed: "", last_updated: "" });
  const ids = ["camera.doorbell", "calendar.family", "person.anna", "camera.l50_ultra_map", "camera.robot_map_1"];
  const home = discoverHome({ areas: [], devices: [], entities: ids.map(entity), states: ids.map(state) });

  assert.deepEqual(
    home.unassigned.map((capability) => [capability.entityId, capability.kind]),
    [
      ["camera.doorbell", "camera"],
      ["calendar.family", "calendar"],
      ["person.anna", "person"],
      ["camera.l50_ultra_map", "generic"],
      ["camera.robot_map_1", "generic"],
    ],
  );
});

test("sun and weather without a registry entry are still discovered", () => {
  const state = (entity_id) => ({ entity_id, state: "above_horizon", attributes: {}, last_changed: "", last_updated: "" });
  const home = discoverHome({
    areas: [],
    devices: [],
    entities: [],
    states: [state("sun.sun"), state("weather.home"), state("sensor.unregistered_temperature")],
  });
  assert.deepEqual(
    home.unassigned.map((capability) => [capability.entityId, capability.kind]),
    [
      ["sun.sun", "sun"],
      ["weather.home", "weather"],
    ],
  );
});
