/**
 * Parsers for Home Assistant services that return data instead of changing
 * anything: `weather.get_forecasts` and `calendar.get_events`. Both answer
 * with a map keyed by entity id; these helpers turn that into small, sorted
 * view models so cards never see the raw Home Assistant shape.
 */

export type ForecastDay = {
  /** ISO timestamp of the forecast period start. */
  date: string;
  condition?: string;
  high?: number;
  low?: number;
  precipitation?: number;
  precipitationProbability?: number;
};

export type AgendaEvent = {
  /** The calendar entity the event came from. */
  calendar: string;
  summary: string;
  start: string;
  end: string;
  /** All-day events have a date without a time. */
  allDay: boolean;
  location?: string;
};

function finite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Daily forecast for one weather entity from a `weather.get_forecasts` response. */
export function parseForecastResponse(response: unknown, entityId: string): ForecastDay[] {
  const forecast = record(record(response)[entityId]).forecast;
  if (!Array.isArray(forecast)) return [];

  return forecast.flatMap((raw) => {
    const item = record(raw);
    if (typeof item.datetime !== "string") return [];
    return [
      {
        date: item.datetime,
        condition: typeof item.condition === "string" ? item.condition : undefined,
        high: finite(item.temperature),
        low: finite(item.templow),
        precipitation: finite(item.precipitation),
        precipitationProbability: finite(item.precipitation_probability),
      },
    ];
  });
}

/** Events from every calendar in a `calendar.get_events` response, soonest first. */
export function parseCalendarResponse(response: unknown): AgendaEvent[] {
  const events: AgendaEvent[] = [];

  for (const [calendar, value] of Object.entries(record(response))) {
    const list = record(value).events;
    if (!Array.isArray(list)) continue;

    for (const raw of list) {
      const item = record(raw);
      if (typeof item.start !== "string" || typeof item.end !== "string") continue;
      events.push({
        calendar,
        summary: typeof item.summary === "string" && item.summary.trim() ? item.summary : "—",
        start: item.start,
        end: item.end,
        allDay: !item.start.includes("T"),
        location: typeof item.location === "string" && item.location ? item.location : undefined,
      });
    }
  }

  // All-day dates ("2026-11-04") sort before timed events the same day,
  // which is also how people read a day: the birthday first, then 14:00.
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.summary.localeCompare(b.summary));
}
