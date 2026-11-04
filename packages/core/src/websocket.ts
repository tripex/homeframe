import { parseStatisticPoint, type StatisticPoint } from "./energy.js";
import type { HassState, RegistrySnapshot, ServiceCall } from "./types.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type StateListener = (states: Map<string, HassState>) => void;

type HomeAssistantMessage = {
  id?: number;
  type?: string;
  success?: boolean;
  result?: unknown;
  message?: string;
  error?: { message?: string };
  event?: {
    event_type?: string;
    data?: {
      entity_id?: string;
      new_state?: HassState | null;
    };
  };
};

export type HomeAssistantClientOptions = {
  /**
   * Overrides the URL derived from `baseUrl`. The Home Assistant add-on proxy
   * lives at `ws://supervisor/core/websocket`, which does not follow the usual
   * `<base>/api/websocket` pattern.
   */
  websocketUrl?: string;
  /**
   * Called once when an authenticated connection is lost without `close()`
   * having been called: Home Assistant restarted, the network dropped, or the
   * heartbeat went unanswered. The client is dead afterwards; reconnecting
   * means creating a new client.
   */
  onDisconnect?: (reason: string) => void;
  /**
   * How often to send Home Assistant's `ping` command. A socket can stay
   * "open" for minutes after the other end vanished (a host that lost power
   * never sends a close frame), so a missing pong is the only reliable signal.
   * Default 30 s; 0 turns the heartbeat off.
   */
  heartbeatIntervalMs?: number;
  /** How long to wait for the pong before declaring the connection dead. Default 10 s. */
  heartbeatTimeoutMs?: number;
};

/** Thrown for requests that cannot be answered because the socket is gone. */
export class HomeAssistantDisconnectedError extends Error {
  constructor(message = "Home Assistant client is not connected") {
    super(message);
    this.name = "HomeAssistantDisconnectedError";
  }
}

/**
 * Small Home Assistant WebSocket client containing only the behavior Homeframe
 * currently needs. Keeping this adapter small makes it easier to replace or wrap
 * later when Homeframe gets a production authentication strategy.
 *
 * One client is one connection: once it is lost (see `onDisconnect`) the
 * owner creates a new client rather than reviving this one, so no request or
 * subscription can silently survive across two different sockets.
 */
export class HomeAssistantClient {
  private socket?: WebSocket;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private states = new Map<string, HassState>();
  private stateListeners = new Set<StateListener>();
  private authenticated = false;
  /** Set once the connection is over, by `close()` or by a drop. */
  private finished = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly options: HomeAssistantClientOptions = {},
  ) {}

  async connect(): Promise<void> {
    const websocketUrl =
      this.options.websocketUrl ??
      this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/api/websocket";

    const socket = new WebSocket(websocketUrl);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as HomeAssistantMessage;

        if (message.type === "auth_required") {
          socket.send(
            JSON.stringify({
              type: "auth",
              access_token: this.accessToken,
            }),
          );
          return;
        }

        if (message.type === "auth_ok") {
          this.authenticated = true;
          this.startHeartbeat();
          resolve();
          return;
        }

        if (message.type === "auth_invalid") {
          reject(
            new Error(
              message.message ?? "Home Assistant authentication failed",
            ),
          );
          return;
        }

        this.handleMessage(message);
      };

      // Before auth_ok these reject connect(); afterwards that promise is
      // already settled and only the drop is reported (once).
      socket.onerror = () => {
        reject(new Error("Unable to connect to Home Assistant WebSocket"));
        this.connectionLost("Connection to Home Assistant lost");
      };

      socket.onclose = () => {
        reject(new Error("Home Assistant closed the WebSocket before authentication finished"));
        this.connectionLost("Home Assistant closed the connection");
      };
    });
  }

  /**
   * Ping on an interval and treat a missing pong as a dead connection. Close
   * events alone are not enough: after a power cut or a NAT timeout the
   * socket may never report closing.
   */
  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 30_000;
    const timeout = this.options.heartbeatTimeoutMs ?? 10_000;
    if (interval <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      const timer = setTimeout(() => {
        this.connectionLost(`Home Assistant did not answer a ping within ${timeout} ms`);
      }, timeout);
      this.callWebSocket({ type: "ping" })
        // A rejection means the connection is already gone and reported.
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
    }, interval);
  }

  /**
   * The single place a connection ends unintentionally. Idempotent, because
   * a heartbeat timeout, an error and a close event can all fire for the same
   * drop; the owner must hear about it exactly once.
   */
  private connectionLost(reason: string): void {
    const wasConnected = this.authenticated;
    if (!this.finish(reason)) return;
    // A drop during the handshake is a failed connect(), already reported by
    // its rejected promise, not a disconnect.
    if (wasConnected) this.options.onDisconnect?.(reason);
  }

  /** Tear down timers, socket and requests. Returns false when already done. */
  private finish(reason: string): boolean {
    if (this.finished) return false;
    this.finished = true;
    this.authenticated = false;

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;

    // Detach handlers first so a late close event from the old socket cannot
    // report a second disconnect, then close it. close() on a half-dead socket
    // may take a while to complete; nothing waits for it.
    const socket = this.socket;
    if (socket) {
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Closing a socket that never opened can throw; it is gone either way.
      }
    }

    // Callers waiting for an answer that can no longer arrive get an error now
    // instead of hanging forever.
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new HomeAssistantDisconnectedError(reason));
    }
    this.pendingRequests.clear();
    this.stateListeners.clear();
    return true;
  }

  private handleMessage(message: HomeAssistantMessage): void {
    if (
      typeof message.id === "number" &&
      this.pendingRequests.has(message.id)
    ) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.success === false) {
        pending.reject(
          new Error(message.error?.message ?? "Home Assistant request failed"),
        );
      } else {
        pending.resolve(message.result);
      }

      return;
    }

    if (
      message.type !== "event" ||
      message.event?.event_type !== "state_changed"
    ) {
      return;
    }

    const entityId = message.event.data?.entity_id;
    if (!entityId) return;

    const newState = message.event.data?.new_state;

    if (newState) {
      this.states.set(entityId, newState);
    } else {
      this.states.delete(entityId);
    }

    this.notifyStateListeners();
  }

  private notifyStateListeners(): void {
    const snapshot = new Map(this.states);

    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }

  callWebSocket<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    if (!this.socket || !this.authenticated) {
      return Promise.reject(new HomeAssistantDisconnectedError());
    }

    const requestId = this.nextRequestId++;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.socket!.send(
        JSON.stringify({
          id: requestId,
          ...payload,
        }),
      );
    });
  }

  async getSnapshot(): Promise<RegistrySnapshot> {
    const [areas, devices, entities, states] = await Promise.all([
      this.callWebSocket<RegistrySnapshot["areas"]>({
        type: "config/area_registry/list",
      }),
      this.callWebSocket<RegistrySnapshot["devices"]>({
        type: "config/device_registry/list",
      }),
      this.callWebSocket<RegistrySnapshot["entities"]>({
        type: "config/entity_registry/list",
      }),
      this.callWebSocket<HassState[]>({ type: "get_states" }),
    ]);

    this.states = new Map(states.map((state) => [state.entity_id, state]));

    // The user list needs an admin token (the add-on's Supervisor token is
    // one). Without it discovery falls back to name rules for people.
    const users = await this.callWebSocket<RegistrySnapshot["users"]>({ type: "config/auth/list" }).catch(
      () => undefined,
    );

    return { areas, devices, entities, states, ...(users ? { users } : {}) };
  }

  async subscribeToStates(listener: StateListener): Promise<() => void> {
    this.stateListeners.add(listener);

    await this.callWebSocket({
      type: "subscribe_events",
      event_type: "state_changed",
    });

    listener(new Map(this.states));

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Read long-term statistics from the recorder, the same data Home
   * Assistant's own energy dashboard uses. Returns rows per statistic id,
   * normalized to millisecond timestamps.
   */
  async getStatistics(request: {
    statisticIds: string[];
    start: Date;
    end?: Date;
    period: "5minute" | "hour" | "day" | "week" | "month";
    types: Array<"change" | "mean" | "sum" | "state">;
    /**
     * Units Home Assistant converts the statistics to, e.g.
     * `{ energy: "kWh", power: "W" }`, so a Wh or MWh meter is never read as kWh.
     */
    units?: Record<string, string>;
  }): Promise<Record<string, StatisticPoint[]>> {
    const raw = await this.callWebSocket<Record<string, unknown[]>>({
      type: "recorder/statistics_during_period",
      start_time: request.start.toISOString(),
      ...(request.end ? { end_time: request.end.toISOString() } : {}),
      statistic_ids: request.statisticIds,
      period: request.period,
      types: request.types,
      ...(request.units ? { units: request.units } : {}),
    });

    return Object.fromEntries(
      Object.entries(raw ?? {}).map(([id, rows]) => [
        id,
        (Array.isArray(rows) ? rows : []).flatMap((row) => {
          const point = parseStatisticPoint(row);
          return point ? [point] : [];
        }),
      ]),
    );
  }

  callService(call: ServiceCall): Promise<unknown> {
    return this.callWebSocket({
      type: "call_service",
      domain: call.domain,
      service: call.service,
      service_data: call.serviceData ?? {},
      target: call.target ?? {},
    });
  }

  /**
   * Call a service that returns data, such as `weather.get_forecasts` or
   * `calendar.get_events`, and return its `response` payload.
   */
  async callServiceForResponse<T = unknown>(call: ServiceCall): Promise<T> {
    const result = await this.callWebSocket<{ response?: T }>({
      type: "call_service",
      domain: call.domain,
      service: call.service,
      service_data: call.serviceData ?? {},
      target: call.target ?? {},
      return_response: true,
    });
    return result?.response as T;
  }

  /** True while authenticated and not yet closed or dropped. */
  get connected(): boolean {
    return this.authenticated && !this.finished;
  }

  /**
   * Close on purpose. Unlike a drop, this never calls `onDisconnect`, so an
   * owner that is shutting down or replacing the client does not start a
   * reconnect loop.
   */
  close(): void {
    this.finish("Connection closed by Homeframe");
  }
}
