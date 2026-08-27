<script setup lang="ts">
import { computed } from "vue";
import type { DashboardCard, EntityBinding } from "@homeframe/sdk";
import type { HassState } from "@homeframe/core";
import ApplianceCard from "./cards/ApplianceCard.vue";
import ClimateCard from "./cards/ClimateCard.vue";
import EnergyCard from "./cards/EnergyCard.vue";
import GlassCard from "./cards/GlassCard.vue";
import RoomCard from "./cards/RoomCard.vue";
import SecurityCard from "./cards/SecurityCard.vue";

const props = defineProps<{
  card: DashboardCard;
  states: Map<string, HassState>;
}>();

function ids(binding: EntityBinding | undefined): string[] {
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

function firstState(capability: string): HassState | undefined {
  const entityId = ids(props.card.bindings?.[capability])[0];
  return entityId ? props.states.get(entityId) : undefined;
}

function numericState(capability: string): number | undefined {
  const value = Number(firstState(capability)?.state);
  return Number.isFinite(value) ? value : undefined;
}

function numericAttribute(state: HassState | undefined, key: string): number | undefined {
  const value = Number(state?.attributes[key]);
  return Number.isFinite(value) ? value : undefined;
}

const style = computed(() => {
  const layout = props.card.layout;
  if (!layout) return undefined;

  return {
    gridColumn: `${layout.x + 1} / span ${layout.w}`,
    gridRow: `${layout.y + 1} / span ${layout.h}`,
  };
});

const roomName = computed(() => String(props.card.props?.name ?? props.card.areaId ?? "Room"));
const lightsOn = computed(() =>
  ids(props.card.bindings?.light).filter((entityId) => props.states.get(entityId)?.state === "on").length,
);

const climateZones = computed(() =>
  ids(props.card.bindings?.climate).flatMap((entityId) => {
    const state = props.states.get(entityId);
    if (!state) return [];

    const current = numericAttribute(state, "current_temperature");
    const target = numericAttribute(state, "temperature");
    if (current === undefined || target === undefined) return [];

    return [
      {
        name: String(state.attributes.friendly_name ?? entityId),
        current,
        target,
        heating: state.attributes.hvac_action === "heating",
      },
    ];
  }),
);

const applianceCapability = computed(() => {
  if (props.card.card === "vacuum") return "vacuum";
  if (props.card.bindings?.dryer) return "dryer";
  return "washer";
});
const applianceState = computed(() => firstState(applianceCapability.value));
const applianceKind = computed<"washer" | "dryer" | "vacuum">(() =>
  applianceCapability.value === "vacuum"
    ? "vacuum"
    : applianceCapability.value === "dryer"
      ? "dryer"
      : "washer",
);
const applianceTitle = computed(() =>
  String(
    props.card.props?.title ??
      applianceState.value?.attributes.friendly_name ??
      (applianceKind.value === "vacuum" ? "Robot vacuum" : "Appliance"),
  ),
);

const securityStatus = computed(() => {
  const bound = ["lock", "alarm", "garage"].flatMap((kind) => ids(props.card.bindings?.[kind]));
  if (!bound.length) return "Review";

  const attentionStates = new Set(["unlocked", "open", "opening", "triggered", "pending"]);
  return bound.some((entityId) => attentionStates.has(props.states.get(entityId)?.state ?? ""))
    ? "Attention"
    : "Secure";
});
</script>

<template>
  <div class="manifest-card" :style="style">
    <RoomCard
      v-if="card.card === 'room'"
      :name="roomName"
      :temperature="numericState('temperature')"
      :humidity="numericState('humidity')"
      :lights-on="lightsOn"
      :active="lightsOn > 0"
    />

    <EnergyCard
      v-else-if="card.card === 'energy'"
      :watts="numericState('power') ?? 0"
      :today-kwh="numericState('energy')"
    />

    <ClimateCard
      v-else-if="card.card === 'climate' && climateZones.length"
      :zones="climateZones"
    />

    <ApplianceCard
      v-else-if="card.card === 'appliance' || card.card === 'vacuum'"
      :kind="applianceKind"
      :title="applianceTitle"
      :state="applianceState?.state ?? 'Unavailable'"
      :detail="String(applianceState?.attributes.friendly_name ?? '') || undefined"
    />

    <SecurityCard
      v-else-if="card.card === 'security'"
      :doors-and-windows-status="securityStatus"
      night-mode-status="Ready"
    />

    <GlassCard v-else>
      <span class="eyebrow">CARD</span>
      <h2>{{ card.card }}</h2>
      <p class="muted">This card type is valid in the manifest but has no renderer yet.</p>
    </GlassCard>
  </div>
</template>
