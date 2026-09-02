import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CardActionError, resolveCardAction } from "../dist/index.js";

const frameworkRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

function state(entityId, value) {
  return [entityId, { entity_id: entityId, state: value, attributes: {}, last_changed: "", last_updated: "" }];
}

const dashboard = {
  schemaVersion: "2",
  id: "test",
  name: "Test",
  target: { profile: "mobile", columns: 4 },
  cards: [
    {
      instanceId: "room-kitchen",
      card: "room",
      bindings: { light: ["light.kitchen_ceiling", "light.kitchen_lamp"] },
    },
    { instanceId: "room-empty", card: "room", bindings: {} },
    {
      instanceId: "climate-overview",
      card: "climate",
      bindings: { climate: ["climate.kitchen", "climate.living_room"] },
    },
    { instanceId: "climate-single", card: "climate", bindings: { climate: "climate.kitchen" } },
    { instanceId: "vacuum-overview", card: "vacuum", bindings: { vacuum: "vacuum.robot" } },
    { instanceId: "washer-overview", card: "appliance", bindings: { washer: "sensor.washer" } },
    { instanceId: "security-overview", card: "security", bindings: { lock: "lock.front_door" } },
  ],
};

async function rejectsWith(promise, status, reason) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CardActionError, `expected CardActionError, got ${error}`);
    assert.equal(error.status, status);
    assert.equal(error.reason, reason);
    return true;
  });
}

function resolve(instanceId, actionId, input, states = new Map()) {
  return resolveCardAction(dashboard, { instanceId, actionId, input }, states, frameworkRoot);
}

test("room toggle turns lights off when any bound light is on", async () => {
  const states = new Map([state("light.kitchen_ceiling", "off"), state("light.kitchen_lamp", "on")]);
  const resolved = await resolve("room-kitchen", "toggle-lights", undefined, states);

  assert.equal(resolved.risk, "control");
  assert.deepEqual(resolved.call, {
    domain: "light",
    service: "turn_off",
    target: { entity_id: ["light.kitchen_ceiling", "light.kitchen_lamp"] },
  });
});

test("room toggle turns lights on when all are off or unknown", async () => {
  const resolved = await resolve("room-kitchen", "toggle-lights");
  assert.equal(resolved.call.service, "turn_on");
});

test("room toggle without bound lights is a client error", async () => {
  await rejectsWith(resolve("room-empty", "toggle-lights"), 400, "no-bound-entities");
});

test("climate set-temperature needs an explicit entity when several are bound", async () => {
  await rejectsWith(
    resolve("climate-overview", "set-temperature", { temperature: 21 }),
    400,
    "invalid-input",
  );

  const resolved = await resolve("climate-overview", "set-temperature", {
    entityId: "climate.living_room",
    temperature: 21.5,
  });
  assert.deepEqual(resolved.call, {
    domain: "climate",
    service: "set_temperature",
    serviceData: { temperature: 21.5 },
    target: { entity_id: "climate.living_room" },
  });
});

test("climate set-temperature refuses entities outside the binding", async () => {
  await rejectsWith(
    resolve("climate-single", "set-temperature", { entityId: "climate.garage", temperature: 20 }),
    400,
    "entity-not-bound",
  );
});

test("climate set-temperature requires a finite temperature", async () => {
  await rejectsWith(resolve("climate-single", "set-temperature", {}), 400, "invalid-input");
  await rejectsWith(
    resolve("climate-single", "set-temperature", { temperature: Number.NaN }),
    400,
    "invalid-input",
  );
});

test("vacuum start-pause depends on the current state", async () => {
  const idle = await resolve("vacuum-overview", "start-pause");
  assert.equal(idle.call.service, "start");

  const cleaning = await resolve(
    "vacuum-overview",
    "start-pause",
    undefined,
    new Map([state("vacuum.robot", "cleaning")]),
  );
  assert.equal(cleaning.call.service, "pause");

  const home = await resolve("vacuum-overview", "return-home");
  assert.deepEqual(home.call, {
    domain: "vacuum",
    service: "return_to_base",
    target: { entity_id: "vacuum.robot" },
  });
});

test("appliance start-stop is declared but not executable yet", async () => {
  await rejectsWith(resolve("washer-overview", "start-stop"), 400, "unsupported-action");
});

test("security actions are refused before any service mapping", async () => {
  await rejectsWith(
    resolve("security-overview", "change-security-state"),
    403,
    "security-approval-required",
  );
});

test("unknown instances and actions are not found", async () => {
  await rejectsWith(resolve("nope", "toggle-lights"), 404, "unknown-card-instance");
  await rejectsWith(resolve("room-kitchen", "launch-rocket"), 404, "unknown-action");
});
