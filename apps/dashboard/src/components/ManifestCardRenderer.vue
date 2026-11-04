<script setup lang="ts">
import { computed } from "vue";
import type { DashboardCard, EntityBinding } from "@homeframe/sdk";
import type { AgendaEvent, Atmosphere, ForecastDay, HassState } from "@homeframe/core";
import type { AtmosphereMode } from "@homeframe/sdk";
import AgendaCard from "./cards/AgendaCard.vue";
import ApplianceCard from "./cards/ApplianceCard.vue";
import CameraCard from "./cards/CameraCard.vue";
import ForecastCard from "./cards/ForecastCard.vue";
import HomeSceneCard, { type SceneChip } from "./cards/HomeSceneCard.vue";
import PresenceCard from "./cards/PresenceCard.vue";
import ClimateCard from "./cards/ClimateCard.vue";
import EnergyCard from "./cards/EnergyCard.vue";
import GlassCard from "./cards/GlassCard.vue";
import RoomCard from "./cards/RoomCard.vue";
import SecurityCard from "./cards/SecurityCard.vue";
import { useCardData } from "../composables/useCardData";
import { useDashboardActions } from "../composables/useDashboardActions";
import { useEnergyHistory } from "../composables/useEnergyHistory";
import { translate as t, useI18n } from "../i18n";

const props = defineProps<{
  card: DashboardCard;
  states: Map<string, HassState>;
  dashboardId: string;
  /** The dashboard's sky; the home scene draws it when there is no photo. */
  atmosphere?: Atmosphere;
  atmosphereMode?: AtmosphereMode;
}>();

const { number } = useI18n();

const { canControl, isPending, run } = useDashboardActions();

// Only energy cards ask the runtime for history.
const energyHistory =
  props.card.card === "energy"
    ? useEnergyHistory(() => props.dashboardId, () => props.card.instanceId).history
    : undefined;

// Forecast and agenda cards ask the runtime; nothing else polls.
const forecast =
  props.card.card === "weather-forecast"
    ? useCardData<{ days: ForecastDay[] }>("api/forecast", () => props.dashboardId, () => props.card.instanceId, 15 * 60_000)
    : undefined;
const agenda =
  props.card.card === "agenda"
    ? useCardData<{ events: AgendaEvent[]; calendars: Record<string, string> }>(
        "api/agenda",
        () => props.dashboardId,
        () => props.card.instanceId,
        5 * 60_000,
      )
    : undefined;

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
        id: entityId,
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

/**
 * Overall state of the bound locks, alarms and garages. Status only: the
 * dashboard never offers to change them.
 */
function securityStatusOf(kinds: string[]): "secure" | "attention" | "review" {
  const bound = kinds.flatMap((kind) => ids(props.card.bindings?.[kind]));
  if (!bound.length) return "review";

  const states = bound.map((entityId) => props.states.get(entityId)?.state);
  if (states.some((state) => !state || state === "unknown" || state === "unavailable")) {
    return "review";
  }

  const attentionStates = new Set([
    "unlocked",
    "open",
    "opening",
    "triggered",
    "pending",
    "disarmed",
  ]);
  if (states.some((state) => attentionStates.has(state!))) return "attention";

  const secureStates = new Set([
    "locked",
    "closed",
    "armed_home",
    "armed_away",
    "armed_night",
    "armed_vacation",
    "armed_custom_bypass",
  ]);

  return states.every((state) => secureStates.has(state!)) ? "secure" : "review";
}

const securityStatus = computed(() => securityStatusOf(["lock", "alarm", "garage"]));

// --- Home scene -----------------------------------------------------------

const sceneNight = computed(() => {
  const sun = firstState("sun");
  if (sun) return sun.state === "below_horizon";
  return props.atmosphere?.phase === "night";
});

const sceneChips = computed<SceneChip[]>(() => {
  const chips: SceneChip[] = [];

  if (ids(props.card.bindings?.lock).length) {
    const status = securityStatusOf(["lock"]);
    chips.push({
      id: "locks",
      icon: status === "secure" ? "lock" : "unlocked",
      label: t(status === "secure" ? "scene.allLocked" : status === "attention" ? "scene.unlocked" : "scene.lockUnknown"),
      tone: status === "secure" ? "calm" : "attention",
    });
  }

  if (ids(props.card.bindings?.light).length) {
    chips.push({
      id: "lights",
      icon: "light",
      label:
        lightsOn.value === 0
          ? t("scene.lightsOff")
          : lightsOn.value === 1
            ? t("scene.lightsOn.one")
            : t("scene.lightsOn.other", { count: lightsOn.value }),
    });
  }

  const climates = ids(props.card.bindings?.climate).flatMap((entityId) => {
    const state = props.states.get(entityId);
    return state ? [state] : [];
  });
  const readings = climates.flatMap((state) => {
    const value = numericAttribute(state, "current_temperature");
    return value === undefined ? [] : [value];
  });
  if (readings.length) {
    const average = readings.reduce((sum, value) => sum + value, 0) / readings.length;
    chips.push({ id: "inside", icon: "temperature", label: t("scene.inside", { temperature: number(average) }) });
  }
  const heating = climates.filter((state) => state.attributes.hvac_action === "heating").length;
  if (heating) chips.push({ id: "heating", icon: "heating", label: t("scene.heating", { count: heating }) });

  return chips;
});

const sceneImage = computed(() => String(props.card.props?.image ?? "home"));

// --- Camera, forecast, agenda, presence -------------------------------------

const cameraId = computed(() => ids(props.card.bindings?.camera)[0]);
const cameraTitle = computed(() =>
  String(props.card.props?.title ?? firstState("camera")?.attributes.friendly_name ?? cameraId.value ?? ""),
);

const agendaEvents = computed(() =>
  (agenda?.data.value?.events ?? []).map((event) => ({
    ...event,
    calendarName: agenda?.data.value?.calendars[event.calendar],
  })),
);

const people = computed(() =>
  ids(props.card.bindings?.person).map((entityId) => {
    const state = props.states.get(entityId);
    return {
      id: entityId,
      name: String(state?.attributes.friendly_name ?? entityId.split(".")[1] ?? entityId),
      home: state?.state === "home",
    };
  }),
);

function numberProp(name: string): number | undefined {
  const value = props.card.props?.[name];
  return typeof value === "number" ? value : undefined;
}

const vacuumRunning = computed(() => applianceState.value?.state === "cleaning");

function toggleLights(): void {
  void run(props.dashboardId, props.card.instanceId, "toggle-lights");
}

function setTemperature(payload: { zoneId: string | undefined; temperature: number }): void {
  void run(props.dashboardId, props.card.instanceId, "set-temperature", {
    entityId: payload.zoneId,
    temperature: payload.temperature,
  });
}

function startPauseVacuum(): void {
  void run(props.dashboardId, props.card.instanceId, "start-pause");
}

function returnVacuumHome(): void {
  void run(props.dashboardId, props.card.instanceId, "return-home");
}
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
      :controllable="canControl"
      :pending="isPending(card.instanceId, 'toggle-lights')"
      @toggle-lights="toggleLights"
    />

    <EnergyCard
      v-else-if="card.card === 'energy'"
      :title="typeof card.props?.title === 'string' ? card.props.title : undefined"
      :watts="numericState('power') ?? 0"
      :summary="energyHistory?.summary"
      :currency="energyHistory?.currency"
      :currency-label="energyHistory?.currencyLabel"
    />

    <ClimateCard
      v-else-if="card.card === 'climate' && climateZones.length"
      :zones="climateZones"
      :controllable="canControl"
      :pending="isPending(card.instanceId, 'set-temperature')"
      @set-temperature="setTemperature"
    />

    <ApplianceCard
      v-else-if="card.card === 'appliance' || card.card === 'vacuum'"
      :kind="applianceKind"
      :title="applianceTitle"
      :state="applianceState?.state ?? 'Unavailable'"
      :detail="String(applianceState?.attributes.friendly_name ?? '') || undefined"
      :controllable="canControl"
      :running="vacuumRunning"
      :pending="isPending(card.instanceId, 'start-pause') || isPending(card.instanceId, 'return-home')"
      @start-pause="startPauseVacuum"
      @return-home="returnVacuumHome"
    />

    <SecurityCard
      v-else-if="card.card === 'security'"
      :status="securityStatus"
      :compact="(card.layout?.h ?? 3) <= 1"
    />

    <HomeSceneCard
      v-else-if="card.card === 'home-scene' && atmosphere"
      :title="typeof card.props?.title === 'string' ? card.props.title : undefined"
      :day-image="`api/assets/${sceneImage}-day`"
      :night-image="`api/assets/${sceneImage}-night`"
      :night="sceneNight"
      :atmosphere="atmosphere"
      :atmosphere-mode="atmosphereMode ?? 'live'"
      :chips="sceneChips"
      :lights-on="lightsOn > 0"
    />

    <CameraCard
      v-else-if="card.card === 'camera'"
      :title="cameraTitle"
      :src="cameraId ? `api/camera_proxy/${cameraId}` : undefined"
      :refresh-seconds="numberProp('refreshSeconds')"
    />

    <ForecastCard
      v-else-if="card.card === 'weather-forecast'"
      :days="forecast?.data.value?.days ?? []"
      :max-days="numberProp('days')"
      :loading="forecast?.loading.value"
    />

    <AgendaCard
      v-else-if="card.card === 'agenda'"
      :events="agendaEvents"
      :has-calendars="ids(card.bindings?.calendar).length > 0"
      :max-events="numberProp('maxEvents')"
      :loading="agenda?.loading.value"
    />

    <PresenceCard v-else-if="card.card === 'presence'" :people="people" />

    <GlassCard v-else>
      <span class="eyebrow">CARD</span>
      <h2>{{ card.card }}</h2>
      <p class="muted">This card type is valid in the manifest but has no renderer yet.</p>
    </GlassCard>
  </div>
</template>
