import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  autoDashboardName,
  bootstrapPlan,
  isAllowedIngressClient,
  readSeeded,
  resolveConnection,
  writeSeeded,
} from "../dist/config.js";

test("an add-on connects through the Supervisor proxy with its own token", () => {
  assert.deepEqual(resolveConnection({ SUPERVISOR_TOKEN: "abc" }), {
    mode: "supervisor",
    baseUrl: "http://supervisor/core",
    websocketUrl: "ws://supervisor/core/websocket",
    restUrl: "http://supervisor/core/api",
    token: "abc",
  });
});

test("an explicit Home Assistant URL and token win over the Supervisor", () => {
  const connection = resolveConnection({
    SUPERVISOR_TOKEN: "abc",
    HOMEFRAME_HA_URL: "https://ha.example.com:8123/",
    HOMEFRAME_HA_TOKEN: "long-lived",
  });
  assert.equal(connection.mode, "direct");
  assert.equal(connection.websocketUrl, "wss://ha.example.com:8123/api/websocket");
  assert.equal(connection.restUrl, "https://ha.example.com:8123/api");
});

test("without credentials the runtime runs without Home Assistant", () => {
  assert.deepEqual(resolveConnection({ HOMEFRAME_HA_URL: "http://ha.local:8123" }), { mode: "none" });
});

test("only the ingress proxy and loopback may reach an add-on", () => {
  assert.equal(isAllowedIngressClient("172.30.32.2"), true);
  assert.equal(isAllowedIngressClient("::ffff:172.30.32.2"), true);
  assert.equal(isAllowedIngressClient("127.0.0.1"), true);
  assert.equal(isAllowedIngressClient("172.30.32.1"), false);
  assert.equal(isAllowedIngressClient("192.168.1.20"), false);
  assert.equal(isAllowedIngressClient(undefined), false);
});

const plan = (dashboards, options) => bootstrapPlan(dashboards, options).map((step) => `${step.action} ${step.id}<-${step.template}`);
const tablet = { id: "home-tablet", generatedBy: "homeframe-template:home-tablet" };
const desktop = { id: "home-desktop", generatedBy: "homeframe-template:home-desktop" };

test("the first start creates the tablet and the desktop dashboard", () => {
  assert.deepEqual(plan([], { regenerate: false }), ["create home-tablet<-home-tablet", "create home-desktop<-home-desktop"]);
  assert.deepEqual(plan([], { regenerate: false, seeded: [] }), ["create home-tablet<-home-tablet", "create home-desktop<-home-desktop"]);
});

test("each auto dashboard is created once, only when missing", () => {
  // Updating from 0.3.x: home-tablet exists, the desktop one is new.
  assert.deepEqual(plan([tablet], { regenerate: false }), ["create home-desktop<-home-desktop"]);
  // 0.3.x created home-tablet on its first start; one the user deleted stays deleted.
  assert.deepEqual(plan([{ id: "kitchen" }], { regenerate: false }), ["create home-desktop<-home-desktop"]);
  assert.deepEqual(plan([tablet, desktop], { regenerate: false, seeded: ["home-desktop", "home-tablet"] }), []);
  assert.deepEqual(plan([tablet], { regenerate: false, seeded: ["home-desktop", "home-tablet"] }), [], "a deleted desktop dashboard is not recreated");
  // A hand-made dashboard that took the id is kept.
  assert.deepEqual(plan([{ id: "home-desktop", generatedBy: "homeframe-agent" }, tablet], { regenerate: false }), []);
});

test("regenerate rebuilds every template dashboard and never hand-made ones", () => {
  const kitchen = { id: "kitchen", generatedBy: "homeframe-template:home-tablet" };
  const custom = { id: "home-tablet", generatedBy: "homeframe-agent" };
  const planned = { id: "office", generatedBy: "homeframe-planner" };
  const handmade = { id: "hall" };

  assert.deepEqual(plan([tablet, desktop, kitchen, planned, handmade], { regenerate: true, seeded: ["home-desktop", "home-tablet"] }), [
    "regenerate home-tablet<-home-tablet",
    "regenerate home-desktop<-home-desktop",
    "regenerate kitchen<-home-tablet",
  ]);
  assert.deepEqual(plan([custom, desktop], { regenerate: true }), ["regenerate home-desktop<-home-desktop"], "a dashboard rebuilt by other means is never overwritten");
  assert.deepEqual(
    plan([kitchen], { regenerate: true, seeded: ["home-desktop", "home-tablet"] }),
    ["create home-tablet<-home-tablet", "create home-desktop<-home-desktop", "regenerate kitchen<-home-tablet"],
    "regenerate also brings removed auto dashboards back",
  );
});

test("auto dashboards are named in the add-on's language and the record survives restarts", async () => {
  assert.equal(autoDashboardName("home-tablet", "da"), "Hjem");
  assert.equal(autoDashboardName("home-desktop", "en"), "Home · Desktop");
  assert.equal(autoDashboardName("kitchen", "da"), undefined);

  const dir = await mkdtemp(path.join(os.tmpdir(), "homeframe-seeded-"));
  assert.equal(readSeeded(dir), undefined);
  writeSeeded(dir, ["home-tablet", "home-desktop", "home-tablet"]);
  assert.deepEqual(readSeeded(dir), ["home-desktop", "home-tablet"]);
});
