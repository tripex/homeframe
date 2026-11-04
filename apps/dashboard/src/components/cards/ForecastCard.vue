<script setup lang="ts">
import { computed } from "vue";
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  Wind,
} from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

export type ForecastDayView = {
  date: string;
  condition?: string;
  high?: number;
  low?: number;
  precipitationProbability?: number;
};

const props = defineProps<{
  days: ForecastDayView[];
  maxDays?: number;
  loading?: boolean;
}>();

const { t, has, weekday, number } = useI18n();

/** Home Assistant weather conditions mapped onto a small icon set. */
const ICONS: Record<string, unknown> = {
  "clear-night": Moon,
  cloudy: Cloud,
  fog: CloudFog,
  hail: CloudSnow,
  lightning: CloudLightning,
  "lightning-rainy": CloudLightning,
  partlycloudy: CloudSun,
  pouring: CloudRain,
  rainy: CloudRain,
  snowy: CloudSnow,
  "snowy-rainy": CloudSnow,
  sunny: Sun,
  windy: Wind,
  "windy-variant": Wind,
};

const visible = computed(() =>
  props.days.slice(0, props.maxDays ?? 5).map((day, index) => {
    const date = new Date(day.date);
    const conditionKey = `weather.${day.condition}`;
    return {
      ...day,
      label: index === 0 && date.toDateString() === new Date().toDateString() ? t("forecast.today") : weekday(date),
      icon: ICONS[day.condition ?? ""] ?? Cloud,
      conditionLabel: has(conditionKey) ? t(conditionKey) : day.condition ?? "",
    };
  }),
);
</script>

<template>
  <GlassCard className="forecast-card">
    <span class="eyebrow">{{ t("forecast.eyebrow") }}</span>
    <ol v-if="visible.length" class="forecast-days">
      <li v-for="day in visible" :key="day.date" :title="day.conditionLabel">
        <span class="forecast-day">{{ day.label }}</span>
        <component :is="day.icon" :size="20" class="forecast-icon" />
        <span class="forecast-temps">
          <strong v-if="day.high !== undefined">{{ number(Math.round(day.high)) }}°</strong>
          <span v-if="day.low !== undefined" class="muted">{{ number(Math.round(day.low)) }}°</span>
        </span>
      </li>
    </ol>
    <p v-else-if="!loading" class="card-empty">{{ t("forecast.empty") }}</p>
  </GlassCard>
</template>
