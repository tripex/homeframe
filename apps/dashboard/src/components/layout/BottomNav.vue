<script setup lang="ts">
import {
  ChartNoAxesColumnIncreasing,
  House,
  LayoutGrid,
  Settings,
  Sparkles,
} from "lucide-vue-next";

const items = [
  { label: "Home", icon: House },
  { label: "Rooms", icon: LayoutGrid },
  { label: "Energy", icon: ChartNoAxesColumnIncreasing },
  { label: "Automations", icon: Sparkles },
  { label: "Settings", icon: Settings },
];
</script>

<template>
  <nav class="bottom-nav" aria-label="Dashboard navigation">
    <button
      v-for="(item, index) in items"
      :key="item.label"
      :class="{ active: index === 0 }"
      type="button"
    >
      <component :is="item.icon" :size="19" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>
