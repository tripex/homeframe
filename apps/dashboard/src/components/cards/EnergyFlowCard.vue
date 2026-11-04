<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BatteryCharging,
  BatteryMedium,
  Car,
  Home,
  Sun,
  UtilityPole,
  Zap,
} from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";
import {
  computeEnergyFlow,
  flowSpeed,
  formatPower,
  type EnergyFlows,
} from "../../energy/energyFlow";

/**
 * Live energy flow between solar, grid, battery, home and an EV/heavy load.
 *
 * Receives plain numbers only. Which sensors feed them is decided by the
 * dashboard's bindings, never by this component. A node is drawn only when
 * its `has*` flag is set, so a home without solar or battery stays calm.
 */
const props = withDefaults(
  defineProps<{
    title?: string;
    solarW?: number;
    gridW?: number;
    batteryW?: number;
    batteryPct?: number;
    evW?: number;
    homeW?: number;
    todayKwh?: number;
    price?: number;
    priceLevel?: "low" | "normal" | "high";
    currency?: string;
    evName?: string;
    hasSolar?: boolean;
    hasGrid?: boolean;
    hasBattery?: boolean;
    hasEv?: boolean;
    maxPowerKw?: number;
  }>(),
  {
    title: "Energy flow",
    currency: "kr/kWh",
    evName: "EV",
    maxPowerKw: 8,
  },
);

const model = computed(() =>
  computeEnergyFlow({
    solarW: props.hasSolar ? props.solarW : undefined,
    gridW: props.hasGrid ? props.gridW : undefined,
    batteryW: props.hasBattery ? props.batteryW : undefined,
    evW: props.hasEv ? props.evW : undefined,
    homeW: props.homeW,
  }),
);

type FlowKey = keyof EnergyFlows;

/** SVG geometry in a fixed 360×300 coordinate space; the SVG scales to the card. */
const nodes = {
  solar: { x: 180, y: 52 },
  grid: { x: 52, y: 150 },
  home: { x: 308, y: 150 },
  battery: { x: 180, y: 248 },
  ev: { x: 308, y: 262 },
} as const;

const flowPaths: Record<FlowKey, { d: string; tone: string; visible: () => boolean }> = {
  solarToHome: { d: "M196 82 C 214 132, 244 144, 276 146", tone: "solar", visible: () => !!props.hasSolar },
  solarToGrid: { d: "M164 82 C 146 132, 116 144, 84 146", tone: "export", visible: () => !!props.hasSolar && !!props.hasGrid },
  solarToBattery: { d: "M180 84 L 180 216", tone: "solar", visible: () => !!props.hasSolar && !!props.hasBattery },
  gridToHome: { d: "M84 154 L 276 154", tone: "grid", visible: () => !!props.hasGrid },
  gridToBattery: { d: "M84 158 C 116 164, 146 176, 164 220", tone: "grid", visible: () => !!props.hasGrid && !!props.hasBattery },
  batteryToHome: { d: "M196 220 C 214 176, 244 164, 276 158", tone: "battery", visible: () => !!props.hasBattery },
  homeToEv: { d: "M308 182 L 308 230", tone: "ev", visible: () => !!props.hasEv },
};

const flowKeys = Object.keys(flowPaths) as FlowKey[];
const visibleFlows = computed(() => flowKeys.filter((key) => flowPaths[key].visible()));

const ACTIVE_THRESHOLD_W = 15;
const isActive = (key: FlowKey) => model.value.flows[key] > ACTIVE_THRESHOLD_W;

// --- Animation -------------------------------------------------------------
// Each active path is a dotted stroke whose dash offset loops forever. Speed is
// changed through the Web Animations API playbackRate, which keeps the phase
// intact, so jittery sensor values never make the dots jump or restart.
const dotPaths = new Map<FlowKey, SVGPathElement>();
const animations = new Map<FlowKey, Animation>();
const reducedMotion = ref(false);

function registerPath(key: FlowKey, element: unknown): void {
  if (element instanceof SVGPathElement) dotPaths.set(key, element);
  else dotPaths.delete(key);
}

function syncAnimations(): void {
  if (reducedMotion.value) return;

  for (const key of visibleFlows.value) {
    const element = dotPaths.get(key);
    if (!element || typeof element.animate !== "function") continue;

    let animation = animations.get(key);
    if (!animation || (animation.effect as KeyframeEffect | null)?.target !== element) {
      animation?.cancel();
      animation = element.animate(
        [{ strokeDashoffset: 0 }, { strokeDashoffset: -24 }],
        { duration: 1000, iterations: Infinity, easing: "linear" },
      );
      animations.set(key, animation);
    }

    const speed = flowSpeed(model.value.flows[key], props.maxPowerKw * 1000);
    if (speed === 0) {
      animation.pause();
    } else {
      animation.updatePlaybackRate(speed);
      if (animation.playState !== "running") animation.play();
    }
  }
}

let motionQuery: MediaQueryList | undefined;
const onMotionChange = (event: MediaQueryListEvent) => {
  reducedMotion.value = event.matches;
  if (event.matches) animations.forEach((animation) => animation.cancel());
  else syncAnimations();
};

onMounted(() => {
  motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  reducedMotion.value = motionQuery?.matches ?? false;
  motionQuery?.addEventListener?.("change", onMotionChange);
  syncAnimations();
});

onBeforeUnmount(() => {
  motionQuery?.removeEventListener?.("change", onMotionChange);
  animations.forEach((animation) => animation.cancel());
  animations.clear();
});

watch([model, visibleFlows], () => queueMicrotask(syncAnimations), { flush: "post" });

// --- Home node donut: where the home's power comes from right now -----------
const RING_RADIUS = 33;
const ringCircumference = 2 * Math.PI * RING_RADIUS;

const homeSources = computed(() => {
  const { flows, loadW } = model.value;
  if (loadW <= 0) return [];

  const parts = [
    { tone: "solar", watts: flows.solarToHome },
    { tone: "battery", watts: flows.batteryToHome },
    { tone: "grid", watts: flows.gridToHome },
  ].filter((part) => part.watts > ACTIVE_THRESHOLD_W);

  const total = parts.reduce((sum, part) => sum + part.watts, 0) || 1;
  let offset = 0;
  return parts.map((part) => {
    const length = (part.watts / total) * ringCircumference;
    const segment = {
      tone: part.tone,
      dasharray: `${Math.max(length - 2, 0)} ${ringCircumference}`,
      dashoffset: -offset,
    };
    offset += length;
    return segment;
  });
});

// --- Labels ------------------------------------------------------------------
const solarLabel = computed(() => formatPower(props.solarW ?? 0));
const homeLabel = computed(() => formatPower(model.value.homeOnlyW));
const evLabel = computed(() => formatPower(props.evW ?? 0));
const batteryLabel = computed(() => formatPower(Math.abs(props.batteryW ?? 0)));
const gridLabel = computed(() =>
  formatPower(model.value.gridExportW > 0 ? model.value.gridExportW : model.value.gridImportW),
);
const exporting = computed(() => model.value.gridExportW > ACTIVE_THRESHOLD_W);
const batteryCharging = computed(() => (props.batteryW ?? 0) < -ACTIVE_THRESHOLD_W);

const selfSufficiencyPct = computed(() => Math.round(model.value.selfSufficiency * 100));
const SMALL_RING = 2 * Math.PI * 22;

const priceText = computed(() =>
  props.price === undefined ? undefined : `${props.price.toFixed(2)} ${props.currency}`,
);
const priceHint = computed(() => {
  if (props.priceLevel === "low") return "Cheap now";
  if (props.priceLevel === "high") return "Expensive now";
  return "Spot price";
});
</script>

<template>
  <GlassCard className="energy-flow-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">ENERGY</span>
        <h2>{{ title }}</h2>
      </div>
      <span v-if="priceText" class="price-chip" :class="priceLevel ?? 'normal'">
        <Zap :size="13" />
        <span>{{ priceHint }}</span>
        <strong>{{ priceText }}</strong>
      </span>
    </div>

    <div class="flow-stage">
      <svg
        class="flow-canvas"
        viewBox="0 0 360 300"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="`Home uses ${homeLabel.value} ${homeLabel.unit}, ${selfSufficiencyPct}% self-sufficient`"
      >
        <!-- Flow lines -->
        <g v-for="key in visibleFlows" :key="key" :class="['flow', flowPaths[key].tone, { active: isActive(key) }]">
          <path class="flow-track" :d="flowPaths[key].d" />
          <path
            class="flow-dots"
            :d="flowPaths[key].d"
            :ref="(element) => registerPath(key, element)"
          />
        </g>

        <!-- Solar -->
        <g v-if="hasSolar" class="node solar" :class="{ active: (solarW ?? 0) > ACTIVE_THRESHOLD_W }">
          <circle :cx="nodes.solar.x" :cy="nodes.solar.y" r="30" class="node-body" />
          <Sun :size="16" :x="nodes.solar.x - 8" :y="nodes.solar.y - 21" class="node-icon" />
          <text :x="nodes.solar.x" :y="nodes.solar.y + 9" class="node-value">
            {{ solarLabel.value }}<tspan class="node-unit"> {{ solarLabel.unit }}</tspan>
          </text>
          <text :x="nodes.solar.x + 44" :y="nodes.solar.y + 4" class="node-label start">Solar</text>
        </g>

        <!-- Grid -->
        <g v-if="hasGrid" class="node" :class="exporting ? 'export active' : ['grid', { active: model.gridImportW > ACTIVE_THRESHOLD_W }]">
          <circle :cx="nodes.grid.x" :cy="nodes.grid.y" r="30" class="node-body" />
          <UtilityPole :size="16" :x="nodes.grid.x - 8" :y="nodes.grid.y - 21" class="node-icon" />
          <text :x="nodes.grid.x" :y="nodes.grid.y + 9" class="node-value">
            {{ gridLabel.value }}<tspan class="node-unit"> {{ gridLabel.unit }}</tspan>
          </text>
          <text :x="nodes.grid.x" :y="nodes.grid.y + 48" class="node-label">
            {{ exporting ? "Selling" : "Grid" }}
          </text>
        </g>

        <!-- Home, ringed by where its power comes from -->
        <g class="node home active">
          <circle :cx="nodes.home.x" :cy="nodes.home.y" r="30" class="node-body" />
          <circle :cx="nodes.home.x" :cy="nodes.home.y" :r="RING_RADIUS" class="ring-track" />
          <circle
            v-for="segment in homeSources"
            :key="segment.tone"
            :cx="nodes.home.x"
            :cy="nodes.home.y"
            :r="RING_RADIUS"
            :class="['ring-segment', segment.tone]"
            :stroke-dasharray="segment.dasharray"
            :stroke-dashoffset="segment.dashoffset"
            :transform="`rotate(-90 ${nodes.home.x} ${nodes.home.y})`"
          />
          <Home :size="16" :x="nodes.home.x - 8" :y="nodes.home.y - 21" class="node-icon" />
          <text :x="nodes.home.x" :y="nodes.home.y + 9" class="node-value">
            {{ homeLabel.value }}<tspan class="node-unit"> {{ homeLabel.unit }}</tspan>
          </text>
          <text :x="nodes.home.x" :y="nodes.home.y - 44" class="node-label">Home</text>
        </g>

        <!-- Battery -->
        <g v-if="hasBattery" class="node battery" :class="{ active: Math.abs(batteryW ?? 0) > ACTIVE_THRESHOLD_W }">
          <circle :cx="nodes.battery.x" :cy="nodes.battery.y" r="30" class="node-body" />
          <component
            :is="batteryCharging ? BatteryCharging : BatteryMedium"
            :size="16"
            :x="nodes.battery.x - 8"
            :y="nodes.battery.y - 21"
            class="node-icon"
          />
          <text :x="nodes.battery.x" :y="nodes.battery.y + 9" class="node-value">
            {{ batteryLabel.value }}<tspan class="node-unit"> {{ batteryLabel.unit }}</tspan>
          </text>
          <text :x="nodes.battery.x - 44" :y="nodes.battery.y + 4" class="node-label end">
            {{ batteryPct !== undefined ? `${Math.round(batteryPct)}%` : "Battery" }}
          </text>
        </g>

        <!-- EV / heavy load -->
        <g v-if="hasEv" class="node ev" :class="{ active: (evW ?? 0) > ACTIVE_THRESHOLD_W }">
          <circle :cx="nodes.ev.x" :cy="nodes.ev.y" r="26" class="node-body" />
          <Car :size="15" :x="nodes.ev.x - 7.5" :y="nodes.ev.y - 19" class="node-icon" />
          <text :x="nodes.ev.x" :y="nodes.ev.y + 8" class="node-value small">
            {{ evLabel.value }}<tspan class="node-unit"> {{ evLabel.unit }}</tspan>
          </text>
          <text :x="nodes.ev.x - 38" :y="nodes.ev.y + 4" class="node-label end">{{ evName }}</text>
        </g>
      </svg>
    </div>

    <div class="card-footer flow-footer">
      <svg class="mini-ring" viewBox="0 0 54 54" aria-hidden="true">
        <circle cx="27" cy="27" r="22" class="ring-track" />
        <circle
          cx="27"
          cy="27"
          r="22"
          class="ring-segment self"
          :stroke-dasharray="`${model.selfSufficiency * SMALL_RING} ${SMALL_RING}`"
          transform="rotate(-90 27 27)"
        />
      </svg>
      <div class="footer-metric">
        <strong>{{ selfSufficiencyPct }}%</strong>
        <span>self-sufficient now</span>
      </div>
      <div v-if="todayKwh !== undefined" class="footer-metric right">
        <strong>{{ todayKwh.toFixed(1) }} kWh</strong>
        <span>used today</span>
      </div>
    </div>
  </GlassCard>
</template>
