#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDashboard, listDashboards } from "@homeframe/tooling";
import { RuntimeHomeAssistant } from "./home-assistant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const staticDir = path.resolve(
  process.env.HOMEFRAME_STATIC_DIR ?? path.join(repoRoot, "apps", "dashboard", "dist"),
);
const port = Number(process.env.HOMEFRAME_PORT ?? 4173);
const host = process.env.HOMEFRAME_HOST ?? "0.0.0.0";

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

    if (request.method !== "GET") {
      json(response, 405, { error: "Runtime HTTP is read-only. Use Homeframe CLI or MCP for writes." });
      return;
    }

    if (url.pathname === "/api/health") {
      json(response, 200, {
        ok: true,
        service: "homeframe-runtime",
        homeAssistant: homeAssistant.snapshot().status,
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
});

function shutdown(): void {
  homeAssistant.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
