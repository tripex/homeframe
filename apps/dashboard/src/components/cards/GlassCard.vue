<script setup lang="ts">
defineProps<{
  eyebrow?: string;
  title?: string;
  className?: string;
}>();
</script>

<template>
  <section class="glass-card" :class="className">
    <header v-if="eyebrow || title" class="card-header">
      <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
      <h2 v-if="title">{{ title }}</h2>
    </header>

    <slot />
  </section>
</template>
