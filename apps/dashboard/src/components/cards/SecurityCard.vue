<script setup lang="ts">
import { DoorOpen, Moon, ShieldCheck } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";

defineProps<{
  doorsAndWindowsStatus?: string;
  nightModeStatus?: string;
}>();
</script>

<template>
  <GlassCard className="security-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">SECURITY</span>
        <h2>Status</h2>
      </div>
      <ShieldCheck :size="22" />
    </div>

    <div class="security-row">
      <DoorOpen :size="17" />
      <span>Doors & windows</span>
      <strong>{{ doorsAndWindowsStatus ?? "Review" }}</strong>
    </div>

    <div class="security-row">
      <Moon :size="17" />
      <span>Night mode</span>
      <strong>{{ nightModeStatus ?? "Ready" }}</strong>
    </div>
  </GlassCard>
</template>
