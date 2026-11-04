import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  discoverHome,
  HomeAssistantClient,
  liveDataHealth,
  type HassState,
  type SemanticHome,
} from "@homeframe/core";

export type HomeAssistantStatus =
  | "demo"
  | "connecting"
  | "connected"
  | "error";

type RuntimeHomeAssistantStatus = "disabled" | "connecting" | "connected" | "disconnected";

type RuntimeStatusEvent = {
  status: RuntimeHomeAssistantStatus;
  error?: string;
  disconnectedAt?: string;
};

type RuntimeSnapshot = RuntimeStatusEvent & {
  states: HassState[];
  semanticHome: SemanticHome;
};

type RuntimeStateEvent = {
  changed: HassState[];
  removed: string[];
};

/** The runtime sends a keep-alive every 20 s; three missed ones mean the stream is dead. */
const STREAM_SILENCE_MS = 60_000;
/** How soon to rebuild an event stream the browser gave up on (e.g. after a 502 from a proxy). */
const STREAM_RETRY_MS = 3_000;

const client = shallowRef<HomeAssistantClient>();
const states = shallowRef(new Map<string, HassState>());
const semanticHome = ref<SemanticHome>({ areas: [], unassigned: [] });
const status = ref<HomeAssistantStatus>("demo");
const error = ref<string>();

/*
 * Live-data bookkeeping for the runtime connection. Two links can break: the
 * runtime's link to Home Assistant (it reports that in `status` events) and
 * this browser's event stream to the runtime (add-on restart, Wi-Fi). Either
 * way the screen keeps the last values but must say they may be old.
 */
const usingRuntime = ref(false);
const runtimeStatus = ref<RuntimeHomeAssistantStatus>("connected");
const runtimeDisconnectedAt = ref<number>();
const streamOpen = ref(false);
/** When the data stopped being live, for the grace period. */
const unhealthySince = ref<number>();
/** When the data was last known live; undefined if it never was (runtime never reached Home Assistant). */
const lastFreshAt = ref<number>();
const now = ref(Date.now());

let unsubscribeFromStates: (() => void) | undefined;
let runtimeEvents: EventSource | undefined;
let lastStreamMessageAt = 0;
let streamTimers: Array<ReturnType<typeof setTimeout>> = [];
let tick: ReturnType<typeof setInterval> | undefined;
/** State events that arrive while a fresh snapshot is loading; replayed on top of it. */
let queuedUpdates: RuntimeStateEvent[] | undefined;

const healthy = computed(() => streamOpen.value && runtimeStatus.value === "connected");

watch(
  [healthy, usingRuntime],
  ([isHealthy, active]) => {
    if (!active || isHealthy) {
      unhealthySince.value = undefined;
      lastFreshAt.value = undefined;
      if (tick) clearInterval(tick);
      tick = undefined;
      return;
    }
    if (unhealthySince.value !== undefined) return;
    unhealthySince.value = Date.now();
    // The runtime knows when Home Assistant went away; a dead stream we
    // noticed ourselves. A runtime that never connected has no fresh data.
    lastFreshAt.value =
      runtimeStatus.value === "connected" ? Date.now() : runtimeDisconnectedAt.value;
    // Tick only while unhealthy: the grace period and "x minutes ago" need a clock.
    now.value = Date.now();
    tick ??= setInterval(() => {
      now.value = Date.now();
    }, 1_000);
  },
);

/** Shared verdict for the banner, the dimmed cards and the control guard. */
const liveData = computed(() => {
  if (!usingRuntime.value) return { stale: false } as ReturnType<typeof liveDataHealth>;
  return liveDataHealth({
    homeAssistantConnected: runtimeStatus.value === "connected",
    streamOpen: streamOpen.value,
    unhealthySince: unhealthySince.value,
    now: now.value,
  });
});

/** True while the dashboard shows values that may be out of date; controls are refused. */
export const dataStale = computed(() => liveData.value.stale);

function applyRuntimeStatus(event: RuntimeStatusEvent): void {
  runtimeDisconnectedAt.value = event.disconnectedAt ? Date.parse(event.disconnectedAt) : undefined;
  runtimeStatus.value = event.status;
}

function applySnapshot(snapshot: RuntimeSnapshot): void {
  states.value = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  semanticHome.value = snapshot.semanticHome;
  applyRuntimeStatus(snapshot);
}

function applyStateEvent(update: RuntimeStateEvent): void {
  const next = new Map(states.value);
  for (const state of update.changed) next.set(state.entity_id, state);
  for (const entityId of update.removed) next.delete(entityId);
  states.value = next;
}

async function fetchRuntimeSnapshot(): Promise<RuntimeSnapshot | undefined> {
  const response = await fetch("api/ha/snapshot", {
    headers: { accept: "application/json" },
  });
  // A disconnected runtime answers 503 but still sends its last known home.
  const body = (await response.json().catch(() => undefined)) as RuntimeSnapshot | undefined;
  return body && typeof body.status === "string" && Array.isArray(body.states) ? body : undefined;
}

/**
 * After the event stream was interrupted, changes made in the gap are gone
 * for good: reload the whole home. Events that arrive meanwhile are queued
 * and replayed in order on top of the snapshot, so nothing newer is lost.
 */
async function refreshFromRuntime(): Promise<void> {
  queuedUpdates = [];
  try {
    const snapshot = await fetchRuntimeSnapshot();
    if (!snapshot) throw new Error("Runtime snapshot unavailable");
    applySnapshot(snapshot);
    for (const update of queuedUpdates) applyStateEvent(update);
  } catch {
    // The runtime answered the stream but not the snapshot: start over.
    restartStream();
  } finally {
    queuedUpdates = undefined;
  }
}

function closeStream(): void {
  runtimeEvents?.close();
  runtimeEvents = undefined;
  for (const timer of streamTimers) clearTimeout(timer);
  streamTimers = [];
}

function restartStream(): void {
  closeStream();
  streamOpen.value = false;
  streamTimers.push(setTimeout(() => openStream(true), STREAM_RETRY_MS));
}

/**
 * Subscribe to the runtime's event stream. `resync` reloads the snapshot
 * once the stream is open, for every open after the first.
 */
function openStream(resync: boolean): void {
  closeStream();
  const events = new EventSource("api/ha/events");
  runtimeEvents = events;
  let needsResync = resync;
  lastStreamMessageAt = Date.now();

  const heard = () => {
    lastStreamMessageAt = Date.now();
  };

  events.onopen = () => {
    heard();
    streamOpen.value = true;
    if (needsResync) void refreshFromRuntime();
    needsResync = false;
  };

  events.onerror = () => {
    streamOpen.value = false;
    // EventSource retries by itself after a dropped connection; reload the
    // snapshot when it is back. It gives up for good on an HTTP error (an
    // ingress proxy's 502 while the add-on restarts), so then we retry.
    needsResync = true;
    if (events.readyState === EventSource.CLOSED) restartStream();
  };

  events.addEventListener("status", (event) => {
    heard();
    applyRuntimeStatus(JSON.parse((event as MessageEvent<string>).data) as RuntimeStatusEvent);
  });

  // Sent by the runtime after it reconnected to Home Assistant.
  events.addEventListener("snapshot", (event) => {
    heard();
    applySnapshot(JSON.parse((event as MessageEvent<string>).data) as RuntimeSnapshot);
  });

  events.addEventListener("states", (event) => {
    heard();
    const update = JSON.parse((event as MessageEvent<string>).data) as RuntimeStateEvent;
    if (queuedUpdates) queuedUpdates.push(update);
    else applyStateEvent(update);
  });

  events.addEventListener("ping", heard);

  // A stream can die without an error event (a tablet waking from sleep, a
  // proxy silently dropping the connection). Silence past the keep-alive
  // interval means it is gone.
  const watchdog = () => {
    if (runtimeEvents !== events) return;
    if (Date.now() - lastStreamMessageAt > STREAM_SILENCE_MS) {
      restartStream();
      return;
    }
    streamTimers.push(setTimeout(watchdog, 10_000));
  };
  streamTimers.push(setTimeout(watchdog, 10_000));
}

/**
 * Shared Home Assistant state for the dashboard application.
 *
 * Production-style deployments should prefer the Homeframe Runtime connection,
 * which keeps the Home Assistant credential on the server. Direct browser
 * authentication remains available for local development.
 */
export function useHomeAssistant() {
  async function connectRuntime(): Promise<boolean> {
    try {
      const snapshot = await fetchRuntimeSnapshot();
      // "disabled": the runtime runs without Home Assistant (reference view).
      if (!snapshot || snapshot.status === "disabled") return false;

      client.value?.close();
      unsubscribeFromStates?.();

      // A runtime that is still (re)connecting to Home Assistant is used all
      // the same: its last known values are shown, marked as stale, and the
      // screen recovers by itself once it is connected.
      usingRuntime.value = true;
      applySnapshot(snapshot);
      status.value = "connected";
      error.value = undefined;
      openStream(false);
      return true;
    } catch {
      // Vite development or another static host may not have Homeframe Runtime.
      // Falling back is expected and should not turn the whole UI into an error.
      return false;
    }
  }

  async function connect(baseUrl: string, token: string): Promise<void> {
    status.value = "connecting";
    error.value = undefined;

    try {
      closeStream();
      usingRuntime.value = false;
      unsubscribeFromStates?.();
      client.value?.close();

      const nextClient = new HomeAssistantClient(baseUrl, token);
      client.value = nextClient;

      await nextClient.connect();

      const snapshot = await nextClient.getSnapshot();
      semanticHome.value = discoverHome(snapshot);
      states.value = new Map(
        snapshot.states.map((state) => [state.entity_id, state]),
      );

      unsubscribeFromStates = await nextClient.subscribeToStates(
        (nextStates) => {
          states.value = nextStates;
        },
      );

      status.value = "connected";
    } catch (reason) {
      status.value = "error";
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  }

  async function callService(
    domain: string,
    service: string,
    entityIds: string | string[],
  ): Promise<unknown> {
    if (!client.value) {
      throw new Error(
        "Home Assistant controls require a direct development connection in this version",
      );
    }

    return client.value.callService({
      domain,
      service,
      target: { entity_id: entityIds },
    });
  }

  const connected = computed(() => status.value === "connected");

  onUnmounted(() => {
    unsubscribeFromStates?.();
    closeStream();
    if (tick) clearInterval(tick);
    tick = undefined;
  });

  return {
    status,
    connected,
    error,
    states,
    semanticHome,
    /** Whether the shown values may be out of date, why, and since when. */
    liveData,
    lastFreshAt,
    now,
    connectRuntime,
    connect,
    callService,
  };
}
