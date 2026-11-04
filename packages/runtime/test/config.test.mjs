import assert from "node:assert/strict";
import { test } from "node:test";
import { firstDashboardAction, isAllowedIngressClient, resolveConnection } from "../dist/config.js";

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

test("the add-on creates a first dashboard and only regenerates the template one on request", () => {
  const generated = { id: "home-tablet", generatedBy: "homeframe-template:home-tablet" };
  const custom = { id: "home-tablet", generatedBy: "homeframe-agent" };
  const other = { id: "kitchen", generatedBy: "homeframe-template:home-tablet" };

  assert.equal(firstDashboardAction([], false), "create");
  assert.equal(firstDashboardAction([generated], false), "keep");
  assert.equal(firstDashboardAction([generated, other], true), "regenerate");
  assert.equal(firstDashboardAction([custom], true), "keep", "a dashboard rebuilt by other means is never overwritten");
  assert.equal(firstDashboardAction([other], true), "create", "a removed home-tablet comes back; others stay");
});
