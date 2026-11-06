import { applianceStatus, type ApplianceMemory, type ApplianceReading, type ApplianceRole, type HassState } from "@homeframe/core";
import type { EntityBinding } from "@homeframe/sdk";
import { computed, onUnmounted, ref, watch } from "vue";

/**
 * Live readings for appliance cards (and appliance stand-ins).
 *
 * The state rules live in `@homeframe/core` (`applianceStatus`). The only
 * thing the screen adds is time and memory: a ticking clock for "38 min
 * left", and, for smart-plug appliances, when the plug last drew power, so a
 * cycle that just went quiet reads "finished" rather than "idle". That memory
 * is kept per card in localStorage, so a reload in the middle of the
 * afternoon still knows the laundry is waiting.
 */

export type ApplianceSource = {
  key: string;
  bindings?: Record<string, EntityBinding>;
  thresholdW?: number;
};

const STORAGE_KEY = "homeframe.appliance-memory";
const memories = ref<Record<string, ApplianceMemory>>(load());

function load(): Record<string, ApplianceMemory> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, ApplianceMemory>;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories.value));
  } catch {
    // Private mode or a full quota: the memory just lasts until reload.
  }
}

const ROLES: ApplianceRole[] = ["status", "phase", "remaining", "end_time", "total", "progress", "program", "door", "power", "energy", "switch"];

function first(binding: EntityBinding | undefined): string | undefined {
  return Array.isArray(binding) ? binding[0] : binding;
}

export function useApplianceReadings(
  sources: () => ApplianceSource[],
  states: () => Map<string, HassState>,
) {
  const now = ref(Date.now());
  const timer = setInterval(() => (now.value = Date.now()), 20_000);
  onUnmounted(() => clearInterval(timer));

  const readings = computed<ApplianceReading[]>(() =>
    sources().map((source) => {
      const bound = Object.fromEntries(
        ROLES.flatMap((role) => {
          const entityId = first(source.bindings?.[role]);
          return entityId ? [[role, states().get(entityId)] as const] : [];
        }),
      );
      return applianceStatus(bound, { now: now.value, thresholdW: source.thresholdW, memory: memories.value[source.key] });
    }),
  );

  // Remember when a plug last drew power. Only a change is written, so this
  // settles after one round.
  watch(
    readings,
    (list) => {
      let changed = false;
      list.forEach((reading, index) => {
        const key = sources()[index]?.key;
        if (!key || reading.memory.lastActiveAt === memories.value[key]?.lastActiveAt) return;
        memories.value = { ...memories.value, [key]: reading.memory };
        changed = true;
      });
      if (changed) persist();
    },
    { immediate: true },
  );

  return { readings, now };
}
