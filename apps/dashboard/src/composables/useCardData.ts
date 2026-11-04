import { onUnmounted, ref, shallowRef } from "vue";

/**
 * Poll one runtime data endpoint for a saved card, e.g. `api/forecast` or
 * `api/agenda`. Like energy history, the request names the dashboard and card
 * instance, never an entity: the runtime reads the card's own bindings.
 *
 * Without a runtime (plain Vite dev, the static demo) `data` stays undefined
 * and the card shows its empty state.
 */
export function useCardData<T>(
  endpoint: "api/forecast" | "api/agenda",
  dashboardId: () => string | undefined,
  instanceId: () => string,
  refreshMs: number,
) {
  const data = shallowRef<T>();
  const loading = ref(true);

  async function load(): Promise<void> {
    const dashboard = dashboardId();
    if (!dashboard) {
      loading.value = false;
      return;
    }

    try {
      const query = new URLSearchParams({ dashboard, instance: instanceId() });
      const response = await fetch(`${endpoint}?${query}`, { headers: { accept: "application/json" } });
      if (response.ok) data.value = (await response.json()) as T;
    } catch {
      // Keep the last good data; the next poll may succeed.
    } finally {
      loading.value = false;
    }
  }

  void load();
  const timer = setInterval(load, refreshMs);
  onUnmounted(() => clearInterval(timer));

  return { data, loading };
}
