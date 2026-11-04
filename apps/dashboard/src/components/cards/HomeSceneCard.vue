<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Flame, Lightbulb, Lock, LockOpen, Thermometer } from "lucide-vue-next";
import type { Atmosphere } from "@homeframe/core";
import type { AtmosphereMode } from "@homeframe/sdk";
import AtmosphereLayer from "../atmosphere/AtmosphereLayer.vue";

export type SceneChip = {
  id: string;
  label: string;
  icon: "lock" | "unlocked" | "light" | "temperature" | "heating";
  tone?: "calm" | "attention";
};

const props = defineProps<{
  title?: string;
  /** Installation photos; either may be missing. */
  dayImage: string;
  nightImage: string;
  night: boolean;
  atmosphere: Atmosphere;
  atmosphereMode: AtmosphereMode;
  chips: SceneChip[];
  /** Light up the drawn house's windows in the fallback scene. */
  lightsOn?: boolean;
}>();

const icons = { lock: Lock, unlocked: LockOpen, light: Lightbulb, temperature: Thermometer, heating: Flame };

// Remember which photos failed to load so the card falls back instead of
// showing a broken image. A day photo dimmed for the night beats no photo.
const failed = ref(new Set<string>());
watch(
  () => [props.dayImage, props.nightImage],
  () => (failed.value = new Set()),
);

const photo = computed(() => {
  const preferred = props.night ? props.nightImage : props.dayImage;
  if (!failed.value.has(preferred)) return { src: preferred, dimmed: false };
  if (props.night && !failed.value.has(props.dayImage)) return { src: props.dayImage, dimmed: true };
  return undefined;
});

function markFailed(src: string): void {
  failed.value = new Set([...failed.value, src]);
}
</script>

<template>
  <section class="glass-card home-scene" :class="{ 'home-scene-night': night }">
    <img
      v-if="photo"
      :key="photo.src"
      class="home-scene-photo"
      :class="{ dimmed: photo.dimmed }"
      :src="photo.src"
      alt=""
      @error="markFailed(photo.src)"
    />

    <template v-else>
      <AtmosphereLayer :atmosphere="atmosphere" :mode="atmosphereMode" contained />
      <!-- A quiet drawn house for installations without their own photo. -->
      <svg class="home-scene-house" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <path class="house-ground" d="M0 182 Q200 168 400 182 L400 200 L0 200 Z" />
        <path class="house-body" d="M110 182 V108 L200 52 L290 108 V182 Z" />
        <path class="house-roof" d="M96 114 L200 46 L304 114" />
        <rect class="house-chimney" x="244" y="64" width="14" height="28" />
        <g :class="['house-windows', { lit: lightsOn }]">
          <rect x="136" y="122" width="30" height="24" rx="2" />
          <rect x="234" y="122" width="30" height="24" rx="2" />
          <rect x="188" y="88" width="24" height="20" rx="2" />
        </g>
        <rect class="house-door" x="186" y="140" width="28" height="42" rx="2" />
      </svg>
    </template>

    <div class="home-scene-shade" />

    <div class="home-scene-content">
      <h2 v-if="title" class="home-scene-title">{{ title }}</h2>
      <ul class="home-scene-chips">
        <li v-for="chip in chips" :key="chip.id" :class="['scene-chip', `scene-chip-${chip.tone ?? 'calm'}`]">
          <component :is="icons[chip.icon]" :size="15" />
          <span>{{ chip.label }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
