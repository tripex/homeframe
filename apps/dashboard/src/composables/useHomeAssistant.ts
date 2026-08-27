import { computed, onUnmounted, ref, shallowRef } from "vue";
import {
  discoverHome,
  HomeAssistantClient,
  type HassState,
  type SemanticHome,
} from "@homeframe/core";

export type HomeAssistantStatus =
  | "demo"
  | "connecting"
  | "connected"
  | "error";

type RuntimeSnapshot = {
  status: "disabled" | "connecting" | "connected" | "error";
  error?: string;
  states: HassState[];
  semanticHome: SemanticHome;
};

type RuntimeStateEvent = {
  changed: HassState[];
  removed: string[];
};

const client = shallowRef<HomeAssistantClient>();
const states = shallowRef(new Map<string, HassState>());
const semanticHome = ref<SemanticHome>({ areas: [], unassigned: [] });
const status = ref<HomeAssistantStatus>("demo");
const error = ref<string>();

let unsubscribeFromStates: (() => void) | undefined;
let runtimeEvents: EventSource | undefined;

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
      const response = await fetch("/api/ha/snapshot", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return false;

      const snapshot = (await response.json()) as RuntimeSnapshot;
      if (snapshot.status !== "connected") return false;

      client.value?.close();
      unsubscribeFromStates?.();
      runtimeEvents?.close();

      states.value = new Map(
        snapshot.states.map((state) => [state.entity_id, state]),
      );
      semanticHome.value = snapshot.semanticHome;
      status.value = "connected";
      error.value = undefined;

      runtimeEvents = new EventSource("/api/ha/events");
      runtimeEvents.addEventListener("states", (event) => {
        const update = JSON.parse((event as MessageEvent<string>).data) as RuntimeStateEvent;
        const next = new Map(states.value);

        for (const state of update.changed) next.set(state.entity_id, state);
        for (const entityId of update.removed) next.delete(entityId);

        states.value = next;
      });

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
      runtimeEvents?.close();
      runtimeEvents = undefined;
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
    runtimeEvents?.close();
  });

  return {
    status,
    connected,
    error,
    states,
    semanticHome,
    connectRuntime,
    connect,
    callService,
  };
}
