<script setup lang="ts">
import { WifiOff } from "lucide-vue-next";
import { computed } from "vue";
import type { LiveDataReason } from "@homeframe/core";
import { useI18n } from "../../i18n";

/**
 * Says, unmistakably but without covering the dashboard, that the values on
 * screen may be old. A wall tablet is glanced at, not read: without this a
 * frozen dashboard looks exactly like a quiet house.
 */
const props = defineProps<{
  reason: LiveDataReason;
  /** When the data was last known live (ms epoch), if ever. */
  lastFreshAt?: number;
  now: number;
}>();

const { t, time, ago } = useI18n();

// A runtime that has never reached Home Assistant has no "last known values" to speak of.
const title = computed(() => {
  if (props.reason === "runtime") return t("connection.lostRuntime");
  return props.lastFreshAt === undefined ? t("connection.notYetConnected") : t("connection.lostHomeAssistant");
});

const lastUpdated = computed(() =>
  props.lastFreshAt === undefined
    ? undefined
    : t("connection.lastUpdated", {
        time: time(new Date(props.lastFreshAt)),
        ago: ago(Math.max(0, props.now - props.lastFreshAt)),
      }),
);
</script>

<template>
  <div class="connection-banner" role="status" aria-live="polite">
    <WifiOff class="connection-banner-icon" :size="18" aria-hidden="true" />
    <div class="connection-banner-text">
      <strong>{{ title }}</strong>
      <span>
        <span class="connection-banner-pulse" aria-hidden="true" />
        {{ t("connection.reconnecting") }}
        <template v-if="lastUpdated"> · {{ lastUpdated }}</template>
      </span>
    </div>
  </div>
</template>
