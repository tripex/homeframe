<script setup lang="ts">
import GlassCard from "./GlassCard.vue";
import PersonAvatar from "./PersonAvatar.vue";
import { useI18n } from "../../i18n";

export type PersonView = { id: string; name: string; home: boolean };

defineProps<{ people: PersonView[] }>();

const { t } = useI18n();
</script>

<template>
  <GlassCard className="presence-card">
    <span class="eyebrow">{{ t("presence.title").toUpperCase() }}</span>
    <ul v-if="people.length" class="presence-list">
      <li v-for="person in people" :key="person.id">
        <PersonAvatar :name="person.name" :home="person.home" />
        <span>{{ person.name }}</span>
        <small class="muted">{{ person.home ? t("presence.home") : t("presence.away") }}</small>
      </li>
    </ul>
    <p v-else class="card-empty">{{ t("presence.empty") }}</p>
  </GlassCard>
</template>
