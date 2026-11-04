<script setup lang="ts">
import { computed } from "vue";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

export type AgendaEventView = {
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName?: string;
};

const props = defineProps<{
  events: AgendaEventView[];
  /** False when no calendar is bound at all, which deserves a different hint. */
  hasCalendars: boolean;
  maxEvents?: number;
  loading?: boolean;
}>();

const { t, time, weekday } = useI18n();

/** All-day dates ("2026-11-04") are local dates, not UTC midnight. */
function startDate(event: AgendaEventView): Date {
  if (!event.allDay) return new Date(event.start);
  const [year, month, day] = event.start.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  if (days <= 0) return t("agenda.today");
  if (days === 1) return t("agenda.tomorrow");
  return `${weekday(date)} ${date.getDate()}.`;
}

/** Events grouped under day headings, soonest first. */
const groups = computed(() => {
  const result: Array<{ label: string; events: Array<AgendaEventView & { when: string }> }> = [];
  for (const event of props.events.slice(0, props.maxEvents ?? 6)) {
    const date = startDate(event);
    const label = dayLabel(date);
    let group = result.find((candidate) => candidate.label === label);
    if (!group) {
      group = { label, events: [] };
      result.push(group);
    }
    group.events.push({ ...event, when: event.allDay ? t("agenda.allDay") : time(date) });
  }
  return result;
});
</script>

<template>
  <GlassCard className="agenda-card">
    <span class="eyebrow">{{ t("agenda.eyebrow") }}</span>
    <div v-if="groups.length" class="agenda-groups">
      <section v-for="group in groups" :key="group.label" class="agenda-group">
        <h3>{{ group.label }}</h3>
        <p v-for="event in group.events" :key="`${event.start}-${event.summary}`" class="agenda-event">
          <span class="agenda-when">{{ event.when }}</span>
          <span class="agenda-summary">{{ event.summary }}</span>
        </p>
      </section>
    </div>
    <p v-else-if="!loading" class="card-empty">
      {{ hasCalendars ? t("agenda.empty") : t("agenda.noCalendars") }}
    </p>
  </GlassCard>
</template>
