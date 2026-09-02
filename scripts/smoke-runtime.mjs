import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { planAndSaveDashboards } from "../packages/tooling/dist/index.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "homeframe-runtime-smoke-"));
const frameworkRoot = path.resolve(new URL("..", import.meta.url).pathname);

// Pick a free port ourselves: the server does `Number(env)` and calls
// `listen(port, host)` directly, so there is no "let the OS choose" mode we
// can ask it for and still know which port it bound.
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: chosen } = probe.address();
    probe.close(() => resolve(chosen));
  });
});

const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

let child;

try {
  const home = JSON.parse(
    await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"),
  );

  await planAndSaveDashboards(
    { home, targets: ["mobile"], namePrefix: "Runtime Smoke" },
    { dataDir, frameworkRoot },
  );

  const childEnv = {
    ...process.env,
    HOMEFRAME_DATA_DIR: dataDir,
    HOMEFRAME_ROOT: frameworkRoot,
    HOMEFRAME_HOST: host,
    HOMEFRAME_PORT: String(port),
  };
  // A developer's local .env may carry real Home Assistant credentials;
  // strip them so this smoke test always exercises the "disabled" path.
  delete childEnv.HOMEFRAME_HA_URL;
  delete childEnv.HOMEFRAME_HA_TOKEN;

  child = spawn(process.execPath, [path.join(frameworkRoot, "packages/runtime/dist/server.js")], {
    cwd: frameworkRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let childExited = false;
  let childExitInfo = "";
  child.once("exit", (code, signal) => {
    childExited = true;
    childExitInfo = `code=${code} signal=${signal}`;
  });

  const deadline = Date.now() + 10_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (childExited) {
      throw new Error(
        `runtime server exited before becoming ready (${childExitInfo})\nstderr:\n${stderr}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!ready) {
    throw new Error(`runtime server did not become ready within 10s\nstderr:\n${stderr}`);
  }

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: "homeframe-runtime",
    homeAssistant: "disabled",
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

  console.log("✓ runtime smoke test");
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(dataDir, { recursive: true, force: true });
}
