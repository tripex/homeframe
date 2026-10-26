<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Atmosphere, SkyPhase } from "@homeframe/core";
import type { AtmosphereMode } from "@homeframe/sdk";
import { WeatherCanvas } from "./weatherCanvas";

const props = defineProps<{
  atmosphere: Atmosphere;
  mode: AtmosphereMode;
  /** Ease between skies in about a second instead of a minute (sky previews). */
  quick?: boolean;
}>();

type Palette = { top: string; mid: string; horizon: string; glow: string };

/**
 * Skies tuned for a dark glass UI: even "day" is a deep steel blue so cards
 * stay readable on a wall tablet in a bright room. The warmth lives near the
 * horizon, where it would be in a real sky.
 */
const PALETTES: Record<SkyPhase, Palette> = {
  night: { top: "#060a14", mid: "#0b1122", horizon: "#141d36", glow: "#dfe7ff" },
  dawn: { top: "#121731", mid: "#3b3352", horizon: "#c98a6e", glow: "#ffc59a" },
  day: { top: "#102338", mid: "#1d3d5a", horizon: "#3c6a8c", glow: "#fff1d6" },
  dusk: { top: "#0f1329", mid: "#3a2747", horizon: "#b65f45", glow: "#ff9e6e" },
};

/** Overcast skies drift toward slate; this is the color they drift to. */
const OVERCAST = "#262d38";

function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  const channel = (index: number) =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const reducedMotion = ref(false);
const settled = ref(false);
let motionQuery: MediaQueryList | undefined;
const updateMotion = () => {
  reducedMotion.value = Boolean(motionQuery?.matches);
};

const skyStyle = computed(() => {
  const { phase, cloudCover, arcProgress, sunElevation, daylight } = props.atmosphere;
  const palette = PALETTES[props.mode === "off" ? "night" : phase];
  const overcast = props.mode === "off" ? 0 : cloudCover * 0.6;

  // While the sun is up (or just below the horizon at dawn/dusk) the light
  // source follows the sun's arc; at night it becomes the moon.
  const isMoon = phase === "night";
  const x = 8 + arcProgress * 84;
  // The visible sky is the header band above the cards, so the light travels
  // within it: low at sunrise/sunset (just above the cards, like a horizon),
  // highest at noon. A Danish winter sun barely clears 12°, so a third of the
  // band is reached by ~6° and the rest is spread over the next 30°.
  const height = isMoon
    ? 0.35 + Math.sin(arcProgress * Math.PI) * 0.55
    : Math.min(Math.max(((sunElevation ?? Math.sin(arcProgress * Math.PI) * 30) + 6) / 36, 0), 1);
  const y = 36 - height * 28;

  return {
    "--sky-top": mix(palette.top, OVERCAST, overcast * 0.7),
    "--sky-mid": mix(palette.mid, OVERCAST, overcast),
    "--sky-horizon": mix(palette.horizon, OVERCAST, overcast),
    "--glow": palette.glow,
    "--glow-x": `${x}%`,
    "--glow-y": `${y}%`,
    // Clouds swallow the light source; a moon stays small and crisp.
    "--glow-strength": String(
      props.mode === "off" ? 0 : (isMoon ? 0.55 : 0.35 + daylight * 0.45) * (1 - cloudCover * 0.75),
    ),
    "--haze": String(props.mode === "off" ? 0 : cloudCover),
  };
});

const showMoon = computed(
  () => props.mode !== "off" && props.atmosphere.phase === "night" && props.atmosphere.cloudCover < 0.8,
);

const canvas = ref<HTMLCanvasElement>();
let renderer: WeatherCanvas | undefined;
const animate = computed(() => props.mode === "live" && !reducedMotion.value);

function sync(): void {
  if (!renderer) return;
  const scene = props.mode === "live" ? props.atmosphere : { ...props.atmosphere, weather: "clear" as const, precipitation: 0 };
  renderer.update(scene, { animate: animate.value });
  if (animate.value) renderer.start();
  else renderer.stop();
}

const onResize = () => renderer?.resize();

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  updateMotion();
  motionQuery.addEventListener("change", updateMotion);

  if (canvas.value && props.mode !== "off") {
    try {
      renderer = new WeatherCanvas(canvas.value, props.atmosphere, { animate: animate.value });
      sync();
    } catch {
      // No 2D canvas (very old embedded browsers): the gradient sky still works.
      renderer = undefined;
    }
  }
  window.addEventListener("resize", onResize);
  // Two frames: the first paints the initial sky, after that changes ease.
  requestAnimationFrame(() => requestAnimationFrame(() => (settled.value = true)));
});

watch(
  () => [props.atmosphere.weather, props.atmosphere.precipitation, props.atmosphere.phase, props.mode, animate.value],
  sync,
);

onUnmounted(() => {
  renderer?.stop();
  motionQuery?.removeEventListener("change", updateMotion);
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <div class="atmosphere" :class="[`atmosphere-${mode}`, { 'atmosphere-settled': settled, 'atmosphere-quick': quick }]" :style="skyStyle" aria-hidden="true">
    <div class="atmosphere-sky" />
    <div class="atmosphere-light" />
    <div v-if="showMoon" class="atmosphere-moon" />
    <div class="atmosphere-haze" />
    <canvas v-if="mode !== 'off'" ref="canvas" class="atmosphere-canvas" />
    <div class="atmosphere-floor" />
  </div>
</template>
