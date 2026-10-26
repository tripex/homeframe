<script setup lang="ts">
import { CloudSun, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import type { SkyPhase } from "@homeframe/core";
import { useSkyPreview } from "../../composables/useAtmosphere";

/**
 * Lets demo visitors try every sky. Only rendered in the demo build or with
 * `?preview`; a real installation follows its own sun and weather.
 */
const props = defineProps<{
  /** The phase currently on screen, so "Clear" picks sunny or clear-night. */
  currentPhase: SkyPhase;
}>();

const { preview, setSkyPreview } = useSkyPreview();
const open = ref(false);

const phases: Array<{ label: string; value?: SkyPhase }> = [
  { label: "Now" },
  { label: "Dawn", value: "dawn" },
  { label: "Day", value: "day" },
  { label: "Dusk", value: "dusk" },
  { label: "Night", value: "night" },
];

// Values are Home Assistant weather conditions, so the preview runs through
// exactly the mapping a live weather entity would.
const weathers = computed(() => [
  { label: "Clear", value: props.currentPhase === "night" ? "clear-night" : "sunny" },
  { label: "Clouds", value: "partlycloudy" },
  { label: "Rain", value: "rainy" },
  { label: "Storm", value: "lightning-rainy" },
  { label: "Snow", value: "snowy" },
  { label: "Fog", value: "fog" },
]);

function isClear(value: string | undefined): boolean {
  return value === "sunny" || value === "clear-night";
}

function weatherSelected(value: string): boolean {
  const current = preview.value.condition;
  return current === value || (isClear(value) && isClear(current));
}
</script>

<template>
  <div class="sky-switcher">
    <section v-if="open" id="sky-switcher-panel" class="sky-panel" aria-label="Preview the sky">
      <header class="sky-panel-header">
        <h2>Preview the sky</h2>
        <button type="button" class="icon-button sky-close" aria-label="Close sky preview" @click="open = false">
          <X :size="15" />
        </button>
      </header>

      <div class="sky-group" role="group" aria-label="Time of day">
        <button
          v-for="phase in phases"
          :key="phase.label"
          type="button"
          class="sky-chip"
          :aria-pressed="preview.phase === phase.value"
          @click="setSkyPreview({ ...preview, phase: phase.value })"
        >
          {{ phase.label }}
        </button>
      </div>

      <div class="sky-group" role="group" aria-label="Weather">
        <button
          v-for="weather in weathers"
          :key="weather.label"
          type="button"
          class="sky-chip"
          :aria-pressed="weatherSelected(weather.value)"
          @click="setSkyPreview({ ...preview, condition: weather.value })"
        >
          {{ weather.label }}
        </button>
      </div>

      <p class="sky-note">At home this follows your real sun and weather.</p>
    </section>

    <button
      type="button"
      class="sky-toggle"
      :aria-expanded="open"
      aria-controls="sky-switcher-panel"
      @click="open = !open"
    >
      <CloudSun :size="17" />
      <span>Change sky</span>
    </button>
  </div>
</template>
