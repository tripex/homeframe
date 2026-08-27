<script setup lang="ts">
import { Zap } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

defineProps<{
  watts: number;
  todayKwh?: number;
}>();

const demoSparkline = [25, 38, 31, 56, 48, 72, 61, 44, 35, 52, 42, 30];
</script>

<template>
  <GlassCard className="energy-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">ENERGY</span>
        <h2>Live usage</h2>
      </div>
      <Zap :size="20" />
    </div>

    <strong class="hero-number">
      {{ (watts / 1000).toFixed(2) }}<small> kW</small>
    </strong>

    <div class="sparkline" aria-hidden="true">
      <i
        v-for="(height, index) in demoSparkline"
        :key="index"
        :style="{ height: `${height}%` }"
      />
    </div>

    <div class="card-footer">
      <span>Today</span>
      <strong>{{ todayKwh?.toFixed(1) ?? "—" }} kWh</strong>
    </div>
  </GlassCard>
</template>
