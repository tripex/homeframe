import type { ServerResponse } from "node:http";
import {
  discoverHome,
  HomeAssistantClient,
  type HassState,
  type SemanticHome,
  type ServiceCall,
  type StatisticPoint,
} from "@homeframe/core";
import { READ_SERVICES } from "@homeframe/tooling";
import type { HomeAssistantConnection } from "./config.js";

const RASTER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type RuntimeHomeAssistantStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "error";

export type RuntimeHomeAssistantSnapshot = {
  status: RuntimeHomeAssistantStatus;
  error?: string;
  states: HassState[];
  semanticHome: SemanticHome;
};

/**
 * Keeps the Home Assistant credential on the Homeframe server.
 *
 * Browsers receive only states and semantic discovery data. Service calls go
 * through `callService`, which the HTTP layer only exposes for resolved card
 * actions, never for arbitrary entity ids sent by a screen.
 */
export class RuntimeHomeAssistant {
  private client?: HomeAssistantClient;
  private states = new Map<string, HassState>();
  private semanticHome: SemanticHome = { areas: [], unassigned: [] };
  private status: RuntimeHomeAssistantStatus = "disabled";
  private error?: string;
  private eventClients = new Set<ServerResponse>();
  private unsubscribe?: () => void;
  private connection: HomeAssistantConnection = { mode: "none" };

  async start(connection: HomeAssistantConnection): Promise<void> {
    this.connection = connection;
    if (connection.mode === "none") {
      this.status = "disabled";
      return;
    }

    this.status = "connecting";
    this.error = undefined;

    try {
      const client = new HomeAssistantClient(connection.baseUrl, connection.token, {
        websocketUrl: connection.websocketUrl,
      });
      await client.connect();

      const snapshot = await client.getSnapshot();
      this.client = client;
      this.states = new Map(snapshot.states.map((state) => [state.entity_id, state]));
      this.semanticHome = discoverHome(snapshot);
      this.status = "connected";

      this.unsubscribe = await client.subscribeToStates((nextStates) => {
        this.publishStateChanges(nextStates);
      });

      this.publish("status", { status: this.status });
    } catch (reason) {
      this.status = "error";
      this.error = reason instanceof Error ? reason.message : String(reason);
      this.publish("status", { status: this.status, error: this.error });
    }
  }

  get mode(): HomeAssistantConnection["mode"] {
    return this.connection.mode;
  }

  snapshot(): RuntimeHomeAssistantSnapshot {
    return {
      status: this.status,
      error: this.error,
      states: [...this.states.values()],
      semanticHome: this.semanticHome,
    };
  }

  currentStates(): Map<string, HassState> {
    return this.states;
  }

  /** Execute one Home Assistant service call. Throws when there is no live connection. */
  async callService(call: ServiceCall): Promise<unknown> {
    if (!this.client || this.status !== "connected") {
      throw new Error(`Home Assistant is not connected (status: ${this.status})`);
    }
    return this.client.callService(call);
  }

  /**
   * Call one of the read-only data services (weather forecasts, calendar
   * events). Anything outside READ_SERVICES is refused here, so this method
   * cannot become a back door for state-changing calls.
   */
  async readService<T = unknown>(call: ServiceCall): Promise<T> {
    if (!READ_SERVICES.has(`${call.domain}.${call.service}`)) {
      throw new Error(`${call.domain}.${call.service} is not a read-only data service`);
    }
    if (!this.client || this.status !== "connected") {
      throw new Error(`Home Assistant is not connected (status: ${this.status})`);
    }
    return this.client.callServiceForResponse<T>(call);
  }

  /**
   * Fetch a still image from Home Assistant's camera proxy. The caller is
   * responsible for deciding which cameras a screen may see.
   */
  async cameraSnapshot(entityId: string): Promise<{ contentType: string; body: Buffer }> {
    if (this.connection.mode === "none" || this.status !== "connected") {
      throw new Error(`Home Assistant is not connected (status: ${this.status})`);
    }
    const response = await fetch(`${this.connection.restUrl}/camera_proxy/${encodeURIComponent(entityId)}`, {
      headers: { authorization: `Bearer ${this.connection.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Camera proxy returned ${response.status}`);

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    // Only forward raster images. An HTML error page — or an SVG, which can
    // carry script — must never be served from the dashboard's origin.
    if (!RASTER_IMAGE_TYPES.has(contentType)) throw new Error("Camera proxy did not return a raster image");
    return { contentType, body: Buffer.from(await response.arrayBuffer()) };
  }

  /** Read recorder statistics. Throws when there is no live connection. */
  async statistics(request: {
    statisticIds: string[];
    start: Date;
    end?: Date;
    period: "5minute" | "hour" | "month";
    types: Array<"change" | "mean">;
    units?: Record<string, string>;
  }): Promise<Record<string, StatisticPoint[]>> {
    if (!this.client || this.status !== "connected") {
      throw new Error(`Home Assistant is not connected (status: ${this.status})`);
    }
    return this.client.getStatistics(request);
  }

  attachEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    response.write(`event: status\ndata: ${JSON.stringify({ status: this.status, error: this.error })}\n\n`);
    this.eventClients.add(response);

    response.on("close", () => {
      this.eventClients.delete(response);
    });
  }

  close(): void {
    this.unsubscribe?.();
    this.client?.close();

    for (const response of this.eventClients) response.end();
    this.eventClients.clear();
  }

  private publishStateChanges(nextStates: Map<string, HassState>): void {
    const changed: HassState[] = [];
    const removed: string[] = [];

    for (const [entityId, next] of nextStates) {
      const previous = this.states.get(entityId);
      if (
        !previous ||
        previous.last_updated !== next.last_updated ||
        previous.state !== next.state
      ) {
        changed.push(next);
      }
    }

    for (const entityId of this.states.keys()) {
      if (!nextStates.has(entityId)) removed.push(entityId);
    }

    this.states = new Map(nextStates);

    if (changed.length || removed.length) {
      this.publish("states", { changed, removed });
    }
  }

  private publish(event: string, value: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;

    for (const response of [...this.eventClients]) {
      if (response.destroyed) {
        this.eventClients.delete(response);
        continue;
      }

      response.write(message);
    }
  }
}
