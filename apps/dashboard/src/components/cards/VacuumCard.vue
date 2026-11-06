<script setup lang="ts">
import { Bot, Home, Pause, Play } from "lucide-vue-next";
import { computed } from "vue";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

const props = defineProps<{
  title: string;
  state: string;
  detail?: string;
  progress?: number;
  /** A two-row slot: title, state and buttons on one line. */
  compact?: boolean;
  controllable?: boolean;
  running?: boolean;
  pending?: boolean;
}>();

defineEmits<{
  "start-pause": [];
  "return-home": [];
}>();

const { t, has } = useI18n();

const eyebrow = computed(() => t("appliance.vacuum"));

/** Home Assistant vacuum states read better translated; sensor text stays as is. */
const stateLabel = computed(() => {
  const key = `vacuum.${props.state}`;
  return has(key) ? t(key) : props.state;
});

</script>

<template>
  <GlassCard v-if="compact" className="appliance-card appliance-compact">
    <Bot :size="21" class="appliance-icon" />
    <div class="appliance-compact-text">
      <span class="eyebrow">{{ title }}</span>
      <strong>{{ stateLabel }}</strong>
    </div>
    <div v-if="controllable" class="appliance-actions">
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

  <GlassCard v-else className="appliance-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
      </div>
      <Bot :size="21" />
    </div>

    <div class="appliance-state">
      <strong>{{ stateLabel }}</strong>
      <span v-if="detail" class="muted">{{ detail }}</span>
    </div>

    <div v-if="progress !== undefined" class="progress">
      <span :style="{ width: `${progress}%` }" />
    </div>

    <div v-if="controllable" class="appliance-actions">
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
