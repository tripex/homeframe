<script setup lang="ts">
import { Bot, Home, Pause, Play, WashingMachine } from "lucide-vue-next";
import { computed } from "vue";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

const props = defineProps<{
  kind: "washer" | "dryer" | "vacuum";
  title: string;
  state: string;
  detail?: string;
  progress?: number;
  controllable?: boolean;
  running?: boolean;
  pending?: boolean;
}>();

defineEmits<{
  "start-pause": [];
  "return-home": [];
}>();

const { t, has } = useI18n();

const eyebrow = computed(() => {
  const key = `appliance.${props.kind}`;
  return has(key) ? t(key) : props.kind.toUpperCase();
});

/** Home Assistant vacuum states read better translated; sensor text stays as is. */
const stateLabel = computed(() => {
  const key = `vacuum.${props.state}`;
  return props.kind === "vacuum" && has(key) ? t(key) : props.state;
});

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
        <span class="eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
      </div>
      <component :is="icons[props.kind]" :size="21" />
    </div>

    <div class="appliance-state">
      <strong>{{ stateLabel }}</strong>
      <span v-if="detail" class="muted">{{ detail }}</span>
    </div>

    <div v-if="progress !== undefined" class="progress">
      <span :style="{ width: `${progress}%` }" />
    </div>

    <div v-if="kind === 'vacuum' && controllable" class="appliance-actions">
      <button
        type="button"
        class="icon-button appliance-action"
        :disabled="pending"
        :aria-label="running ? 'Pause vacuum' : 'Start vacuum'"
        @click="$emit('start-pause')"
      >
        <component :is="running ? Pause : Play" :size="15" />
      </button>
      <button
        type="button"
        class="icon-button appliance-action"
        :disabled="pending"
        aria-label="Send vacuum home"
        @click="$emit('return-home')"
      >
        <Home :size="15" />
      </button>
    </div>
  </GlassCard>
</template>
