// RuntimeHomeAssistant heals its Home Assistant connection: drops, frozen
// hosts and a Home Assistant that is not up yet when the runtime starts.
// Uses the scripted fake Home Assistant and a real HTTP server for the
// browser-facing event stream. Run `npm run build` first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { RuntimeHomeAssistant } from "../dist/home-assistant.js";
import { startFakeHomeAssistant } from "../../../scripts/fake-home-assistant.mjs";

const FAST = { retryDelaysMs: [30, 60, 120], heartbeatIntervalMs: 0, eventKeepAliveMs: 60_000 };
const TEMPERATURE = "sensor.living_room_temperature";

function connectionTo(url) {
  return {
    mode: "direct",
    baseUrl: url,
    websocketUrl: `${url.replace(/^http/, "ws")}/api/websocket`,
    restUrl: `${url}/api`,
    token: "token",
  };
}

/** A free port that a fake Home Assistant can be (re)started on later. */
async function freePort() {
  const probe = await startFakeHomeAssistant({ port: 0 });
  const { port } = probe;
  await probe.close();
  return port;
}

/**
 * Serve the runtime's SSE stream over real HTTP and collect what a browser
 * would receive, so the test checks the wire format, not internals.
 */
async function subscribe(runtime) {
  const server = createServer((_request, response) => runtime.attachEvents(response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: controller.signal });
  const events = [];
  const waiters = new Set();

  (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) events.push({ event, data: JSON.parse(data ?? "null") });
          for (const waiter of waiters) waiter();
        }
      }
    } catch {
      // Aborted at the end of the test.
    }
  })();

  return {
    events,
    /** Resolve with the first event (from `from` on) that matches. */
    waitFor(predicate, from = 0, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = events.slice(from).find(predicate);
          if (!found) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`timed out; saw ${JSON.stringify(events.map((item) => item.event))}`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
    close() {
      controller.abort();
      server.closeAllConnections();
      server.close();
    },
  };
}

const isStatus = (status) => (item) => item.event === "status" && item.data.status === status;

test("after Home Assistant goes away and comes back, the runtime reconnects and streams live changes again", async (t) => {
  const port = await freePort();
  let fake = await startFakeHomeAssistant({ port, states: { [TEMPERATURE]: "21.8" } });
  const runtime = new RuntimeHomeAssistant(FAST);
  t.after(async () => {
    runtime.close();
    await fake.close();
  });

  await runtime.start(connectionTo(fake.url));
  assert.equal(runtime.snapshot().status, "connected");
  const stream = await subscribe(runtime);
  t.after(() => stream.close());
  await stream.waitFor(isStatus("connected"));

  // Live updates flow before the outage.
  fake.setState(TEMPERATURE, "22.0");
  const before = await stream.waitFor((item) => item.event === "states");
  assert.equal(before.data.changed[0].state, "22.0");

  // Home Assistant restarts: the socket closes and nothing listens for a while.
  await fake.close();
  await stream.waitFor(isStatus("disconnected"));
  assert.equal(runtime.snapshot().status, "disconnected");
  assert.ok(Date.parse(runtime.snapshot().disconnectedAt) > 0, "screens learn when the values went stale");
  // The last known values stay available to screens, marked by the status.
  assert.equal(runtime.currentStates().get(TEMPERATURE).state, "22.0");
  // Calls fail fast and clearly instead of hanging.
  await assert.rejects(runtime.callService({ domain: "light", service: "turn_on" }), {
    name: "HomeAssistantUnavailableError",
  });

  // Let a few retries fail against the closed port.
  await new Promise((resolve) => setTimeout(resolve, 150));

  // It comes back with a value that changed while we were away.
  const mark = stream.events.length;
  fake = await startFakeHomeAssistant({ port, states: { [TEMPERATURE]: "23.4" } });
  const snapshot = await stream.waitFor((item) => item.event === "snapshot", mark);
  assert.equal(snapshot.data.status, "connected");
  assert.equal(snapshot.data.states.find((state) => state.entity_id === TEMPERATURE).state, "23.4");
  assert.ok(snapshot.data.semanticHome.areas.length > 0, "the home is rediscovered");
  await stream.waitFor(isStatus("connected"), mark);
  assert.equal(runtime.snapshot().disconnectedAt, undefined);

  // And the new subscription delivers changes without any restart.
  const live = stream.events.length;
  fake.setState(TEMPERATURE, "24.1");
  const after = await stream.waitFor((item) => item.event === "states", live);
  assert.equal(after.data.changed[0].state, "24.1");
  assert.equal(runtime.currentStates().get(TEMPERATURE).state, "24.1");
});

test("a network drop with Home Assistant still running is healed the same way", async (t) => {
  const fake = await startFakeHomeAssistant({ port: 0 });
  const runtime = new RuntimeHomeAssistant(FAST);
  t.after(async () => {
    runtime.close();
    await fake.close();
  });
  await runtime.start(connectionTo(fake.url));
  const stream = await subscribe(runtime);
  t.after(() => stream.close());

  fake.dropConnections();
  await stream.waitFor(isStatus("disconnected"));
  await stream.waitFor((item) => item.event === "snapshot");
  assert.equal(runtime.snapshot().status, "connected");
});

test("a frozen Home Assistant is detected by the heartbeat and reconnected", async (t) => {
  const fake = await startFakeHomeAssistant({ port: 0 });
  const runtime = new RuntimeHomeAssistant({ ...FAST, heartbeatIntervalMs: 40, heartbeatTimeoutMs: 60 });
  t.after(async () => {
    runtime.close();
    await fake.close();
  });
  await runtime.start(connectionTo(fake.url));
  const stream = await subscribe(runtime);
  t.after(() => stream.close());

  fake.ignorePings = true;
  const lost = await stream.waitFor(isStatus("disconnected"));
  assert.match(lost.data.error, /ping/);

  // The reconnect gets a fresh socket; let that one answer again.
  fake.ignorePings = false;
  await stream.waitFor(isStatus("connected"), stream.events.indexOf(lost));
});

test("a Home Assistant that is not up yet at start is retried until it is", async (t) => {
  const port = await freePort();
  let connects = 0;
  const runtime = new RuntimeHomeAssistant({ ...FAST, onConnected: () => (connects += 1) });
  let fake;
  t.after(async () => {
    runtime.close();
    await fake?.close();
  });

  await runtime.start(connectionTo(`http://127.0.0.1:${port}`));
  assert.equal(runtime.snapshot().status, "disconnected");
  assert.ok(runtime.snapshot().error);

  const stream = await subscribe(runtime);
  t.after(() => stream.close());
  await new Promise((resolve) => setTimeout(resolve, 200));
  fake = await startFakeHomeAssistant({ port });

  await stream.waitFor((item) => item.event === "snapshot");
  assert.equal(runtime.snapshot().status, "connected");
  assert.ok(runtime.snapshot().states.length > 0);
  assert.equal(connects, 1);
});

test("close() stops retrying and leaves no timers behind", async () => {
  const port = await freePort();
  const runtime = new RuntimeHomeAssistant({ retryDelaysMs: [20], heartbeatIntervalMs: 0 });
  await runtime.start(connectionTo(`http://127.0.0.1:${port}`));
  runtime.close();

  // Were a retry still scheduled, it would connect to this fake.
  const fake = await startFakeHomeAssistant({ port });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(runtime.snapshot().status, "disconnected");
  await fake.close();
  // node --test would also hang here if an interval or timeout leaked.
});
