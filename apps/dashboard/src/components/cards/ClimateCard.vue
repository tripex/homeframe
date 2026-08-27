<script setup lang="ts">
import { Flame } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

defineProps<{
  zones: Array<{
    name: string;
    current: number;
    target: number;
    heating?: boolean;
  }>;
}>();
</script>

<template>
  <GlassCard className="climate-card" eyebrow="CLIMATE" title="Floor heating">
    <div class="zone-list">
      <div v-for="zone in zones" :key="zone.name" class="zone">
        <span class="zone-name">
          <Flame :size="15" :class="{ warm: zone.heating }" />
          {{ zone.name }}
        </span>

        <span>
          <b>{{ zone.current.toFixed(1) }}°</b>
          <span class="muted"> → {{ zone.target.toFixed(1) }}°</span>
        </span>
      </div>
    </div>
  </GlassCard>
</template>
