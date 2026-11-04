<script setup lang="ts">
import { DoorOpen, Lock, LockOpen, Moon, ShieldCheck } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

/**
 * Read-only security overview. Changing a lock, alarm or garage is a
 * `security` action and is deliberately not offered here.
 */
defineProps<{
  /** "secure" | "attention" | "review" — derived from bound entities, never set by hand. */
  status?: "secure" | "attention" | "review";
  nightModeStatus?: string;
  /** One-line variant for a narrow status column. */
  compact?: boolean;
}>();

const { t } = useI18n();
const LABELS = { secure: "security.secure", attention: "security.attention", review: "security.review" } as const;
</script>

<template>
  <GlassCard v-if="compact" className="security-card security-compact" :class="`security-${status ?? 'review'}`">
    <component :is="status === 'secure' ? Lock : LockOpen" :size="18" />
    <span>{{ t("security.locks") }}</span>
    <strong>{{ t(LABELS[status ?? "review"]) }}</strong>
  </GlassCard>

  <GlassCard v-else className="security-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">{{ t("security.eyebrow") }}</span>
        <h2>{{ t("security.title") }}</h2>
      </div>
      <ShieldCheck :size="22" />
    </div>

    <div class="security-row">
      <DoorOpen :size="17" />
      <span>{{ t("security.doorsAndWindows") }}</span>
      <strong>{{ t(LABELS[status ?? "review"]) }}</strong>
    </div>

    <div class="security-row">
      <Moon :size="17" />
      <span>{{ t("security.nightMode") }}</span>
      <strong>{{ nightModeStatus ?? t("security.ready") }}</strong>
    </div>
  </GlassCard>
</template>
