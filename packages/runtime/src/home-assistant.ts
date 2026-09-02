import type { ServerResponse } from "node:http";
import {
  discoverHome,
  HomeAssistantClient,
  type HassState,
  type SemanticHome,
  type ServiceCall,
} from "@homeframe/core";

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

  async start(baseUrl?: string, token?: string): Promise<void> {
    if (!baseUrl || !token) {
      this.status = "disabled";
      return;
    }

    this.status = "connecting";
    this.error = undefined;

    try {
      const client = new HomeAssistantClient(baseUrl, token);
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
