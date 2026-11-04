<script setup lang="ts">
import { House, LayoutDashboard, Monitor, Tablet, Thermometer } from "lucide-vue-next";
import PersonAvatar from "../cards/PersonAvatar.vue";
import type { PersonView } from "../cards/PresenceCard.vue";
import { useI18n } from "../../i18n";

/**
 * Left navigation for landscape tablets and desktops: the outdoor temperature
 * where the eye lands first, the screen's dashboards in the middle and the
 * household at the bottom. Phones keep BottomNav.
 */
defineProps<{
  outdoorTemperature?: string;
  outdoorCondition?: string;
  views: Array<{ id: string; name: string; active: boolean }>;
  /** Dashboards made for other screens, e.g. the wall tablet's on a desktop. */
  otherViews?: Array<{ id: string; name: string; profile: string }>;
  people: PersonView[];
}>();

const emit = defineEmits<{ select: [id: string] }>();

const { t } = useI18n();
</script>

<template>
  <nav class="side-nav" :aria-label="t('nav.label')">
    <div class="side-nav-outdoor">
      <Thermometer :size="16" class="muted" />
      <div>
        <strong>{{ outdoorTemperature ?? "—" }}</strong>
        <span>{{ outdoorCondition ?? t("nav.outside") }}</span>
      </div>
    </div>

    <ul class="side-nav-views">
      <li v-for="(view, index) in views" :key="view.id">
        <button type="button" :class="{ active: view.active }" @click="emit('select', view.id)">
          <component :is="index === 0 ? House : LayoutDashboard" :size="18" />
          <span>{{ view.name }}</span>
        </button>
      </li>
    </ul>

    <section v-if="otherViews?.length" class="side-nav-other">
      <h2>{{ t("nav.otherScreens") }}</h2>
      <ul class="side-nav-views">
        <li v-for="view in otherViews" :key="view.id">
          <button type="button" @click="emit('select', view.id)">
            <component :is="view.profile === 'desktop' ? Monitor : view.profile === 'tablet-10' ? Tablet : LayoutDashboard" :size="18" />
            <span>{{ view.name }}</span>
          </button>
        </li>
      </ul>
    </section>

    <ul v-if="people.length" class="side-nav-people" :aria-label="t('nav.people')">
      <li v-for="person in people" :key="person.id" :title="`${person.name} · ${person.home ? t('presence.home') : t('presence.away')}`">
        <PersonAvatar :name="person.name" :home="person.home" :size="34" />
        <span>{{ person.name }}</span>
      </li>
    </ul>
  </nav>
</template>
