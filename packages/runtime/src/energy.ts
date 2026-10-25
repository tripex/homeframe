import {
  currencyFromPriceUnit,
  parsePriceSeries,
  summarizeEnergy,
  type EnergySummary,
  type EnergySummaryInput,
  type HassState,
  type StatisticPoint,
} from "@homeframe/core";
import type { DashboardCard, EntityBinding } from "@homeframe/sdk";

/** What GET /api/energy returns for one energy card. */
export type EnergyResponse = {
  summary: EnergySummary;
  /** ISO 4217 code when known, e.g. "DKK". */
  currency?: string;
  /** Raw unit prefix when the currency is ambiguous, e.g. "kr". */
  currencyLabel?: string;
  /** Which sensor the hourly figures come from. */
  source: EnergySummaryInput["source"];
  generatedAt: string;
};

/** The subset of the runtime connection the energy endpoint needs. */
export type StatisticsSource = {
  currentStates(): Map<string, HassState>;
  statistics(request: {
    statisticIds: string[];
    start: Date;
    end?: Date;
    period: "5minute" | "hour" | "month";
    types: Array<"change" | "mean">;
  }): Promise<Record<string, StatisticPoint[]>>;
};

type CachedStatistics = {
  fetchedAt: number;
  hourly: StatisticPoint[];
  recent: StatisticPoint[];
  monthly: StatisticPoint[];
};

/**
 * Statistics move slowly (hourly buckets, 5-minute short-term rows), so one
 * fetch serves every screen for a minute. Prices are read from the live state
 * on each request and are always current.
 */
const STATISTICS_TTL_MS = 60_000;
const cache = new Map<string, CachedStatistics>();

function firstId(binding: EntityBinding | undefined): string | undefined {
  if (!binding) return undefined;
  return Array.isArray(binding) ? binding[0] : binding;
}

function numberProp(card: DashboardCard, name: string): number | undefined {
  const value = card.props?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Prefer an energy (kWh) sensor: its statistics `change` is exact. With only
 * a power sensor, an hour's mean power is used as that hour's energy.
 */
function consumptionSource(
  card: DashboardCard,
  states: Map<string, HassState>,
): { statisticId: string; source: EnergySummaryInput["source"] } | undefined {
  const energy = firstId(card.bindings?.energy);
  if (energy) return { statisticId: energy, source: "change" };

  const power = firstId(card.bindings?.power);
  if (!power) return undefined;

  const unit = states.get(power)?.attributes.unit_of_measurement;
  return {
    statisticId: power,
    source: typeof unit === "string" && unit.toLowerCase() === "kw" ? "mean-kilowatts" : "mean-watts",
  };
}

async function loadStatistics(
  ha: StatisticsSource,
  cacheKey: string,
  statisticId: string,
  source: EnergySummaryInput["source"],
  now: Date,
): Promise<CachedStatistics> {
  const cached = cache.get(cacheKey);
  if (cached && now.getTime() - cached.fetchedAt < STATISTICS_TTL_MS) return cached;

  const types: Array<"change" | "mean"> = source === "change" ? ["change"] : ["mean"];
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [hourly, recent, monthly] = await Promise.all([
    ha.statistics({ statisticIds: [statisticId], start: yesterday, period: "hour", types }),
    ha.statistics({ statisticIds: [statisticId], start: currentHour, period: "5minute", types }),
    // Monthly power means cannot be turned into energy without knowing how
    // many hours each month had data for, so only energy sensors get them.
    source === "change"
      ? ha.statistics({ statisticIds: [statisticId], start: yearStart, period: "month", types })
      : Promise.resolve({} as Record<string, StatisticPoint[]>),
  ]);

  const fresh: CachedStatistics = {
    fetchedAt: now.getTime(),
    hourly: hourly[statisticId] ?? [],
    recent: recent[statisticId] ?? [],
    monthly: monthly[statisticId] ?? [],
  };
  cache.set(cacheKey, fresh);
  return fresh;
}

export class EnergyRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
    readonly reason: "not-an-energy-card" | "no-consumption-binding",
  ) {
    super(message);
  }
}

/**
 * Build the energy summary for one card. Entity ids come from the saved card
 * bindings only; a screen names a dashboard and card, never an entity.
 */
export async function energyForCard(
  ha: StatisticsSource,
  dashboardId: string,
  card: DashboardCard,
  now = new Date(),
): Promise<EnergyResponse> {
  if (card.card !== "energy") {
    throw new EnergyRequestError(`Card ${card.instanceId} is not an energy card`, 400, "not-an-energy-card");
  }

  const states = ha.currentStates();
  const consumption = consumptionSource(card, states);
  if (!consumption) {
    throw new EnergyRequestError(
      `Card ${card.instanceId} binds neither energy nor power`,
      400,
      "no-consumption-binding",
    );
  }

  const statistics = await loadStatistics(
    ha,
    `${dashboardId}/${card.instanceId}/${consumption.statisticId}`,
    consumption.statisticId,
    consumption.source,
    now,
  );

  const priceState = states.get(firstId(card.bindings?.price) ?? "");
  const priceUnit = priceState?.attributes.unit_of_measurement;
  const inferred = currencyFromPriceUnit(typeof priceUnit === "string" ? priceUnit : undefined);
  const currencyProp = card.props?.currency;

  const summary = summarizeEnergy({
    now,
    source: consumption.source,
    hourly: statistics.hourly,
    recent: statistics.recent,
    monthly: statistics.monthly,
    prices: parsePriceSeries(priceState),
    tariff: numberProp(card, "tariff"),
    surcharge: numberProp(card, "surcharge"),
  });

  return {
    summary,
    currency: typeof currencyProp === "string" && currencyProp ? currencyProp.toUpperCase() : inferred.code,
    currencyLabel: typeof currencyProp === "string" && currencyProp ? undefined : inferred.label,
    source: consumption.source,
    generatedAt: now.toISOString(),
  };
}
