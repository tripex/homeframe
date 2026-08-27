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

const client = shallowRef<HomeAssistantClient>();
const states = shallowRef(new Map<string, HassState>());
const semanticHome = ref<SemanticHome>({ areas: [], unassigned: [] });
const status = ref<HomeAssistantStatus>("demo");
const error = ref<string>();

let unsubscribeFromStates: (() => void) | undefined;

/**
 * Shared Home Assistant state for the dashboard application.
 *
 * This composable deliberately exposes semantic discovery separately from raw
 * states. Cards should normally consume prepared view models instead of reading
 * Home Assistant entities directly.
 */
export function useHomeAssistant() {
  async function connect(baseUrl: string, token: string): Promise<void> {
    status.value = "connecting";
    error.value = undefined;

    try {
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
      throw new Error("Not connected to Home Assistant");
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
  });

  return {
    status,
    connected,
    error,
    states,
    semanticHome,
    connect,
    callService,
  };
}
