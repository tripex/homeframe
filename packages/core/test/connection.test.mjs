// Connection health: backoff, stale-data decision and the WebSocket client's
// disconnect/heartbeat handling against the scripted fake Home Assistant.
// Run `npm run build -w @homeframe/core` first.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HomeAssistantClient,
  HomeAssistantDisconnectedError,
  liveDataHealth,
  reconnectDelayMs,
} from "../dist/index.js";
import { startFakeHomeAssistant } from "../../../scripts/fake-home-assistant.mjs";

const noJitter = () => 0;

test("reconnect backoff climbs 1, 2, 5, 10, 30 s and then stays at 30 s", () => {
  const delays = [0, 1, 2, 3, 4, 5, 50].map((attempt) => reconnectDelayMs(attempt, undefined, noJitter));
  assert.deepEqual(delays, [1000, 2000, 5000, 10000, 30000, 30000, 30000]);
});

test("reconnect jitter adds at most 10 %", () => {
  assert.equal(reconnectDelayMs(4, undefined, () => 0.999), 32997);
  assert.equal(reconnectDelayMs(0, [100, 200], () => 0.5), 105);
});

test("live data is fresh while both links are up, whatever the timestamps say", () => {
  assert.deepEqual(liveDataHealth({ homeAssistantConnected: true, streamOpen: true, unhealthySince: 0, now: 99_999 }), {
    stale: false,
  });
});

test("a short blip inside the grace period is not shown", () => {
  const health = liveDataHealth({ homeAssistantConnected: false, streamOpen: true, unhealthySince: 1000, now: 3000, graceMs: 4000 });
  assert.equal(health.stale, false);
});

test("a lost Home Assistant connection marks the data stale after the grace period", () => {
  assert.deepEqual(
    liveDataHealth({ homeAssistantConnected: false, streamOpen: true, unhealthySince: 1000, now: 66_000, graceMs: 4000 }),
    { stale: true, reason: "home-assistant", staleForMs: 65_000 },
  );
});

test("a dead stream to the runtime wins, because the Home Assistant status is then unknown", () => {
  const health = liveDataHealth({ homeAssistantConnected: true, streamOpen: false, unhealthySince: 0, now: 10_000 });
  assert.equal(health.stale, true);
  assert.equal(health.reason, "runtime");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a dropped connection is reported once and fails pending requests", async (t) => {
  const fake = await startFakeHomeAssistant({ port: 0 });
  t.after(() => fake.close());

  const lost = deferred();
  const reasons = [];
  const client = new HomeAssistantClient(fake.url, "token", {
    heartbeatIntervalMs: 0,
    onDisconnect: (reason) => {
      reasons.push(reason);
      lost.resolve();
    },
  });
  await client.connect();
  assert.equal(client.connected, true);

  // A ping the fake does not answer, so it is still pending when the drop hits.
  fake.ignorePings = true;
  const pending = client.callWebSocket({ type: "ping" }).catch((error) => error);
  fake.dropConnections();
  await lost.promise;

  assert.equal(reasons.length, 1);
  assert.equal(client.connected, false);
  const failure = await pending;
  assert.ok(failure instanceof Error);
  await assert.rejects(client.callWebSocket({ type: "get_states" }), HomeAssistantDisconnectedError);
});

test("an unanswered heartbeat declares the connection dead", async (t) => {
  const fake = await startFakeHomeAssistant({ port: 0 });
  t.after(() => fake.close());

  const lost = deferred();
  const client = new HomeAssistantClient(fake.url, "token", {
    heartbeatIntervalMs: 40,
    heartbeatTimeoutMs: 60,
    onDisconnect: (reason) => lost.resolve(reason),
  });
  await client.connect();

  // Answered pings keep it alive for several intervals.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(client.connected, true);

  // A frozen Home Assistant keeps the socket open but stops answering.
  fake.ignorePings = true;
  const reason = await lost.promise;
  assert.match(reason, /ping/);
  assert.equal(client.connected, false);
});

test("close() is intentional: no disconnect callback, pending requests rejected", async (t) => {
  const fake = await startFakeHomeAssistant({ port: 0 });
  t.after(() => fake.close());

  let disconnects = 0;
  const client = new HomeAssistantClient(fake.url, "token", {
    heartbeatIntervalMs: 20,
    onDisconnect: () => {
      disconnects += 1;
    },
  });
  await client.connect();
  fake.ignorePings = true;
  const pending = client.callWebSocket({ type: "ping" });
  client.close();

  await assert.rejects(pending, HomeAssistantDisconnectedError);
  // Give a late close event or heartbeat tick the chance to misfire.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(disconnects, 0);
});

test("connecting to a Home Assistant that is not running fails without a disconnect callback", async () => {
  let disconnects = 0;
  const client = new HomeAssistantClient("http://127.0.0.1:9", "token", {
    onDisconnect: () => {
      disconnects += 1;
    },
  });
  await assert.rejects(client.connect());
  client.close();
  assert.equal(disconnects, 0);
});
