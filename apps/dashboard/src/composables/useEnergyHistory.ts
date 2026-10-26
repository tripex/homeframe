import { onUnmounted, ref, shallowRef } from "vue";
import type { EnergySummary } from "@homeframe/core";

export type EnergyHistory = {
  summary: EnergySummary;
  currency?: string;
  currencyLabel?: string;
};

const REFRESH_MS = 60_000;

/**
 * Hourly consumption and cost for one saved energy card, from Homeframe
 * Runtime. The request names the dashboard and card, never an entity: the
 * runtime reads the card's own bindings.
 *
 * Without a runtime (plain Vite dev) or Home Assistant connection the card
 * simply renders without history.
 */
export function useEnergyHistory(dashboardId: () => string | undefined, instanceId: () => string) {
  const history = shallowRef<EnergyHistory>();
  const unavailable = ref(false);

  async function load(): Promise<void> {
    const dashboard = dashboardId();
    if (!dashboard) return;

    try {
      const query = new URLSearchParams({ dashboard, instance: instanceId() });
      const response = await fetch(`/api/energy?${query}`, { headers: { accept: "application/json" } });
      if (!response.ok) {
        unavailable.value = true;
        return;
      }
      history.value = (await response.json()) as EnergyHistory;
      unavailable.value = false;
    } catch {
      unavailable.value = true;
    }
  }

  void load();
  const timer = setInterval(load, REFRESH_MS);
  onUnmounted(() => clearInterval(timer));

  return { history, unavailable, reload: load };
}
