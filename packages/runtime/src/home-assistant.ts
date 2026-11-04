import type { ServerResponse } from "node:http";
import {
  discoverHome,
  HomeAssistantClient,
  RECONNECT_DELAYS_MS,
  reconnectDelayMs,
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
  /** Lost or not yet reached; retrying in the background. States are the last known ones. */
  | "disconnected";

export type RuntimeHomeAssistantSnapshot = {
  status: RuntimeHomeAssistantStatus;
  error?: string;
  /**
   * When a working connection was lost (ISO time), so screens can say how old
   * the values they show are. Absent while connected or before the first
   * successful connect.
   */
  disconnectedAt?: string;
  states: HassState[];
  semanticHome: SemanticHome;
};

/** Thrown by data and service methods while there is no live connection; HTTP maps it to 503. */
export class HomeAssistantUnavailableError extends Error {
  constructor(status: RuntimeHomeAssistantStatus) {
    super(`Home Assistant is not connected (status: ${status})`);
    this.name = "HomeAssistantUnavailableError";
  }
}

export type RuntimeHomeAssistantOptions = {
  /** Reconnect backoff; the last value repeats forever. Tests pass short ones. */
  retryDelaysMs?: readonly number[];
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  /** Interval for an SSE keep-alive so proxies and browsers can tell a live stream from a dead one. */
  eventKeepAliveMs?: number;
  /** Called after every successful (re)connect, e.g. to build dashboards once Home Assistant is up. */
  onConnected?: () => void;
};

/**
 * Keeps the Home Assistant credential on the Homeframe server.
 *
 * Browsers receive only states and semantic discovery data. Service calls go
 * through `callService`, which the HTTP layer only exposes for resolved card
 * actions, never for arbitrary entity ids sent by a screen.
 *
 * The connection heals itself: Home Assistant restarts (updates, backups,
 * config reloads) are routine, and an add-on often starts before Home
 * Assistant does. Any lost or failed connection is retried with backoff,
 * forever, and every successful connect replaces the cached home wholesale
 * and pushes it to the screens, because changes made while we were away are
 * never replayed by Home Assistant.
 */
export class RuntimeHomeAssistant {
  private client?: HomeAssistantClient;
  private states = new Map<string, HassState>();
  private semanticHome: SemanticHome = { areas: [], unassigned: [] };
  private status: RuntimeHomeAssistantStatus = "disabled";
  private error?: string;
  private disconnectedAt?: string;
  private eventClients = new Set<ServerResponse>();
  private unsubscribe?: () => void;
  private connection: HomeAssistantConnection = { mode: "none" };
  private retryTimer?: ReturnType<typeof setTimeout>;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private failedAttempts = 0;
  private stopped = false;

  constructor(private readonly options: RuntimeHomeAssistantOptions = {}) {}

  /**
   * Make the first connection attempt and resolve once it has succeeded or
   * failed. A failure is not final: retries continue in the background.
   */
  async start(connection: HomeAssistantConnection): Promise<void> {
    this.connection = connection;
    this.stopped = false;
    if (connection.mode === "none") {
      this.status = "disabled";
      return;
    }

    this.keepAliveTimer = setInterval(() => this.publish("ping", {}), this.options.eventKeepAliveMs ?? 20_000);
    this.setStatus("connecting");
    if (!(await this.connectOnce())) this.scheduleReconnect();
  }

  /**
   * One complete connect: socket, fresh snapshot, rediscovery, subscription.
   * Returns false (and leaves a retry to the caller) on any failure.
   */
  private async connectOnce(): Promise<boolean> {
    if (this.connection.mode === "none") return false;
    const client: HomeAssistantClient = new HomeAssistantClient(this.connection.baseUrl, this.connection.token, {
      websocketUrl: this.connection.websocketUrl,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.options.heartbeatTimeoutMs,
      onDisconnect: (reason) => this.connectionLost(client, reason),
    });

    try {
      await client.connect();
      const snapshot = await client.getSnapshot();
      if (this.stopped) {
        client.close();
        return false;
      }

      this.client = client;
      this.states = new Map(snapshot.states.map((state) => [state.entity_id, state]));
      // Rediscover too: entities or areas may have been added while Home
      // Assistant was restarting (that is often why it restarted).
      this.semanticHome = discoverHome(snapshot);
      this.unsubscribe = await client.subscribeToStates((nextStates) => {
        this.publishStateChanges(nextStates);
      });
    } catch (reason) {
      client.close();
      if (this.client === client) this.client = undefined;
      this.unsubscribe = undefined;
      if (this.stopped) return false;
      this.failedAttempts += 1;
      // Keep the last known states: a screen showing slightly old values
      // (clearly marked as such) beats an empty one.
      this.setStatus("disconnected", reason instanceof Error ? reason.message : String(reason));
      return false;
    }

    this.failedAttempts = 0;
    this.disconnectedAt = undefined;
    // Screens replace everything they hold: whatever changed while the
    // connection was down never arrives as a state_changed event.
    this.publish("snapshot", this.snapshotWith("connected"));
    this.setStatus("connected");
    this.options.onConnected?.();
    return true;
  }

  /** The client reported an unintended drop (Home Assistant restart, network, missed heartbeat). */
  private connectionLost(client: HomeAssistantClient, reason: string): void {
    if (client !== this.client || this.stopped) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.disconnectedAt = new Date().toISOString();
    this.setStatus("disconnected", reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    const delays = this.options.retryDelaysMs ?? RECONNECT_DELAYS_MS;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = undefined;
      if (this.stopped) return;
      if (!(await this.connectOnce())) this.scheduleReconnect();
    }, reconnectDelayMs(this.failedAttempts, delays));
  }

  private setStatus(status: RuntimeHomeAssistantStatus, error?: string): void {
    // Transitions only, so a long outage logs one line, not one per retry.
    if (status !== this.status) console.log(`Home Assistant: ${status}${error ? ` (${error})` : ""}`);
    this.status = status;
    this.error = error;
    this.publish("status", this.statusEvent());
  }

  private statusEvent(): Pick<RuntimeHomeAssistantSnapshot, "status" | "error" | "disconnectedAt"> {
    return { status: this.status, error: this.error, disconnectedAt: this.disconnectedAt };
  }

  private snapshotWith(status: RuntimeHomeAssistantStatus): RuntimeHomeAssistantSnapshot {
    return { ...this.snapshot(), status };
  }

  get mode(): HomeAssistantConnection["mode"] {
    return this.connection.mode;
  }

  snapshot(): RuntimeHomeAssistantSnapshot {
    return {
      status: this.status,
      error: this.error,
      disconnectedAt: this.disconnectedAt,
      states: [...this.states.values()],
      semanticHome: this.semanticHome,
    };
  }

  currentStates(): Map<string, HassState> {
    return this.states;
  }

  /** The connected client, or a 503-style error while there is none. */
  private liveClient(): HomeAssistantClient {
    if (!this.client || this.status !== "connected") throw new HomeAssistantUnavailableError(this.status);
    return this.client;
  }

  /** Execute one Home Assistant service call. Throws when there is no live connection. */
  async callService(call: ServiceCall): Promise<unknown> {
    return this.liveClient().callService(call);
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
    return this.liveClient().callServiceForResponse<T>(call);
  }

  /**
   * Fetch a still image from Home Assistant's camera proxy. The caller is
   * responsible for deciding which cameras a screen may see.
   */
  async cameraSnapshot(entityId: string): Promise<{ contentType: string; body: Buffer }> {
    if (this.connection.mode === "none" || !this.client || this.status !== "connected") {
      throw new HomeAssistantUnavailableError(this.status);
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
    return this.liveClient().getStatistics(request);
  }

  attachEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    response.write(`event: status\ndata: ${JSON.stringify(this.statusEvent())}\n\n`);
    this.eventClients.add(response);

    response.on("close", () => {
      this.eventClients.delete(response);
    });
  }

  /** Stop for good: no further retries, no timers left behind. */
  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.retryTimer = undefined;
    this.keepAliveTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client?.close();
    this.client = undefined;

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
