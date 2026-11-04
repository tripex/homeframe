// Tests for energy summaries and price parsing. Run `npm run build -w @homeframe/core` first.
//
// Dates are built with the local-time Date constructor so "today" means the
// same thing to the test and to summarizeEnergy, whatever TZ the runner uses.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  currencyFromPriceUnit,
  parsePriceSeries,
  parseStatisticPoint,
  priceUnitScale,
  summarizeEnergy,
} from "../dist/index.js";

const HOUR = 60 * 60 * 1000;
const now = new Date(2026, 9, 21, 14, 30); // a normal Wednesday afternoon, no DST change
const today = new Date(2026, 9, 21).getTime();
const yesterday = new Date(2026, 9, 20).getTime();

function hourly(dayStart, kwhPerHour, count = 24) {
  return Array.from({ length: count }, (_, index) => ({
    start: dayStart + index * HOUR,
    change: kwhPerHour,
    mean: null,
  }));
}

function priceSensor(attributes, state = "1.5") {
  return {
    entity_id: "sensor.price",
    state,
    attributes,
    last_changed: "",
    last_updated: "",
  };
}

test("statistics rows accept millisecond, second and ISO timestamps", () => {
  const iso = new Date(today).toISOString();
  assert.equal(parseStatisticPoint({ start: today, change: 1 }).start, today);
  assert.equal(parseStatisticPoint({ start: today / 1000, change: 1 }).start, today);
  assert.equal(parseStatisticPoint({ start: iso, change: "0.5" }).change, 0.5);
  assert.equal(parseStatisticPoint({ change: 1 }), undefined);
});

test("sub-unit price units are scaled to the main currency", () => {
  assert.equal(priceUnitScale("øre/kWh"), 0.01);
  assert.equal(priceUnitScale("ct/kWh"), 0.01);
  assert.equal(priceUnitScale("DKK/kWh"), 1);
  assert.equal(priceUnitScale(undefined), 1);
});

test("Energi Data Service and Nord Pool price lists both parse", () => {
  const eds = parsePriceSeries(
    priceSensor({
      unit_of_measurement: "DKK/kWh",
      raw_today: [
        { hour: new Date(today).toISOString(), price: 1 },
        { hour: new Date(today + HOUR).toISOString(), price: 2 },
      ],
    }),
  );
  assert.equal(eds.points.length, 2);
  assert.equal(eds.points[0].end, today + HOUR);
  assert.equal(eds.points[1].end, today + 2 * HOUR);

  const nordPool = parsePriceSeries(
    priceSensor({
      unit_of_measurement: "øre/kWh",
      current_price: 150,
      raw_today: [{ start: new Date(today).toISOString(), end: new Date(today + HOUR).toISOString(), value: 100 }],
    }),
  );
  assert.equal(nordPool.points[0].price, 1);
  assert.equal(nordPool.current, 1.5);
});

test("a flat tariff prices every period", () => {
  const summary = summarizeEnergy({
    now,
    source: "change",
    hourly: [...hourly(yesterday, 0.5), ...hourly(today, 1, 14)],
    monthly: [{ start: new Date(2026, 8, 1).getTime(), change: 300 }, { start: new Date(2026, 9, 1).getTime(), change: 200 }],
    tariff: 2,
  });

  assert.equal(summary.pricing, "flat");
  assert.equal(summary.hours.length, 24);
  assert.equal(summary.todayKwh, 14);
  assert.equal(summary.todayCost, 28);
  assert.equal(summary.yesterdayKwh, 12);
  assert.equal(summary.yesterdayCost, 24);
  assert.equal(summary.monthKwh, 200);
  assert.equal(summary.yearKwh, 500);
  assert.equal(summary.yearCost, 1000);
  assert.equal(summary.currentPrice, 2);
});

test("future hours carry prices but no consumption", () => {
  const summary = summarizeEnergy({ now, source: "change", hourly: hourly(today, 1, 24), tariff: 1 });
  assert.equal(summary.hours[20].kwh, undefined);
  assert.equal(summary.hours[20].price, 1);
  assert.equal(summary.todayKwh, 15);
});

test("dynamic prices cost each hour at its own price and add the surcharge", () => {
  // 15-minute prices: the first hour averages 1.0, every other hour is 3.0.
  const quarter = HOUR / 4;
  const raw_today = Array.from({ length: 96 }, (_, index) => ({
    start: new Date(today + index * quarter).toISOString(),
    end: new Date(today + (index + 1) * quarter).toISOString(),
    value: index < 4 ? [0.5, 1, 1, 1.5][index] : 3,
  }));

  const summary = summarizeEnergy({
    now,
    source: "change",
    hourly: hourly(today, 2, 14),
    prices: parsePriceSeries(priceSensor({ unit_of_measurement: "DKK/kWh", raw_today })),
    surcharge: 0.5,
  });

  assert.equal(summary.pricing, "dynamic");
  assert.equal(summary.hours[0].price, 1.5);
  assert.equal(summary.hours[0].cost, 3);
  assert.equal(summary.hours[1].cost, 7);
  // 3 kr + 13 hours × 7 kr
  assert.equal(summary.todayCost, 94);
  assert.equal(summary.currentPrice, 3.5);
  // Yesterday's dynamic cost is unknown and must not be guessed.
  assert.equal(summary.yesterdayCost, undefined);
  assert.equal(summary.monthCost, undefined);
});

test("the cheapest upcoming price ignores hours that have passed", () => {
  const raw_today = Array.from({ length: 24 }, (_, hour) => ({
    hour: new Date(today + hour * HOUR).toISOString(),
    price: hour === 3 ? 0.1 : hour === 22 ? 0.4 : 1,
  }));
  const summary = summarizeEnergy({
    now,
    source: "change",
    hourly: [],
    prices: parsePriceSeries(priceSensor({ unit_of_measurement: "DKK/kWh", raw_today })),
  });
  assert.equal(summary.cheapestUpcoming.start, today + 22 * HOUR);
  assert.equal(summary.cheapestUpcoming.price, 0.4);
});

test("the running hour comes from 5-minute statistics without double counting", () => {
  const runningHour = today + 14 * HOUR;
  const recent = Array.from({ length: 6 }, (_, index) => ({
    start: runningHour + index * 5 * 60 * 1000,
    change: 0.1,
    mean: null,
  }));

  const summary = summarizeEnergy({
    now,
    source: "change",
    hourly: hourly(today, 1, 14),
    // A stray 5-minute row inside an already-compiled hour must be ignored.
    recent: [...recent, { start: today + 2 * HOUR, change: 99, mean: null }],
  });

  assert.equal(summary.hours[14].kwh, 0.6);
  assert.equal(summary.hours[2].kwh, 1);
  assert.equal(summary.todayKwh, 14.6);
  assert.equal(summary.pricing, "none");
  assert.equal(summary.todayCost, undefined);
});

test("a power sensor's hourly mean becomes kWh", () => {
  const summary = summarizeEnergy({
    now,
    source: "mean-watts",
    hourly: [{ start: today, change: null, mean: 1500 }],
  });
  assert.equal(summary.hours[0].kwh, 1.5);
});

test("currencies are inferred from price units without guessing ambiguous ones", () => {
  assert.deepEqual(currencyFromPriceUnit("DKK/kWh"), { code: "DKK" });
  assert.deepEqual(currencyFromPriceUnit("øre/kWh"), { code: "DKK" });
  assert.deepEqual(currencyFromPriceUnit("€/kWh"), { code: "EUR" });
  assert.deepEqual(currencyFromPriceUnit("kr/kWh"), { label: "kr" });
  assert.deepEqual(currencyFromPriceUnit(undefined), {});
});

test("a day cost is withheld when a consumed hour has no price", () => {
  const raw_today = [{ hour: new Date(today + HOUR).toISOString(), price: 2 }];
  const summary = summarizeEnergy({
    now,
    source: "change",
    hourly: [
      { start: today, change: 10, mean: null },
      { start: today + HOUR, change: 10, mean: null },
    ],
    prices: parsePriceSeries(priceSensor({ unit_of_measurement: "DKK/kWh", raw_today })),
  });

  assert.equal(summary.hours[1].cost, 20);
  assert.equal(summary.hours[0].cost, undefined);
  assert.equal(summary.todayCost, undefined);
});
