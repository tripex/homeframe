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
import { RuntimeHomeAssistant } from "./home-assistant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const staticDir = path.resolve(
  process.env.HOMEFRAME_STATIC_DIR ?? path.join(repoRoot, "apps", "dashboard", "dist"),
);
const port = Number(process.env.HOMEFRAME_PORT ?? 4173);
const host = process.env.HOMEFRAME_HOST ?? "0.0.0.0";

// Executing `control` actions from a screen is opt-in. The runtime has no
// authentication yet, so anyone who can reach it could otherwise toggle lights.
// `security` actions are refused regardless of this flag.
const controlActionsEnabled = process.env.HOMEFRAME_ALLOW_CONTROL === "true";
const maxActionBodyBytes = 16 * 1024;

const homeAssistant = new RuntimeHomeAssistant();
await homeAssistant.start(process.env.HOMEFRAME_HA_URL, process.env.HOMEFRAME_HA_TOKEN);

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
  console.log(`Home Assistant: ${haStatus}`);
  console.log(`Control actions: ${controlActionsEnabled ? "enabled" : "disabled"}`);
});

function shutdown(): void {
  homeAssistant.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
