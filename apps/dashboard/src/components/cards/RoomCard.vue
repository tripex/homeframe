<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Droplets, Lightbulb } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";
import { translate as t, useI18n } from "../../i18n";

const props = defineProps<{
  name: string;
  temperature?: number;
  humidity?: number;
  lightsOn?: number;
  active?: boolean;
  controllable?: boolean;
  pending?: boolean;
}>();

defineEmits<{
  "toggle-lights": [];
}>();

const { number } = useI18n();

const lightsLabel = computed(() => {
  const on = props.lightsOn ?? 0;
  if (on === 0) return t("room.lightsOff");
  return on === 1 ? t("scene.lightsOn.one") : t("scene.lightsOn.other", { count: on });
});

const formattedTemperature = computed(() =>
  props.temperature === undefined ? "—" : number(Math.round(props.temperature * 10) / 10),
);
</script>

<template>
  <GlassCard className="room-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">{{ t("room.eyebrow") }}</span>
        <h2>{{ name }}</h2>
      </div>
      <div class="room-top-actions">
        <button
          v-if="controllable"
          type="button"
          class="icon-button card-toggle"
          :class="{ active }"
          :disabled="pending"
          :aria-label="t('room.toggleLights', { name })"
          @click="$emit('toggle-lights')"
        >
          <Lightbulb :size="15" />
        </button>
        <ChevronRight :size="20" class="muted" />
      </div>
    </div>

    <div class="metric-row">
      <div>
        <strong class="hero-number">{{ formattedTemperature }}°</strong>
        <span class="metric-label">{{ t("room.temperature") }}</span>
      </div>

      <div v-if="humidity !== undefined" class="side-metric">
        <Droplets :size="16" />
        <strong>{{ number(Math.round(humidity)) }}%</strong>
        <span>{{ t("room.humidity") }}</span>
      </div>
    </div>

    <div class="card-footer">
      <span class="status-dot" :class="{ active }" />
      <Lightbulb :size="15" />
      <span>{{ lightsLabel }}</span>
    </div>
  </GlassCard>
</template>
