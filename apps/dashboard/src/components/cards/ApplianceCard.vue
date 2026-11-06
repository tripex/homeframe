<script setup lang="ts">
import type { ApplianceReading } from "@homeframe/core";
import { computed } from "vue";
import ApplianceArt from "./ApplianceArt.vue";
import GlassCard from "./GlassCard.vue";
import { useI18n, type MessageKey } from "../../i18n";

type Kind = "washer" | "dryer" | "dishwasher";

const props = defineProps<{
  kind: Kind;
  /** The appliance's own name; defaults to its kind ("Vaskemaskine"). */
  name?: string;
  reading: ApplianceReading;
  /** Grid rows the card occupies: 1 is a line, 2 compact, 3+ the full card. */
  rows?: number;
}>();

const { t, time, number } = useI18n();

const kindName = computed(() => t(`applianceCard.kind.${props.kind}` as MessageKey));
const title = computed(() => props.name?.trim() || kindName.value);

const state = computed(() => props.reading.state);
const active = computed(() => ["running", "paused", "finished", "error"].includes(state.value));
/** Idle, off and unavailable appliances stay small, whatever their slot. */
const variant = computed(() => {
  const rows = props.rows ?? 3;
  if (rows <= 1 || !active.value) return "line";
  return rows <= 2 ? "compact" : "full";
});

function phaseText(): string | undefined {
  const phase = props.reading.phase;
  if (!phase) return undefined;
  if (phase === "wash" && props.kind === "dishwasher") return t("applianceCard.phase.washDishes");
  return t(`applianceCard.phase.${phase}` as MessageKey);
}

function remainingText(minutes: number): string {
  if (minutes <= 0) return t("applianceCard.almostDone");
  if (minutes < 60) return t("applianceCard.minutesLeft", { minutes });
  return t("applianceCard.hoursLeft", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** The big line: time left, the phase, or what happened. */
const headline = computed(() => {
  const reading = props.reading;
  switch (reading.state) {
    case "running":
      return reading.remainingMinutes !== undefined ? remainingText(reading.remainingMinutes) : (phaseText() ?? t("applianceCard.running"));
    case "paused":
      return t("applianceCard.paused");
    case "finished":
      return t(`applianceCard.finished.${props.kind}` as MessageKey);
    case "error":
      return t("applianceCard.error");
    case "idle":
      return reading.phase === "delayed" ? t("applianceCard.phase.delayed") : t("applianceCard.idle");
    case "off":
      return t("applianceCard.off");
    default:
      return t("applianceCard.unavailable");
  }
});

/** "Færdig kl. 14.35" while running, "Blev færdig kl. 13.10" afterwards. */
const timeLine = computed(() => {
  const { endsAt, state: current } = props.reading;
  if (!endsAt) return undefined;
  if (current === "finished") return t("applianceCard.finishedAt", { time: time(endsAt) });
  if (current === "running" || current === "paused") return t("applianceCard.doneAt", { time: time(endsAt) });
  return undefined;
});

const details = computed(() => {
  const reading = props.reading;
  const items: string[] = [];
  if (reading.program) items.push(reading.program);
  // The phase is the headline when no time is known; otherwise a detail.
  const phase = phaseText();
  if (phase && reading.state === "running" && reading.remainingMinutes !== undefined) items.push(phase);
  if (reading.doorOpen && reading.state === "finished") items.push(t("applianceCard.doorOpen"));
  if (reading.energyTodayKwh !== undefined && reading.energyTodayKwh > 0) {
    items.push(t("applianceCard.energyToday", { kwh: number(reading.energyTodayKwh) }));
  }
  return items;
});

/** One line in a two-row card: when it ends, and the program or phase. */
const compactLine = computed(() => [timeLine.value, details.value[0]].filter(Boolean).join(" · "));

/** A finished one-liner names the appliance in its sentence ("Opvasken er færdig"). */
const showName = computed(() => !(variant.value === "line" && state.value === "finished"));

const progress = computed(() =>
  props.reading.state === "running" || props.reading.state === "paused" ? props.reading.progress : undefined,
);
</script>

<template>
  <GlassCard :className="`appliance-status as-${variant} as-state-${state}`">
    <ApplianceArt :kind="kind" :state="state" :phase="reading.phase" />

    <div class="appliance-text">
      <span v-if="showName" class="eyebrow appliance-name">{{ title }}</span>
      <strong class="appliance-headline">{{ headline }}</strong>
      <span v-if="variant === 'full' && timeLine" class="appliance-time">{{ timeLine }}</span>
      <span v-if="variant === 'compact' && compactLine" class="appliance-time">{{ compactLine }}</span>
      <ul v-if="variant === 'full' && details.length" class="appliance-chips">
        <li v-for="item in details" :key="item">{{ item }}</li>
      </ul>
      <div v-if="variant !== 'line' && progress !== undefined" class="appliance-progress" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${progress}%` }" />
      </div>
    </div>
  </GlassCard>
</template>
