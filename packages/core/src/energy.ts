import type { HassState } from "./types.js";

/**
 * One bucket from Home Assistant's long-term statistics
 * (`recorder/statistics_during_period`). Newer Home Assistant versions send
 * `start`/`end` as epoch milliseconds, older ones as ISO strings; both are
 * normalized to milliseconds before they reach the summary code.
 */
export type StatisticPoint = {
  start: number;
  end?: number;
  /** kWh consumed during the bucket, for `total_increasing` energy sensors. */
  change?: number | null;
  /** Average value during the bucket, for measurement sensors such as power. */
  mean?: number | null;
};

/** A price that applies between `start` and `end`, in currency units per kWh. */
export type PricePoint = {
  start: number;
  end: number;
  price: number;
};

export type PriceSeries = {
  /** The price right now, in currency units per kWh. */
  current?: number;
  /** Known prices for today and possibly tomorrow, sorted by start. */
  points: PricePoint[];
};

export type EnergyHour = {
  start: number;
  /** Undefined for hours that have not happened yet. */
  kwh?: number;
  /** Average price during the hour, when a price series covers it. */
  price?: number;
  cost?: number;
};

export type EnergyPricing = "dynamic" | "flat" | "none";

export type EnergySummary = {
  /** Today's 24 hours (23 or 25 on daylight-saving change days), local time. */
  hours: EnergyHour[];
  todayKwh?: number;
  yesterdayKwh?: number;
  monthKwh?: number;
  yearKwh?: number;
  todayCost?: number;
  yesterdayCost?: number;
  monthCost?: number;
  yearCost?: number;
  /** Price per kWh right now, including any surcharge. */
  currentPrice?: number;
  /** Cheapest known upcoming hour, so a screen can say "cheapest at 03:00". */
  cheapestUpcoming?: { start: number; price: number };
  pricing: EnergyPricing;
};

export type EnergySummaryInput = {
  now: Date;
  /** Hourly buckets covering at least yesterday and today. */
  hourly: StatisticPoint[];
  /** 5-minute buckets for the running hour, which has no hourly bucket yet. */
  recent?: StatisticPoint[];
  /** Monthly buckets covering at least the current year. */
  monthly?: StatisticPoint[];
  /**
   * How to read a bucket. `change` for energy (kWh) sensors; `mean-watts` or
   * `mean-kilowatts` when only a power sensor exists, in which case an hour's
   * average power is its energy.
   */
  source: "change" | "mean-watts" | "mean-kilowatts";
  prices?: PriceSeries;
  /** Flat price per kWh, used when no dynamic price series is bound. */
  tariff?: number;
  /** Added to every dynamic price, for fees the price sensor leaves out. */
  surcharge?: number;
};

const HOUR = 60 * 60 * 1000;

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Very old Home Assistant versions used epoch seconds.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
  }
  return undefined;
}

/** Normalize one raw statistics row from Home Assistant. */
export function parseStatisticPoint(raw: unknown): StatisticPoint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const start = toMillis(row.start);
  if (start === undefined) return undefined;

  return {
    start,
    end: toMillis(row.end),
    change: finiteNumber(row.change) ?? null,
    mean: finiteNumber(row.mean) ?? null,
  };
}

/**
 * Prices in a sub-unit ("øre/kWh", "ct/kWh") are divided by 100 so every
 * cost Homeframe shows is in the main currency unit.
 */
export function priceUnitScale(unit: string | undefined): number {
  return /^(øre|ore|ct|cent|cents|c|p|pence|öre)\s*\//i.test(unit?.trim() ?? "") ? 0.01 : 1;
}

const CURRENCY_ALIASES: Record<string, string> = {
  "€": "EUR",
  ct: "EUR",
  cent: "EUR",
  cents: "EUR",
  øre: "DKK",
  ore: "DKK",
  öre: "SEK",
  "£": "GBP",
  p: "GBP",
  pence: "GBP",
  $: "USD",
  c: "USD",
};

/**
 * Best-effort ISO currency for a price unit such as "DKK/kWh" or "øre/kWh".
 * "kr" alone is Danish, Swedish or Norwegian, so it is returned as a plain
 * label rather than guessed into a currency code.
 */
export function currencyFromPriceUnit(
  unit: string | undefined,
): { code?: string; label?: string } {
  const prefix = unit?.split("/")[0]?.trim();
  if (!prefix) return {};
  if (/^[A-Z]{3}$/.test(prefix)) return { code: prefix };
  const alias = CURRENCY_ALIASES[prefix.toLowerCase()] ?? CURRENCY_ALIASES[prefix];
  return alias ? { code: alias } : { label: prefix };
}

/**
 * Read the price list from a price sensor's attributes. Energi Data Service
 * uses `raw_today: [{hour, price}]`; the Nord Pool custom component uses
 * `raw_today: [{start, end, value}]`. Both may hold hourly or 15-minute
 * prices. Anything else falls back to the sensor state as a single price.
 */
export function parsePriceSeries(state: HassState | undefined): PriceSeries {
  if (!state) return { points: [] };

  const scale = priceUnitScale(
    typeof state.attributes.unit_of_measurement === "string"
      ? state.attributes.unit_of_measurement
      : undefined,
  );

  const rows = [state.attributes.raw_today, state.attributes.raw_tomorrow].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );

  const starts = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const start = toMillis(record.start ?? record.hour);
    const price = finiteNumber(record.value ?? record.price);
    if (start === undefined || price === undefined) return [];
    return [{ start, end: toMillis(record.end), price: price * scale }];
  });

  starts.sort((left, right) => left.start - right.start);

  // Rows without an explicit end last until the next row starts. The final
  // row gets the same length as the one before it (an hour by default).
  const points: PricePoint[] = starts.map((row, index) => {
    const next = starts[index + 1];
    const previousLength = index > 0 ? row.start - starts[index - 1].start : HOUR;
    return {
      start: row.start,
      end: row.end ?? next?.start ?? row.start + previousLength,
      price: row.price,
    };
  });

  const current =
    finiteNumber(state.attributes.current_price) ?? finiteNumber(state.state);

  return {
    current: current === undefined ? undefined : current * scale,
    points,
  };
}

/** Time-weighted average price between `start` and `end`, if fully known. */
function averagePrice(points: PricePoint[], start: number, end: number): number | undefined {
  let covered = 0;
  let weighted = 0;

  for (const point of points) {
    const overlap = Math.min(end, point.end) - Math.max(start, point.start);
    if (overlap <= 0) continue;
    covered += overlap;
    weighted += point.price * overlap;
  }

  // Only report a price when the series covers essentially the whole bucket;
  // a half-known hour would quietly under-report its cost.
  return covered >= (end - start) * 0.99 ? weighted / covered : undefined;
}

function bucketKwh(point: StatisticPoint, source: EnergySummaryInput["source"]): number | undefined {
  if (source === "change") return point.change ?? undefined;
  if (point.mean === null || point.mean === undefined) return undefined;
  return source === "mean-watts" ? point.mean / 1000 : point.mean;
}

/** Local start of the hour containing `time`. */
function hourStart(time: number): number {
  const date = new Date(time);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function startOfDay(date: Date, offsetDays = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

function sum(values: Array<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? known.reduce((total, value) => total + value, 0) : undefined;
}

function round(value: number | undefined, digits: number): number | undefined {
  if (value === undefined) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Combine hourly consumption with prices into what an energy card shows.
 *
 * Costs are only reported when Homeframe can actually compute them: a flat
 * tariff prices everything, a dynamic price series only prices the hours it
 * covers (today). Yesterday's dynamic cost is not guessed from today's prices.
 */
export function summarizeEnergy(input: EnergySummaryInput): EnergySummary {
  const now = input.now.getTime();
  const todayStart = startOfDay(input.now).getTime();
  const tomorrowStart = startOfDay(input.now, 1).getTime();
  const yesterdayStart = startOfDay(input.now, -1).getTime();

  const priceSeries = input.prices?.points ?? [];
  const surcharge = input.surcharge ?? 0;
  const pricing: EnergyPricing = priceSeries.length
    ? "dynamic"
    : input.tariff !== undefined
      ? "flat"
      : "none";

  const priceFor = (start: number, end: number): number | undefined => {
    if (pricing === "flat") return input.tariff;
    if (pricing === "dynamic") {
      const price = averagePrice(priceSeries, start, end);
      return price === undefined ? undefined : price + surcharge;
    }
    return undefined;
  };

  const kwhByHour = new Map<number, number>();
  for (const point of input.hourly) {
    const kwh = bucketKwh(point, input.source);
    if (kwh !== undefined) kwhByHour.set(hourStart(point.start), kwh);
  }

  // Home Assistant only compiles an hourly bucket once the hour is over, so
  // the running hour comes from 5-minute statistics. They fill gaps only and
  // never add to an hour that already has its hourly total.
  const recentByHour = new Map<number, number[]>();
  for (const point of input.recent ?? []) {
    const hour = hourStart(point.start);
    if (kwhByHour.has(hour)) continue;
    const kwh = bucketKwh(point, input.source);
    if (kwh === undefined) continue;
    recentByHour.set(hour, [...(recentByHour.get(hour) ?? []), kwh]);
  }
  for (const [hour, values] of recentByHour) {
    // Changes add up; means of 5-minute power have to be averaged over the
    // part of the hour that has passed and then scaled to that same part.
    const kwh =
      input.source === "change"
        ? values.reduce((total, value) => total + value, 0)
        : (values.reduce((total, value) => total + value, 0) / values.length) *
          (values.length / 12);
    kwhByHour.set(hour, kwh);
  }

  // Walk today's hours by adding one hour of real time each step, which keeps
  // daylight-saving days at 23 or 25 hours instead of inventing or losing one.
  const hours: EnergyHour[] = [];
  for (let start = todayStart; start < tomorrowStart; start += HOUR) {
    const price = priceFor(start, start + HOUR);
    const kwh = start <= now ? kwhByHour.get(start) : undefined;
    hours.push({
      start,
      kwh: kwh === undefined ? undefined : round(kwh, 3),
      price: round(price, 4),
      cost: kwh !== undefined && price !== undefined ? round(kwh * price, 4) : undefined,
    });
  }

  const yesterdayKwh = sum(
    [...kwhByHour].filter(([start]) => start >= yesterdayStart && start < todayStart).map(([, kwh]) => kwh),
  );
  const todayKwh = sum(hours.map((hour) => hour.kwh));
  const todayCost = sum(hours.map((hour) => hour.cost));

  const monthStart = new Date(input.now.getFullYear(), input.now.getMonth(), 1).getTime();
  const yearStart = new Date(input.now.getFullYear(), 0, 1).getTime();
  const monthly = (input.monthly ?? [])
    .map((point) => ({ start: point.start, kwh: bucketKwh(point, input.source) }))
    .filter((point) => point.start >= yearStart);
  const monthKwh = sum(monthly.filter((point) => point.start >= monthStart).map((point) => point.kwh));
  const yearKwh = sum(monthly.map((point) => point.kwh));

  const flat = (kwh: number | undefined) =>
    pricing === "flat" && kwh !== undefined ? kwh * (input.tariff as number) : undefined;

  const currentPoint = priceSeries.find((point) => point.start <= now && now < point.end);
  const currentBase = currentPoint?.price ?? input.prices?.current;
  const currentPrice =
    pricing === "dynamic"
      ? currentBase === undefined
        ? undefined
        : currentBase + surcharge
      : pricing === "flat"
        ? input.tariff
        : undefined;

  let cheapestUpcoming: EnergySummary["cheapestUpcoming"];
  for (const point of priceSeries) {
    if (point.end <= now) continue;
    if (!cheapestUpcoming || point.price + surcharge < cheapestUpcoming.price) {
      cheapestUpcoming = { start: point.start, price: point.price + surcharge };
    }
  }

  return {
    hours,
    todayKwh: round(todayKwh, 3),
    yesterdayKwh: round(yesterdayKwh, 3),
    monthKwh: round(monthKwh, 3),
    yearKwh: round(yearKwh, 3),
    todayCost: round(todayCost ?? flat(todayKwh), 2),
    yesterdayCost: round(flat(yesterdayKwh), 2),
    monthCost: round(flat(monthKwh), 2),
    yearCost: round(flat(yearKwh), 2),
    currentPrice: round(currentPrice, 4),
    cheapestUpcoming: cheapestUpcoming && {
      start: cheapestUpcoming.start,
      price: round(cheapestUpcoming.price, 4) as number,
    },
    pricing,
  };
}
