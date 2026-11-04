#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CardActionError,
  getDashboard,
  listDashboards,
  resolveCardAction,
  type CardActionRequest,
} from "@homeframe/tooling";
import {
  agendaForCard,
  cameraIsOnADashboard,
  CardDataError,
  findCard,
  findInstallationImage,
  forecastForCard,
  streamFile,
} from "./card-data.js";
import { isAllowedIngressClient, readAddonOptions, resolveConnection } from "./config.js";
import { EnergyRequestError, energyForCard } from "./energy.js";
import { RuntimeHomeAssistant } from "./home-assistant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const staticDir = path.resolve(
  process.env.HOMEFRAME_STATIC_DIR ?? path.join(repoRoot, "apps", "dashboard", "dist"),
);
const connection = resolveConnection();
const runningAsAddon = connection.mode === "supervisor";

// 8099 is the add-on ingress port declared in homeframe/config.yaml.
const port = Number(process.env.HOMEFRAME_PORT ?? (runningAsAddon ? 8099 : 4173));
const host = process.env.HOMEFRAME_HOST ?? "0.0.0.0";

// Behind ingress, Home Assistant has already authenticated the user, so only
// the ingress proxy may connect. Opting out exists for debugging only.
const ingressOnly = runningAsAddon && process.env.HOMEFRAME_INGRESS_ONLY !== "false";

// Executing `control` actions from a screen is opt-in. A standalone runtime
// has no authentication, so anyone who can reach it could otherwise toggle
// lights. As an add-on every request has passed Home Assistant's login, and
// the add-on's `allow_control` option decides. `security` actions are refused
// regardless.
const addonOptions = runningAsAddon ? readAddonOptions(process.env.HOMEFRAME_DATA_DIR ?? "/data") : {};
const controlActionsEnabled =
  process.env.HOMEFRAME_ALLOW_CONTROL === "true" || addonOptions.allow_control === true;
const maxActionBodyBytes = 16 * 1024;

const homeAssistant = new RuntimeHomeAssistant();
await homeAssistant.start(connection);

const mime: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxActionBodyBytes) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function parseActionRequest(body: unknown): CardActionRequest {
  const value = (body ?? {}) as Record<string, unknown>;
  const { dashboardId, instanceId, actionId, input } = value;

  if (
    typeof dashboardId !== "string" ||
    typeof instanceId !== "string" ||
    typeof actionId !== "string"
  ) {
    throw new Error("Expected dashboardId, instanceId and actionId strings");
  }

  const rawInput = (input ?? {}) as Record<string, unknown>;
  return {
    dashboardId,
    instanceId,
    actionId,
    input: {
      entityId: typeof rawInput.entityId === "string" ? rawInput.entityId : undefined,
      temperature: typeof rawInput.temperature === "number" ? rawInput.temperature : undefined,
    },
  };
}

async function handleAction(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  let actionRequest: CardActionRequest;
  try {
    actionRequest = parseActionRequest(await readJsonBody(request));
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid action request",
      reason: "invalid-request",
    });
    return;
  }

  const dashboard = await getDashboard(actionRequest.dashboardId);
  if (!dashboard) {
    json(response, 404, {
      error: `Unknown dashboard: ${actionRequest.dashboardId}`,
      reason: "unknown-dashboard",
    });
    return;
  }

  try {
    // Resolve before checking the flag so a disabled runtime still reports
    // security refusals and bad requests the same way an enabled one would.
    const resolved = await resolveCardAction(
      dashboard,
      actionRequest,
      homeAssistant.currentStates(),
    );

    if (!controlActionsEnabled) {
      json(response, 403, {
        error: "Control actions are disabled. Start the runtime with HOMEFRAME_ALLOW_CONTROL=true to enable them.",
        reason: "control-disabled",
        risk: resolved.risk,
      });
      return;
    }

    if (homeAssistant.snapshot().status !== "connected") {
      json(response, 503, {
        error: "Home Assistant is not connected",
        reason: "home-assistant-unavailable",
        risk: resolved.risk,
      });
      return;
    }

    await homeAssistant.callService(resolved.call);
    json(response, 200, { ok: true, risk: resolved.risk, call: resolved.call });
  } catch (error) {
    if (error instanceof CardActionError) {
      json(response, error.status, { error: error.message, reason: error.reason });
      return;
    }
    json(response, 502, {
      error: error instanceof Error ? error.message : String(error),
      reason: "service-call-failed",
    });
  }
}

/**
 * GET /api/energy?dashboard=<id>&instance=<card instance id>
 *
 * Hourly consumption and cost for one saved energy card. The card's own
 * bindings decide which sensors are read, so a screen cannot use this to
 * query arbitrary entities.
 */
async function handleEnergy(
  url: URL,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const dashboardId = url.searchParams.get("dashboard");
  const instanceId = url.searchParams.get("instance");
  if (!dashboardId || !instanceId) {
    json(response, 400, { error: "Expected dashboard and instance query parameters", reason: "invalid-request" });
    return;
  }

  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) {
    json(response, 404, { error: `Unknown dashboard: ${dashboardId}`, reason: "unknown-dashboard" });
    return;
  }

  const card = dashboard.cards.find((candidate) => candidate.instanceId === instanceId);
  if (!card) {
    json(response, 404, { error: `Unknown card instance: ${instanceId}`, reason: "unknown-card-instance" });
    return;
  }

  if (homeAssistant.snapshot().status !== "connected") {
    json(response, 503, { error: "Home Assistant is not connected", reason: "home-assistant-unavailable" });
    return;
  }

  try {
    json(response, 200, await energyForCard(homeAssistant, dashboardId, card));
  } catch (error) {
    if (error instanceof EnergyRequestError) {
      json(response, error.status, { error: error.message, reason: error.reason });
      return;
    }
    json(response, 502, {
      error: error instanceof Error ? error.message : String(error),
      reason: "statistics-failed",
    });
  }
}

/**
 * GET /api/forecast|agenda?dashboard=<id>&instance=<card instance id>
 *
 * Data for forecast and agenda cards, read through the card's own bindings.
 */
async function handleCardData(
  url: URL,
  response: import("node:http").ServerResponse,
  cardType: "weather-forecast" | "agenda",
): Promise<void> {
  const dashboardId = url.searchParams.get("dashboard");
  const instanceId = url.searchParams.get("instance");
  if (!dashboardId || !instanceId) {
    json(response, 400, { error: "Expected dashboard and instance query parameters", reason: "invalid-request" });
    return;
  }

  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) {
    json(response, 404, { error: `Unknown dashboard: ${dashboardId}`, reason: "unknown-dashboard" });
    return;
  }

  try {
    const card = findCard(dashboard, instanceId, cardType);
    json(
      response,
      200,
      cardType === "agenda" ? await agendaForCard(homeAssistant, card) : await forecastForCard(homeAssistant, card),
    );
  } catch (error) {
    if (error instanceof CardDataError) {
      json(response, error.status, { error: error.message, reason: error.reason });
      return;
    }
    json(response, 502, { error: error instanceof Error ? error.message : String(error), reason: "service-call-failed" });
  }
}

/**
 * GET /api/camera_proxy/<camera entity>
 *
 * A still image, fetched server-side with the runtime's credential. Only
 * cameras bound on a saved dashboard are served.
 */
async function handleCamera(entityId: string, response: import("node:http").ServerResponse): Promise<void> {
  if (!(await cameraIsOnADashboard(entityId))) {
    json(response, 403, { error: `${entityId} is not on any saved dashboard`, reason: "camera-not-on-dashboard" });
    return;
  }
  if (homeAssistant.snapshot().status !== "connected") {
    json(response, 503, { error: "Home Assistant is not connected", reason: "home-assistant-unavailable" });
    return;
  }

  try {
    const image = await homeAssistant.cameraSnapshot(entityId);
    response.writeHead(200, { "content-type": image.contentType, "cache-control": "no-store" });
    response.end(image.body);
  } catch (error) {
    json(response, 502, { error: error instanceof Error ? error.message : String(error), reason: "camera-failed" });
  }
}

async function serveFile(
  response: import("node:http").ServerResponse,
  requestedPath: string,
): Promise<boolean> {
  const candidate = path.resolve(staticDir, `.${requestedPath}`);
  if (!candidate.startsWith(`${staticDir}${path.sep}`) && candidate !== staticDir) return false;

  try {
    if (!(await stat(candidate)).isFile()) return false;
    response.writeHead(200, {
      "content-type": mime[path.extname(candidate)] ?? "application/octet-stream",
    });
    createReadStream(candidate).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  if (ingressOnly && !isAllowedIngressClient(request.socket.remoteAddress)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Homeframe only accepts connections through Home Assistant ingress.\n");
    return;
  }

  // Cards render Home Assistant strings and camera images; never let a
  // browser second-guess a content type.
  response.setHeader("x-content-type-options", "nosniff");

  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "POST" && url.pathname === "/api/actions") {
      await handleAction(request, response);
      return;
    }

    if (request.method !== "GET") {
      json(response, 405, {
        error:
          "Runtime HTTP only accepts card actions on POST /api/actions. Use Homeframe CLI or MCP to change dashboards.",
      });
      return;
    }

    if (url.pathname === "/api/health") {
      json(response, 200, {
        ok: true,
        service: "homeframe-runtime",
        homeAssistant: homeAssistant.snapshot().status,
        connection: connection.mode,
        controlActions: controlActionsEnabled ? "enabled" : "disabled",
      });
      return;
    }

    if (url.pathname === "/api/ha/snapshot") {
      const snapshot = homeAssistant.snapshot();
      json(response, snapshot.status === "error" ? 503 : 200, snapshot);
      return;
    }

    if (url.pathname === "/api/ha/events") {
      homeAssistant.attachEvents(response);
      return;
    }

    if (url.pathname === "/api/energy") {
      await handleEnergy(url, response);
      return;
    }

    if (url.pathname === "/api/forecast") {
      await handleCardData(url, response, "weather-forecast");
      return;
    }

    if (url.pathname === "/api/agenda") {
      await handleCardData(url, response, "agenda");
      return;
    }

    if (url.pathname.startsWith("/api/camera_proxy/")) {
      await handleCamera(decodeURIComponent(url.pathname.slice("/api/camera_proxy/".length)), response);
      return;
    }

    if (url.pathname.startsWith("/api/assets/")) {
      const image = await findInstallationImage(decodeURIComponent(url.pathname.slice("/api/assets/".length)));
      if (image) streamFile(response, image.file, image.type);
      else json(response, 404, { error: "No such installation image", reason: "missing-asset" });
      return;
    }

    if (url.pathname === "/api/dashboards") {
      const profile = url.searchParams.get("profile");
      const dashboards = await listDashboards();
      json(
        response,
        200,
        profile ? dashboards.filter((item) => item.target.profile === profile) : dashboards,
      );
      return;
    }

    if (url.pathname.startsWith("/api/dashboards/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/dashboards/".length));
      const dashboard = await getDashboard(id);
      json(response, dashboard ? 200 : 404, dashboard ?? { error: `Unknown dashboard: ${id}` });
      return;
    }

    if (await serveFile(response, url.pathname === "/" ? "/index.html" : url.pathname)) return;

    // Vue owns client-side routes. Unknown non-API paths fall back to index.html.
    await access(path.join(staticDir, "index.html"));
    await serveFile(response, "/index.html");
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  const haStatus = homeAssistant.snapshot().status;
  console.log(`Homeframe running at http://${host}:${port}`);
  console.log(`Dashboard data: ${process.env.HOMEFRAME_DATA_DIR ?? "~/.homeframe"}`);
  console.log(`Home Assistant: ${haStatus} (${connection.mode})`);
  if (ingressOnly) console.log("Accepting connections from the ingress proxy only");
  console.log(`Control actions: ${controlActionsEnabled ? "enabled" : "disabled"}`);
});

function shutdown(): void {
  homeAssistant.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
