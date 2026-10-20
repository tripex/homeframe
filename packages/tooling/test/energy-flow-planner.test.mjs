// Planner behaviour for the energy-flow card. Imports compiled output; run
// `npm run build` first (same convention as the other tooling tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { getCard, planDashboards, validateDashboard } from "../dist/index.js";

const frameworkRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("a grid meter or solar sensor plans the energy-flow card instead of energy", async () => {
  const [tablet, mobile] = planDashboards({
    home: {
      name: "Flow Home",
      areas: [],
      capabilities: {
        grid_power: ["sensor.grid"],
        solar_power: ["sensor.solar"],
        power: ["sensor.house"],
        electricity_price: ["sensor.spot"],
      },
    },
    targets: ["tablet-10", "mobile"],
  });

  const flow = tablet.cards.find((card) => card.card === "energy-flow");
  assert.ok(flow, "energy-flow card planned");
  assert.ok(!tablet.cards.some((card) => card.card === "energy"));
  assert.deepEqual(flow.bindings, {
    solar_power: "sensor.solar",
    grid_power: "sensor.grid",
    power: "sensor.house",
    electricity_price: "sensor.spot",
  });
  assert.equal(flow.layout.w, 6);

  const mobileFlow = mobile.cards.find((card) => card.card === "energy-flow");
  assert.equal(mobileFlow.layout.w, 4, "full width on mobile");

  assert.ok(await getCard("energy-flow", frameworkRoot), "card is in the catalog");
  assert.deepEqual((await validateDashboard(tablet, frameworkRoot)).errors, []);
});

test("a plain whole-home power sensor still plans the compact energy card", () => {
  const [tablet] = planDashboards({
    home: { areas: [], capabilities: { power: ["sensor.house"] } },
    targets: ["tablet-10"],
  });
  assert.ok(tablet.cards.some((card) => card.card === "energy"));
  assert.ok(!tablet.cards.some((card) => card.card === "energy-flow"));
});
