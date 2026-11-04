import { readFileSync } from "node:fs";
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
  /** Rebuild the auto-created dashboard from the template on start. */
  regenerate_dashboard?: boolean;
};

/** Id of the dashboard the add-on creates from the home-tablet template. */
export const AUTO_DASHBOARD_ID = "home-tablet";

/**
 * What the add-on does with the home-tablet template on start:
 * - `create` when there is no dashboard at all (first start),
 * - `regenerate` when the user asked for it and the `home-tablet` dashboard
 *   is still template-generated (a dashboard an agent or user rebuilt by
 *   other means is never overwritten), or is missing,
 * - `keep` otherwise. Other dashboards are never touched.
 */
export function firstDashboardAction(
  dashboards: Array<{ id: string; generatedBy?: string }>,
  regenerate: boolean,
): "create" | "regenerate" | "keep" {
  if (!dashboards.length) return "create";
  if (!regenerate) return "keep";
  const current = dashboards.find((dashboard) => dashboard.id === AUTO_DASHBOARD_ID);
  if (!current) return "create";
  return current.generatedBy?.startsWith("homeframe-template:") ? "regenerate" : "keep";
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
