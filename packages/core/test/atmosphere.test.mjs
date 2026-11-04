// Tests for the ambient sky model. Run `npm run build -w @homeframe/core` first.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveAtmosphere } from "../dist/index.js";

function state(entity_id, value, attributes = {}) {
  return {
    entity_id,
    state: value,
    attributes,
    last_changed: "2026-10-25T12:00:00Z",
    last_updated: "2026-10-25T12:00:00Z",
  };
}

const now = new Date("2026-10-25T12:00:00Z");

function sun({ elevation, above, rising, nextRising, nextSetting }) {
  return state("sun.sun", above ? "above_horizon" : "below_horizon", {
    elevation,
    rising,
    next_rising: nextRising,
    next_setting: nextSetting,
  });
}

test("a high sun is day, halfway along its arc", () => {
  const atmosphere = deriveAtmosphere({
    now,
    sun: sun({
      elevation: 22,
      above: true,
      rising: false,
      // Sunrise 06:00 and sunset 18:00 UTC, so 12:00 is the middle of the arc.
      nextRising: "2026-10-26T06:00:00Z",
      nextSetting: "2026-10-25T18:00:00Z",
    }),
  });

  assert.equal(atmosphere.phase, "day");
  assert.equal(atmosphere.source, "sun-entity");
  assert.ok(Math.abs(atmosphere.arcProgress - 0.5) < 0.01);
  assert.equal(atmosphere.daylight, 1);
});

test("civil twilight is dawn while rising and dusk while setting", () => {
  const base = {
    above: false,
    nextRising: "2026-10-26T06:00:00Z",
    nextSetting: "2026-10-26T18:00:00Z",
  };
  assert.equal(deriveAtmosphere({ now, sun: sun({ ...base, elevation: -3, rising: true }) }).phase, "dawn");
  assert.equal(deriveAtmosphere({ now, sun: sun({ ...base, elevation: -3, rising: false }) }).phase, "dusk");
  assert.equal(deriveAtmosphere({ now, sun: sun({ ...base, elevation: -12, rising: false }) }).phase, "night");
});

test("night has no daylight", () => {
  const atmosphere = deriveAtmosphere({
    now,
    sun: sun({
      elevation: -30,
      above: false,
      rising: false,
      nextRising: "2026-10-26T06:00:00Z",
      nextSetting: "2026-10-26T18:00:00Z",
    }),
  });
  assert.equal(atmosphere.daylight, 0);
});

test("a sun entity without the needed attributes falls back to the clock", () => {
  const atmosphere = deriveAtmosphere({ now, sun: state("sun.sun", "above_horizon") });
  assert.equal(atmosphere.source, "clock");
});

test("weather conditions map to precipitation and cloud cover", () => {
  const rain = deriveAtmosphere({
    now,
    weather: state("weather.home", "pouring", { temperature: 9.5, temperature_unit: "°C" }),
  });
  assert.equal(rain.weather, "heavy-rain");
  assert.equal(rain.precipitation, 1);
  assert.equal(rain.temperature, 9.5);
  assert.equal(rain.temperatureUnit, "°C");
  assert.equal(rain.condition, "pouring");

  assert.equal(deriveAtmosphere({ now, weather: state("weather.home", "lightning-rainy") }).weather, "storm");
  assert.equal(deriveAtmosphere({ now, weather: state("weather.home", "snowy-rainy") }).weather, "sleet");
});

test("unknown or missing weather is a calm clear sky", () => {
  const unavailable = deriveAtmosphere({ now, weather: state("weather.home", "unavailable") });
  assert.equal(unavailable.weather, "clear");
  assert.equal(unavailable.condition, undefined);
  assert.equal(deriveAtmosphere({ now }).precipitation, 0);
});
