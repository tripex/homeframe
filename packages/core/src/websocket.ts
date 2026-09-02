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

/**
 * Small Home Assistant WebSocket client containing only the behavior Homeframe
 * currently needs. Keeping this adapter small makes it easier to replace or wrap
 * later when Homeframe gets a production authentication strategy.
 */
export class HomeAssistantClient {
  private socket?: WebSocket;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private states = new Map<string, HassState>();
  private stateListeners = new Set<StateListener>();
  private authenticated = false;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async connect(): Promise<void> {
    const websocketUrl =
      this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/api/websocket";

    this.socket = new WebSocket(websocketUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("WebSocket was not created"));
        return;
      }

      this.socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as HomeAssistantMessage;

        if (message.type === "auth_required") {
          this.socket?.send(
            JSON.stringify({
              type: "auth",
              access_token: this.accessToken,
            }),
          );
          return;
        }

        if (message.type === "auth_ok") {
          this.authenticated = true;
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

      this.socket.onerror = () => {
        reject(new Error("Unable to connect to Home Assistant WebSocket"));
      };
    });
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
      return Promise.reject(
        new Error("Home Assistant client is not connected"),
      );
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

    return { areas, devices, entities, states };
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

  callService(call: ServiceCall): Promise<unknown> {
    return this.callWebSocket({
      type: "call_service",
      domain: call.domain,
      service: call.service,
      service_data: call.serviceData ?? {},
      target: call.target ?? {},
    });
  }

  close(): void {
    this.socket?.close();
    this.authenticated = false;
    this.pendingRequests.clear();
    this.stateListeners.clear();
  }
}
