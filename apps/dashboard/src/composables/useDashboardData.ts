import { computed, type Ref } from "vue";
import type {
  Capability,
  HassState,
  SemanticHome,
} from "@homeframe/core";
import type { HomeAssistantStatus } from "./useHomeAssistant";
import { demoClimateZones, demoRooms } from "../demo/demoHome";

function numericState(
  states: Map<string, HassState>,
  entityId?: string,
): number | undefined {
  if (!entityId) return undefined;

  const value = Number.parseFloat(states.get(entityId)?.state ?? "");
  return Number.isFinite(value) ? value : undefined;
}

function allCapabilities(home: SemanticHome): Capability[] {
  return [
    ...home.areas.flatMap((area) => area.capabilities),
    ...home.unassigned,
  ];
}

/**
 * Translate semantic Homeframe data into the small view models consumed by cards.
 * This is the intended place for entity lookups; visual components stay unaware
 * of Home Assistant entity IDs.
 */
export function useDashboardData(
  status: Ref<HomeAssistantStatus>,
  states: Ref<Map<string, HassState>>,
  semanticHome: Ref<SemanticHome>,
) {
  const liveRooms = computed(() =>
    semanticHome.value.areas.map((area) => {
      const temperature = area.capabilities.find(
        (capability) => capability.kind === "temperature",
      );
      const humidity = area.capabilities.find(
        (capability) => capability.kind === "humidity",
      );
      const lights = area.capabilities.filter(
        (capability) => capability.kind === "light",
      );

      const lightsOn = lights.filter(
        (light) => states.value.get(light.entityId)?.state === "on",
      ).length;

      return {
        name: area.name,
        temperature: numericState(states.value, temperature?.entityId),
        humidity: numericState(states.value, humidity?.entityId),
        lightsOn,
        active: lightsOn > 0,
      };
    }),
  );

  const rooms = computed(() => {
    if (status.value !== "connected" || liveRooms.value.length === 0) {
      return demoRooms;
    }

    return liveRooms.value.slice(0, 6);
  });

  const powerWatts = computed(() => {
    const power = allCapabilities(semanticHome.value).find(
      (capability) => capability.kind === "power",
    );

    return numericState(states.value, power?.entityId);
  });

  const energyTodayKwh = computed(() => {
    const energy = allCapabilities(semanticHome.value).find(
      (capability) => capability.kind === "energy",
    );

    return numericState(states.value, energy?.entityId);
  });

  const climateZones = computed(() => {
    if (status.value !== "connected") return demoClimateZones;

    return semanticHome.value.areas
      .flatMap((area) => {
        const climate = area.capabilities.find(
          (capability) => capability.kind === "climate",
        );

        if (!climate) return [];

        const state = states.value.get(climate.entityId);
        const current = Number(state?.attributes.current_temperature);
        const target = Number(state?.attributes.temperature);

        if (!Number.isFinite(current) || !Number.isFinite(target)) return [];

        return [
          {
            name: area.name,
            current,
            target,
            heating: state?.attributes.hvac_action === "heating",
          },
        ];
      })
      .slice(0, 5);
  });

  return {
    rooms,
    powerWatts,
    energyTodayKwh,
    climateZones,
  };
}
