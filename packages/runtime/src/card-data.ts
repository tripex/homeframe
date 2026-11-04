import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  parseCalendarResponse,
  parseForecastResponse,
  type AgendaEvent,
  type ForecastDay,
} from "@homeframe/core";
import type { DashboardCard, DashboardManifest, EntityBinding } from "@homeframe/sdk";
import { installationInfo, listDashboards } from "@homeframe/tooling";
import type { RuntimeHomeAssistant } from "./home-assistant.js";

/**
 * Data endpoints for cards that need more than entity states: forecasts,
 * calendar events, camera snapshots and the installation's own house images.
 *
 * Like the energy endpoint, every request names a saved dashboard and card
 * (or, for cameras, an entity that a saved dashboard binds), so a screen can
 * only read what an installation agent deliberately put on a dashboard.
 */

export class CardDataError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 502 | 503,
    readonly reason: string,
  ) {
    super(message);
    this.name = "CardDataError";
  }
}

function ids(binding: EntityBinding | undefined): string[] {
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

export function findCard(dashboard: DashboardManifest, instanceId: string, cardType: string): DashboardCard {
  const card = dashboard.cards.find((candidate) => candidate.instanceId === instanceId);
  if (!card) throw new CardDataError(`Unknown card instance: ${instanceId}`, 404, "unknown-card-instance");
  if (card.card !== cardType) {
    throw new CardDataError(`Card ${instanceId} is not a ${cardType} card`, 400, `not-a-${cardType}-card`);
  }
  return card;
}

function requireConnected(homeAssistant: RuntimeHomeAssistant): void {
  if (homeAssistant.snapshot().status !== "connected") {
    throw new CardDataError("Home Assistant is not connected", 503, "home-assistant-unavailable");
  }
}

/** Forecasts change a few times an hour; one fetch serves every screen. */
const FORECAST_TTL_MS = 10 * 60_000;
const AGENDA_TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function forecastForCard(
  homeAssistant: RuntimeHomeAssistant,
  card: DashboardCard,
): Promise<{ entityId?: string; days: ForecastDay[] }> {
  const entityId = ids(card.bindings?.weather)[0];
  if (!entityId) return { days: [] };
  requireConnected(homeAssistant);

  const days = await cached(`forecast:${entityId}`, FORECAST_TTL_MS, async () =>
    parseForecastResponse(
      await homeAssistant.readService({
        domain: "weather",
        service: "get_forecasts",
        serviceData: { type: "daily" },
        target: { entity_id: entityId },
      }),
      entityId,
    ),
  );
  return { entityId, days };
}

/** Today from midnight, plus the next seven days. */
export function agendaWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 8);
  return { start, end };
}

export async function agendaForCard(
  homeAssistant: RuntimeHomeAssistant,
  card: DashboardCard,
): Promise<{ events: AgendaEvent[]; calendars: Record<string, string> }> {
  const calendars = ids(card.bindings?.calendar);
  if (!calendars.length) return { events: [], calendars: {} };
  requireConnected(homeAssistant);

  const { start, end } = agendaWindow();
  const events = await cached(`agenda:${calendars.join(",")}:${start.toISOString()}`, AGENDA_TTL_MS, async () =>
    parseCalendarResponse(
      await homeAssistant.readService({
        domain: "calendar",
        service: "get_events",
        serviceData: { start_date_time: start.toISOString(), end_date_time: end.toISOString() },
        target: { entity_id: calendars },
      }),
    ),
  );

  // Calendar names let the card label events without knowing entity ids.
  const states = homeAssistant.currentStates();
  const names = Object.fromEntries(
    calendars.map((entityId) => [entityId, String(states.get(entityId)?.attributes.friendly_name ?? entityId)]),
  );
  return { events, calendars: names };
}

/**
 * A camera may be proxied only if some saved dashboard binds it. Checked on
 * every request so removing a camera card revokes access immediately.
 */
export async function cameraIsOnADashboard(entityId: string): Promise<boolean> {
  if (!/^camera\.[a-z0-9_]+$/.test(entityId)) return false;
  const dashboards = await listDashboards();
  return dashboards.some((dashboard) =>
    dashboard.cards.some((card) =>
      Object.values(card.bindings ?? {}).some((binding) => ids(binding).includes(entityId)),
    ),
  );
}

const IMAGE_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/**
 * Locate an installation image such as `<data dir>/assets/home-day.webp`.
 * Names are restricted to a safe slug so a request cannot leave the folder.
 */
export async function findInstallationImage(name: string): Promise<{ file: string; type: string } | undefined> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return undefined;
  const folder = path.join(installationInfo().dataDir, "assets");

  for (const [extension, type] of Object.entries(IMAGE_TYPES)) {
    const file = path.join(folder, `${name}${extension}`);
    try {
      if ((await stat(file)).isFile()) return { file, type };
    } catch {
      // Try the next extension.
    }
  }
  return undefined;
}

export function streamFile(response: import("node:http").ServerResponse, file: string, type: string): void {
  response.writeHead(200, { "content-type": type, "cache-control": "max-age=300" });
  createReadStream(file).pipe(response);
}
