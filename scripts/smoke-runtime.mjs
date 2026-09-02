import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { planAndSaveDashboards } from "../packages/tooling/dist/index.js";


/**
 * Boot one runtime process and wait until /api/health answers.
 * Returns the child so the caller can stop it.
 */
async function startRuntime({ dataDir, frameworkRoot, host, port, extraEnv = {} }) {
  const childEnv = {
    ...process.env,
    HOMEFRAME_DATA_DIR: dataDir,
    HOMEFRAME_ROOT: frameworkRoot,
    HOMEFRAME_HOST: host,
    HOMEFRAME_PORT: String(port),
    ...extraEnv,
  };
  // A developer's local .env may carry real Home Assistant credentials;
  // strip them so this smoke test always exercises the "disabled" path.
  delete childEnv.HOMEFRAME_HA_URL;
  delete childEnv.HOMEFRAME_HA_TOKEN;

  const runtime = spawn(
    process.execPath,
    [path.join(frameworkRoot, "packages/runtime/dist/server.js")],
    { cwd: frameworkRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  runtime.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let exitInfo;
  runtime.once("exit", (code, signal) => {
    exitInfo = `code=${code} signal=${signal}`;
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (exitInfo) {
      throw new Error(
        `runtime server exited before becoming ready (${exitInfo})\nstderr:\n${stderr}`,
      );
    }
    try {
      const response = await fetch(`http://${host}:${port}/api/health`);
      if (response.ok) return runtime;
    } catch {
      // Server not accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`runtime server did not become ready within 10s\nstderr:\n${stderr}`);
}

async function stopRuntime(runtime) {
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return;

  runtime.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => runtime.kill("SIGKILL"), 3000);
    runtime.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: chosen } = probe.address();
      probe.close(() => resolve(chosen));
    });
  });
}

async function postAction(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "homeframe-runtime-smoke-"));
const frameworkRoot = path.resolve(new URL("..", import.meta.url).pathname);

// Pick a free port ourselves: the server does `Number(env)` and calls
// `listen(port, host)` directly, so there is no "let the OS choose" mode we
// can ask it for and still know which port it bound.
const port = await freePort();

const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

let child;
let controlChild;

try {
  const home = JSON.parse(
    await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"),
  );

  await planAndSaveDashboards(
    { home, targets: ["mobile"], namePrefix: "Runtime Smoke" },
    { dataDir, frameworkRoot },
  );

  child = await startRuntime({ dataDir, frameworkRoot, host, port });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: "homeframe-runtime",
    homeAssistant: "disabled",
    controlActions: "disabled",
  });

  const mobileList = await fetch(`${baseUrl}/api/dashboards?profile=mobile`);
  assert.equal(mobileList.status, 200);
  const mobileDashboards = await mobileList.json();
  assert.equal(mobileDashboards.length, 1);
  assert.equal(mobileDashboards[0].id, "runtime-smoke-mobile");
  assert.equal(mobileDashboards[0].target.profile, "mobile");

  const single = await fetch(`${baseUrl}/api/dashboards/runtime-smoke-mobile`);
  assert.equal(single.status, 200);
  assert.equal((await single.json()).id, "runtime-smoke-mobile");

  const missing = await fetch(`${baseUrl}/api/dashboards/does-not-exist`);
  assert.equal(missing.status, 404);

  const writeAttempt = await fetch(`${baseUrl}/api/dashboards`, { method: "POST" });
  assert.equal(writeAttempt.status, 405);

  const haSnapshot = await fetch(`${baseUrl}/api/ha/snapshot`);
  assert.equal(haSnapshot.status, 200);
  assert.equal((await haSnapshot.json()).status, "disabled");

  // Card actions. The demo snapshot plans a room card with lights and a
  // security card with a lock, which covers both risk levels.
  const dashboardId = "runtime-smoke-mobile";
  const room = mobileDashboards[0].cards.find((card) => card.card === "room");
  const security = mobileDashboards[0].cards.find((card) => card.card === "security");
  assert.ok(room && security);

  const disabled = await postAction(baseUrl, {
    dashboardId,
    instanceId: room.instanceId,
    actionId: "toggle-lights",
  });
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.reason, "control-disabled");
  assert.equal(disabled.body.risk, "control");

  const securityRefused = await postAction(baseUrl, {
    dashboardId,
    instanceId: security.instanceId,
    actionId: "change-security-state",
  });
  assert.equal(securityRefused.status, 403);
  assert.equal(securityRefused.body.reason, "security-approval-required");

  const unknownInstance = await postAction(baseUrl, {
    dashboardId,
    instanceId: "nope",
    actionId: "toggle-lights",
  });
  assert.equal(unknownInstance.status, 404);
  assert.equal(unknownInstance.body.reason, "unknown-card-instance");

  const unknownAction = await postAction(baseUrl, {
    dashboardId,
    instanceId: room.instanceId,
    actionId: "launch-rocket",
  });
  assert.equal(unknownAction.status, 404);
  assert.equal(unknownAction.body.reason, "unknown-action");

  const unknownDashboard = await postAction(baseUrl, {
    dashboardId: "missing",
    instanceId: room.instanceId,
    actionId: "toggle-lights",
  });
  assert.equal(unknownDashboard.status, 404);
  assert.equal(unknownDashboard.body.reason, "unknown-dashboard");

  const malformed = await postAction(baseUrl, "{not json");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.reason, "invalid-request");

  const missingFields = await postAction(baseUrl, { dashboardId });
  assert.equal(missingFields.status, 400);
  assert.equal(missingFields.body.reason, "invalid-request");

  // With control enabled but no Home Assistant, resolution still succeeds and
  // the runtime reports the missing connection instead of pretending.
  const controlPort = await freePort();
  const controlUrl = `http://${host}:${controlPort}`;
  controlChild = await startRuntime({
    dataDir,
    frameworkRoot,
    host,
    port: controlPort,
    extraEnv: { HOMEFRAME_ALLOW_CONTROL: "true" },
  });

  const controlHealth = await (await fetch(`${controlUrl}/api/health`)).json();
  assert.equal(controlHealth.controlActions, "enabled");

  const unavailable = await postAction(controlUrl, {
    dashboardId,
    instanceId: room.instanceId,
    actionId: "toggle-lights",
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.reason, "home-assistant-unavailable");

  const stillRefused = await postAction(controlUrl, {
    dashboardId,
    instanceId: security.instanceId,
    actionId: "change-security-state",
  });
  assert.equal(stillRefused.status, 403);
  assert.equal(stillRefused.body.reason, "security-approval-required");

  console.log("✓ runtime smoke test");
} finally {
  await stopRuntime(child);
  await stopRuntime(controlChild);
  await rm(dataDir, { recursive: true, force: true });
}
