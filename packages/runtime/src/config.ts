import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * How the runtime reaches Home Assistant.
 *
 * - `supervisor`: running as a Home Assistant add-on. The Supervisor injects
 *   SUPERVISOR_TOKEN and proxies Core at http://supervisor/core, so the user
 *   never creates or pastes a token.
 * - `direct`: HOMEFRAME_HA_URL + HOMEFRAME_HA_TOKEN, e.g. standalone Docker or
 *   a development machine.
 * - `none`: no Home Assistant; dashboards and the demo still work.
 *
 * In every mode the token stays in this process. Browsers only talk to the
 * runtime.
 */
export type HomeAssistantConnection =
  | { mode: "none" }
  | {
      mode: "supervisor" | "direct";
      /** Base for the WebSocket client (HTTP form). */
      baseUrl: string;
      websocketUrl: string;
      /** REST API root, used for camera snapshots. */
      restUrl: string;
      token: string;
    };

type Env = Record<string, string | undefined>;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveConnection(env: Env = process.env): HomeAssistantConnection {
  // An explicit URL + token wins, so an add-on user can still point the
  // runtime at another Home Assistant for testing.
  if (env.HOMEFRAME_HA_URL && env.HOMEFRAME_HA_TOKEN) {
    const base = trimSlash(env.HOMEFRAME_HA_URL);
    return {
      mode: "direct",
      baseUrl: base,
      websocketUrl: `${base.replace(/^http/, "ws")}/api/websocket`,
      restUrl: `${base}/api`,
      token: env.HOMEFRAME_HA_TOKEN,
    };
  }

  if (env.SUPERVISOR_TOKEN) {
    // HOMEFRAME_SUPERVISOR_URL only exists so tests can stand in a fake
    // Supervisor; inside Home Assistant it is always http://supervisor.
    const supervisor = trimSlash(env.HOMEFRAME_SUPERVISOR_URL ?? "http://supervisor");
    return {
      mode: "supervisor",
      baseUrl: `${supervisor}/core`,
      websocketUrl: `${supervisor.replace(/^http/, "ws")}/core/websocket`,
      restUrl: `${supervisor}/core/api`,
      token: env.SUPERVISOR_TOKEN,
    };
  }

  return { mode: "none" };
}

/** The add-on's user options, written by the Supervisor to /data/options.json. */
export type AddonOptions = {
  allow_control?: boolean;
  /** UI language for the dashboard created on first start. */
  locale?: string;
  /** Rebuild every template-generated dashboard from its template on start. */
  regenerate_dashboard?: boolean;
};

/**
 * The dashboards the add-on creates by itself, one per kind of screen, each
 * filled in from the template of the same name.
 */
export const AUTO_DASHBOARDS = [
  { id: "home-tablet", template: "home-tablet", name: { en: "Home", da: "Hjem" } },
  { id: "home-desktop", template: "home-desktop", name: { en: "Home · Desktop", da: "Hjem · Skrivebord" } },
] as const;

export type AutoDashboardId = (typeof AUTO_DASHBOARDS)[number]["id"];

const TEMPLATE_PREFIX = "homeframe-template:";

export type BootstrapStep = {
  id: string;
  template: string;
  action: "create" | "regenerate";
};

/**
 * What the add-on does with its dashboards on start.
 *
 * - Each auto dashboard (home-tablet, home-desktop) is created when it is
 *   missing and has never been created before (`seeded`), so the first
 *   start creates both, an update adds a new one once, and one the user
 *   deleted on purpose stays deleted.
 * - With `regenerate` (the `regenerate_dashboard` option) every dashboard
 *   whose `generatedBy` is `homeframe-template:<template>` is rebuilt from
 *   that template, and missing auto dashboards are created again.
 *   Dashboards made by an agent, the planner or by hand are never touched.
 *
 * `seeded` is undefined before the add-on kept a record (0.3.x): a 0.3.x
 * add-on created home-tablet on its first start, so an installation that
 * already has dashboards counts home-tablet as created once.
 */
export function bootstrapPlan(
  dashboards: Array<{ id: string; generatedBy?: string }>,
  options: { regenerate: boolean; seeded?: string[] },
): BootstrapStep[] {
  const seeded = new Set(options.seeded ?? (dashboards.length ? ["home-tablet"] : []));
  const existing = new Map(dashboards.map((dashboard) => [dashboard.id, dashboard]));
  const steps: BootstrapStep[] = [];

  for (const auto of AUTO_DASHBOARDS) {
    if (existing.has(auto.id)) continue;
    if (options.regenerate || !seeded.has(auto.id)) {
      steps.push({ id: auto.id, template: auto.template, action: "create" });
    }
  }

  if (options.regenerate) {
    for (const dashboard of dashboards) {
      if (!dashboard.generatedBy?.startsWith(TEMPLATE_PREFIX)) continue;
      const template = dashboard.generatedBy.slice(TEMPLATE_PREFIX.length);
      if (template) steps.push({ id: dashboard.id, template, action: "regenerate" });
    }
  }

  return steps;
}

export function autoDashboardName(id: string, locale: string | undefined): string | undefined {
  const auto = AUTO_DASHBOARDS.find((dashboard) => dashboard.id === id);
  return auto ? (locale === "da" ? auto.name.da : auto.name.en) : undefined;
}

/** Which auto dashboards this add-on has created at some point. */
export function readSeeded(dataDir: string): string[] | undefined {
  try {
    const record = JSON.parse(readFileSync(path.join(dataDir, "auto-dashboards.json"), "utf8")) as { seeded?: unknown };
    return Array.isArray(record.seeded) ? record.seeded.filter((id): id is string => typeof id === "string") : undefined;
  } catch {
    return undefined;
  }
}

export function writeSeeded(dataDir: string, seeded: string[]): void {
  writeFileSync(path.join(dataDir, "auto-dashboards.json"), `${JSON.stringify({ seeded: [...new Set(seeded)].sort() }, null, 2)}\n`);
}

export function readAddonOptions(dataDir: string): AddonOptions {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, "options.json"), "utf8")) as AddonOptions;
  } catch {
    return {};
  }
}

/**
 * The Supervisor's ingress proxy is the only client an add-on should serve
 * (https://developers.home-assistant.io/docs/apps/presentation#ingress).
 * Loopback stays allowed for the container's own health checks.
 */
const INGRESS_PROXY = "172.30.32.2";

export function isAllowedIngressClient(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const address = remoteAddress.replace(/^::ffff:/, "");
  return address === INGRESS_PROXY || address === "127.0.0.1" || address === "::1";
}
