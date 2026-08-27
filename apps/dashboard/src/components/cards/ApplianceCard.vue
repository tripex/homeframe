<script setup lang="ts">
import { Bot, WashingMachine } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

const props = defineProps<{
  kind: "washer" | "dryer" | "vacuum";
  title: string;
  state: string;
  detail?: string;
  progress?: number;
}>();

const icons = {
  washer: WashingMachine,
  dryer: WashingMachine,
  vacuum: Bot,
};
</script>

<template>
  <GlassCard>
    <div class="room-top">
      <div>
        <span class="eyebrow">{{ kind.toUpperCase() }}</span>
        <h2>{{ title }}</h2>
      </div>
      <component :is="icons[props.kind]" :size="21" />
    </div>

    <div class="appliance-state">
      <strong>{{ state }}</strong>
      <span v-if="detail" class="muted">{{ detail }}</span>
    </div>

    <div v-if="progress !== undefined" class="progress">
      <span :style="{ width: `${progress}%` }" />
    </div>
  </GlassCard>
</template>
