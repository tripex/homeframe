<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ name: string; home: boolean; size?: number }>();

/**
 * Initials rather than Home Assistant's entity_picture: those pictures are
 * served by Home Assistant behind its own auth, and the browser has none.
 */
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join(""),
);
</script>

<template>
  <span
    class="person-avatar"
    :class="{ home }"
    :style="size ? { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` } : undefined"
    :aria-label="name"
  >
    {{ initials }}
  </span>
</template>
