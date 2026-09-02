#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  homeSnapshotFromSemanticHome,
  loadHomeSnapshot,
  planDashboards,
} from "../packages/tooling/dist/index.js";

function capability(kind, entityId, extra = {}) {
  return {
    kind,
    entityId,
    label: entityId,
    domain: entityId.split(".")[0],
    score: kind === "generic" ? 10 : 70,
    ...extra,
  };
}

/** A small SemanticHome as `discoverHome` would produce it, used by both halves of this test. */
function fixtureSemanticHome() {
  return {
    areas: [
      {
        id: "living-room",
        name: "Living room",
        capabilities: [
          capability("temperature", "sensor.living_room_temperature"),
          capability("light", "light.living_room_main"),
          capability("light", "light.living_room_lamp"),
          capability("climate", "climate.living_room"),
          capability("generic", "sensor.living_room_uptime"),
        ],
      },
      {
        id: "entrance",
        name: "Entrance",
        capabilities: [
          capability("lock", "lock.front_door"),
          capability("garage", "cover.garage_door"),
          capability("alarm", "alarm_control_panel.home"),
        ],
      },
      {
        id: "attic",
        name: "Attic",
        capabilities: [capability("generic", "sensor.attic_uptime")],
      },
    ],
    unassigned: [
      capability("power", "sensor.home_power"),
      capability("vacuum", "vacuum.robot"),
      capability("generic", "sensor.internet_uptime"),
    ],
  };
}

// --- homeSnapshotFromSemanticHome -----------------------------------------

{
  const snapshot = homeSnapshotFromSemanticHome(fixtureSemanticHome());

  assert.equal(snapshot.name, "Home");
  assert.equal(snapshot.areas.length, 2, "the generic-only attic must be dropped");
  assert.ok(!snapshot.areas.some((area) => area.id === "attic"));

  const livingRoom = snapshot.areas.find((area) => area.id === "living-room");
  assert.ok(livingRoom);
  assert.deepEqual(livingRoom.capabilities.temperature, ["sensor.living_room_temperature"]);
  assert.deepEqual(livingRoom.capabilities.light, [
    "light.living_room_main",
    "light.living_room_lamp",
  ]);
  assert.deepEqual(livingRoom.capabilities.climate, ["climate.living_room"]);
  assert.ok(!("generic" in livingRoom.capabilities), "generic capabilities must be skipped");

  const entrance = snapshot.areas.find((area) => area.id === "entrance");
  assert.ok(entrance);
  assert.deepEqual(entrance.capabilities.lock, ["lock.front_door"], "entrance keeps its lock");
  assert.deepEqual(entrance.capabilities.garage, ["cover.garage_door"]);
  assert.deepEqual(entrance.capabilities.alarm, ["alarm_control_panel.home"]);

  assert.deepEqual(snapshot.capabilities.power, ["sensor.home_power"]);
  assert.deepEqual(snapshot.capabilities.vacuum, ["vacuum.robot"]);
  assert.deepEqual(snapshot.capabilities.lock, ["lock.front_door"], "promoted from the area");
  assert.deepEqual(snapshot.capabilities.garage, ["cover.garage_door"], "promoted from the area");
  assert.deepEqual(
    snapshot.capabilities.alarm,
    ["alarm_control_panel.home"],
    "promoted from the area",
  );
  assert.ok(!("temperature" in snapshot.capabilities), "room-only kinds stay out of the global map");
  assert.ok(!("light" in snapshot.capabilities), "room-only kinds stay out of the global map");
  assert.ok(!("generic" in snapshot.capabilities));

  const named = homeSnapshotFromSemanticHome(fixtureSemanticHome(), "Smoke Home");
  assert.equal(named.name, "Smoke Home");

  const [plan] = planDashboards({ home: snapshot, targets: ["tablet-10"] });
  const security = plan.cards.find((card) => card.card === "security");
  assert.ok(security, "security card expected from lock/alarm/garage");
  assert.deepEqual(Object.keys(security.bindings).sort(), ["alarm", "garage", "lock"]);
  assert.ok(plan.cards.some((card) => card.card === "vacuum"), "vacuum card expected");
}

// --- loadHomeSnapshot against a fake Homeframe Runtime ---------------------

async function withFakeRuntime(respond, run) {
  const server = createServer((request, response) => {
    if (request.url === "/api/ha/snapshot") {
      const body = JSON.stringify(respond());
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await withFakeRuntime(
  () => ({ status: "connected", states: [], semanticHome: fixtureSemanticHome() }),
  async (runtimeUrl) => {
    const snapshot = await loadHomeSnapshot({ runtimeUrl });
    assert.deepEqual(snapshot, homeSnapshotFromSemanticHome(fixtureSemanticHome()));
  },
);

await withFakeRuntime(
  () => ({ status: "disabled" }),
  async (runtimeUrl) => {
    await assert.rejects(() => loadHomeSnapshot({ runtimeUrl }), /not connected/);
  },
);

console.log("✓ home snapshot smoke test");
