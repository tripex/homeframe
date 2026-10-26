<script setup lang="ts">
import { computed } from "vue";
import { Zap } from "lucide-vue-next";
import type { EnergySummary } from "@homeframe/core";
import GlassCard from "./GlassCard.vue";

const props = defineProps<{
  watts: number;
  title?: string;
  summary?: EnergySummary;
  currency?: string;
  currencyLabel?: string;
}>();

const CHART_WIDTH = 240;
const CHART_HEIGHT = 46;

function money(value: number | undefined, digits = 2): string | undefined {
  if (value === undefined) return undefined;
  if (props.currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: props.currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    } catch {
      // Unknown currency code from a prop: fall through to the plain format.
    }
  }
  const number = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return props.currencyLabel ? `${number} ${props.currencyLabel}` : number;
}

function kwh(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const kilowatts = computed(() =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(props.watts / 1000),
);

const hours = computed(() => props.summary?.hours ?? []);
const currentHourIndex = computed(() => {
  const now = Date.now();
  return hours.value.findIndex((hour, index) => {
    const next = hours.value[index + 1]?.start ?? hour.start + 3_600_000;
    return hour.start <= now && now < next;
  });
});

const bars = computed(() => {
  const list = hours.value;
  if (!list.length) return [];
  const max = Math.max(0.1, ...list.map((hour) => hour.kwh ?? 0));
  const slot = CHART_WIDTH / list.length;

  return list.map((hour, index) => {
    const known = hour.kwh !== undefined;
    // Bars keep to the lower part of the chart so the price line above them
    // never hides a bar.
    const height = known ? Math.max(2, ((hour.kwh as number) / max) * (CHART_HEIGHT * 0.62)) : 2;
    return {
      key: hour.start,
      x: index * slot + 1,
      width: Math.max(slot - 2, 1),
      y: CHART_HEIGHT - height,
      height,
      state: index === currentHourIndex.value ? "now" : known ? "past" : "future",
    };
  });
});

/** The price as a quiet stepped line over the bars, scaled to its own range. */
const priceLine = computed(() => {
  const list = hours.value;
  if (props.summary?.pricing !== "dynamic") return undefined;
  const prices = list.map((hour) => hour.price);
  const known = prices.filter((price): price is number => price !== undefined);
  if (known.length < 2) return undefined;

  const min = Math.min(...known);
  const range = Math.max(Math.max(...known) - min, 0.01);
  const slot = CHART_WIDTH / list.length;
  const y = (price: number) => 2 + (1 - (price - min) / range) * (CHART_HEIGHT * 0.3);

  const points: string[] = [];
  prices.forEach((price, index) => {
    if (price === undefined) return;
    points.push(`${index * slot},${y(price)}`, `${(index + 1) * slot},${y(price)}`);
  });

  const cheapest = props.summary.cheapestUpcoming;
  const cheapestIndex = cheapest ? list.findIndex((hour) => hour.start === cheapest.start) : -1;

  return {
    points: points.join(" "),
    cheapest:
      cheapestIndex >= 0 && cheapest
        ? { x: (cheapestIndex + 0.5) * slot, y: y(cheapest.price) }
        : undefined,
  };
});

/** Ticks at local 00, 06, 12 and 18, found by clock hour so DST days still line up. */
const axis = computed(() => {
  const list = hours.value;
  return list.flatMap((hour, index) => {
    const date = new Date(hour.start);
    if (date.getHours() % 6 !== 0 || date.getMinutes() !== 0) return [];
    // On the autumn DST change 00–03 repeats an hour; label only the first.
    if (list.slice(0, index).some((earlier) => new Date(earlier.start).getHours() === date.getHours())) return [];
    return [{ left: `${(index / list.length) * 100}%`, label: date.toLocaleTimeString([], { hour: "numeric" }) }];
  });
});

// Without statistics there is no honest "today" figure: an energy sensor is
// often a lifetime meter, so its state is not today's use.
const headline = computed(() => {
  const summary = props.summary;
  if (!summary) return undefined;
  if (summary.todayCost !== undefined) return { value: money(summary.todayCost), label: "spent today" };
  return { value: `${kwh(summary.todayKwh)} kWh`, label: "used today" };
});

const footer = computed(() => {
  const summary = props.summary;
  if (!summary) return { left: "Hourly history needs Homeframe Runtime", right: "" };

  if (summary.pricing !== "none" && summary.currentPrice !== undefined) {
    const now = `${money(summary.currentPrice)}/kWh now`;
    const cheapest = summary.cheapestUpcoming;
    const next =
      cheapest && summary.currentPrice !== undefined && cheapest.price < summary.currentPrice * 0.9
        ? `Cheapest at ${clock(cheapest.start)}`
        : `${kwh(summary.todayKwh)} kWh today`;
    return { left: now, right: next };
  }

  return {
    left: `Yesterday ${kwh(summary.yesterdayKwh)} kWh`,
    right: summary.monthKwh !== undefined ? `${kwh(summary.monthKwh)} kWh this month` : "",
  };
});

const chartLabel = computed(() => {
  const summary = props.summary;
  if (!summary) return "";
  const peak = summary.hours.reduce<{ start: number; kwh: number } | undefined>(
    (best, hour) => (hour.kwh !== undefined && (!best || hour.kwh > best.kwh) ? { start: hour.start, kwh: hour.kwh } : best),
    undefined,
  );
  return `Hourly use today: ${kwh(summary.todayKwh)} kWh${peak ? `, highest at ${clock(peak.start)}` : ""}.`;
});
</script>

<template>
  <GlassCard className="energy-card">
    <div class="room-top">
      <div>
        <span class="eyebrow">ENERGY</span>
        <h2>{{ title ?? "Live usage" }}</h2>
      </div>
      <Zap :size="20" />
    </div>

    <div class="energy-figures">
      <strong class="hero-number">{{ kilowatts }}<small> kW</small></strong>
      <div v-if="headline" class="energy-today">
        <strong>{{ headline.value }}</strong>
        <span>{{ headline.label }}</span>
      </div>
    </div>

    <figure v-if="bars.length" class="energy-chart" role="img" :aria-label="chartLabel">
      <svg :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" preserveAspectRatio="none">
        <rect
          v-for="bar in bars"
          :key="bar.key"
          :class="`energy-bar energy-bar-${bar.state}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="1.5"
        />
        <polyline v-if="priceLine" class="energy-price" :points="priceLine.points" />
      </svg>
      <span
        v-if="priceLine?.cheapest"
        class="energy-cheapest"
        :style="{ left: `${(priceLine.cheapest.x / CHART_WIDTH) * 100}%`, top: `${(priceLine.cheapest.y / CHART_HEIGHT) * 100}%` }"
      />
      <div class="energy-axis" aria-hidden="true">
        <span v-for="tick in axis" :key="tick.label" :style="{ left: tick.left }">{{ tick.label }}</span>
      </div>
    </figure>

    <div class="card-footer energy-footer">
      <span>{{ footer.left }}</span>
      <strong>{{ footer.right }}</strong>
    </div>
  </GlassCard>
</template>
