<script setup lang="ts">
import { Flame, Minus, Plus } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

defineProps<{
  zones: Array<{
    id?: string;
    name: string;
    current: number;
    target: number;
    heating?: boolean;
  }>;
  controllable?: boolean;
  pending?: boolean;
}>();

const emit = defineEmits<{
  "set-temperature": [{ zoneId: string | undefined; temperature: number }];
}>();

function step(zoneId: string | undefined, target: number, delta: number): void {
  // Round to one decimal to avoid floating point noise (e.g. 21.30000001).
  const temperature = Math.round((target + delta) * 10) / 10;
  emit("set-temperature", { zoneId, temperature });
}
</script>

<template>
  <GlassCard className="climate-card" eyebrow="CLIMATE" title="Floor heating">
    <div class="zone-list">
      <div v-for="zone in zones" :key="zone.name" class="zone">
        <span class="zone-name">
          <Flame :size="15" :class="{ warm: zone.heating }" />
          {{ zone.name }}
        </span>

        <span class="zone-target">
          <b>{{ zone.current.toFixed(1) }}°</b>
          <span class="muted"> → {{ zone.target.toFixed(1) }}°</span>

          <span v-if="controllable" class="zone-controls">
            <button
              type="button"
              class="icon-button zone-step"
              :disabled="pending"
              :aria-label="`Lower target temperature for ${zone.name}`"
              @click="step(zone.id, zone.target, -0.5)"
            >
              <Minus :size="13" />
            </button>
            <button
              type="button"
              class="icon-button zone-step"
              :disabled="pending"
              :aria-label="`Raise target temperature for ${zone.name}`"
              @click="step(zone.id, zone.target, 0.5)"
            >
              <Plus :size="13" />
            </button>
          </span>
        </span>
      </div>
    </div>
  </GlassCard>
</template>
