<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Droplets, Lightbulb } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

const props = defineProps<{
  name: string;
  temperature?: number;
  humidity?: number;
  lightsOn?: number;
  active?: boolean;
}>();

const formattedTemperature = computed(() =>
  props.temperature === undefined ? "—" : props.temperature.toFixed(1),
);
</script>

<template>
  <GlassCard className="room-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">ROOM</span>
        <h2>{{ name }}</h2>
      </div>
      <ChevronRight :size="20" class="muted" />
    </div>

    <div class="metric-row">
      <div>
        <strong class="hero-number">{{ formattedTemperature }}°</strong>
        <span class="metric-label">Temperature</span>
      </div>

      <div class="side-metric">
        <Droplets :size="16" />
        <strong>{{ humidity ?? "—" }}%</strong>
        <span>Humidity</span>
      </div>
    </div>

    <div class="card-footer">
      <span class="status-dot" :class="{ active }" />
      <Lightbulb :size="15" />
      <span>{{ lightsOn ?? 0 }} lights on</span>
    </div>
  </GlassCard>
</template>
