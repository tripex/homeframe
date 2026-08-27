import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getDashboard,
  listDashboards,
  planAndSaveDashboards,
  setBinding,
} from "../packages/tooling/dist/index.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "homeframe-smoke-"));
const frameworkRoot = path.resolve(new URL("..", import.meta.url).pathname);

try {
  const home = JSON.parse(
    await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"),
  );

  const options = { dataDir, frameworkRoot };
  const created = await planAndSaveDashboards(
    {
      home,
      targets: ["tablet-10", "nest-hub", "mobile"],
      namePrefix: "Smoke Home",
    },
    options,
  );

  assert.equal(created.length, 3);
  assert.deepEqual(
    created.map((dashboard) => dashboard.target.profile),
    ["tablet-10", "nest-hub", "mobile"],
  );
  assert.ok(created[0].cards.some((card) => card.card === "vacuum"));
  assert.ok(created[0].cards.some((card) => card.card === "security"));

  const saved = await listDashboards(options);
  assert.equal(saved.length, 3);

  const mobile = saved.find((dashboard) => dashboard.target.profile === "mobile");
  assert.ok(mobile);
  assert.ok(mobile.cards.every((card) => card.layout?.w === 4));

  const room = mobile.cards.find((card) => card.card === "room");
  assert.ok(room);
  await setBinding(
    mobile.id,
    room.instanceId,
    "temperature",
    "sensor.rebound_temperature",
    options,
  );

  const rebound = await getDashboard(mobile.id, options);
  assert.equal(
    rebound?.cards.find((card) => card.instanceId === room.instanceId)?.bindings?.temperature,
    "sensor.rebound_temperature",
  );

  console.log("✓ dashboard engine smoke test");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
