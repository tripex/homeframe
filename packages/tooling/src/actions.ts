import type { HassState, ServiceCall } from "@homeframe/core";
import type { CardActionRisk, DashboardCard, DashboardManifest, EntityBinding } from "@homeframe/sdk";
import { getCard } from "./catalog.js";

/**
 * Input a screen may send along with a card action. Kept deliberately small:
 * the action id and the card's own bindings decide which entities are touched,
 * so a browser cannot ask the runtime to control arbitrary entity ids.
 */
export type CardActionInput = {
  /** Which bound entity to act on when a capability binds several. */
  entityId?: string;
  /** Target temperature for climate actions. */
  temperature?: number;
};

export type CardActionRequest = {
  dashboardId: string;
  instanceId: string;
  actionId: string;
  input?: CardActionInput;
};

export type ResolvedCardAction = {
  card: string;
  actionId: string;
  risk: CardActionRisk;
  call: ServiceCall;
};

export type CardActionFailure =
  | "unknown-card-instance"
  | "unknown-card-type"
  | "unknown-action"
  | "security-approval-required"
  | "no-bound-entities"
  | "entity-not-bound"
  | "invalid-input"
  | "unsupported-action";

/** Failure with an HTTP-friendly status and a stable machine-readable reason. */
export class CardActionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
    readonly reason: CardActionFailure,
  ) {
    super(message);
    this.name = "CardActionError";
  }
}

function boundIds(binding: EntityBinding | undefined): string[] {
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

function requireBound(card: DashboardCard, capability: string): string[] {
  const ids = boundIds(card.bindings?.[capability]);
  if (!ids.length) {
    throw new CardActionError(
      `Card ${card.instanceId} has no ${capability} binding`,
      400,
      "no-bound-entities",
    );
  }
  return ids;
}

/** Pick one entity from a binding, requiring an explicit choice when several are bound. */
function chooseBound(card: DashboardCard, capability: string, input: CardActionInput): string {
  const ids = requireBound(card, capability);

  if (input.entityId) {
    if (!ids.includes(input.entityId)) {
      throw new CardActionError(
        `${input.entityId} is not bound to ${capability} on card ${card.instanceId}`,
        400,
        "entity-not-bound",
      );
    }
    return input.entityId;
  }

  if (ids.length > 1) {
    throw new CardActionError(
      `Card ${card.instanceId} binds several ${capability} entities; pass input.entityId`,
      400,
      "invalid-input",
    );
  }

  return ids[0];
}

function stateOf(states: Map<string, HassState>, entityId: string): string | undefined {
  return states.get(entityId)?.state;
}

/**
 * Map a catalog action to a concrete Home Assistant service call.
 *
 * Every branch is keyed by card type and action id from `catalog/cards`, so a
 * new action needs both a catalog entry (declaring its risk) and a branch here.
 */
function serviceCallFor(
  card: DashboardCard,
  actionId: string,
  input: CardActionInput,
  states: Map<string, HassState>,
): ServiceCall {
  const key = `${card.card}/${actionId}`;

  if (key === "room/toggle-lights") {
    const lights = requireBound(card, "light");
    const anyOn = lights.some((entityId) => stateOf(states, entityId) === "on");
    return {
      domain: "light",
      service: anyOn ? "turn_off" : "turn_on",
      target: { entity_id: lights },
    };
  }

  if (key === "climate/set-temperature") {
    const entityId = chooseBound(card, "climate", input);
    const temperature = input.temperature;
    if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
      throw new CardActionError(
        "climate/set-temperature needs a finite input.temperature",
        400,
        "invalid-input",
      );
    }
    return {
      domain: "climate",
      service: "set_temperature",
      serviceData: { temperature },
      target: { entity_id: entityId },
    };
  }

  if (key === "vacuum/start-pause") {
    const entityId = chooseBound(card, "vacuum", input);
    const cleaning = stateOf(states, entityId) === "cleaning";
    return {
      domain: "vacuum",
      service: cleaning ? "pause" : "start",
      target: { entity_id: entityId },
    };
  }

  if (key === "vacuum/return-home") {
    const entityId = chooseBound(card, "vacuum", input);
    return {
      domain: "vacuum",
      service: "return_to_base",
      target: { entity_id: entityId },
    };
  }

  if (key === "appliance/start-stop") {
    // Washer/dryer state usually comes from a sensor. The card contract only
    // allows start/stop when an integration exposes an explicit safe service,
    // and Homeframe has no way to discover that yet.
    throw new CardActionError(
      "Appliance start/stop is not wired to a Home Assistant service yet",
      400,
      "unsupported-action",
    );
  }

  throw new CardActionError(`No runtime implementation for ${key}`, 400, "unsupported-action");
}

/**
 * Resolve a screen's action request into a Home Assistant service call without
 * executing it. The caller decides whether execution is allowed at all.
 *
 * `security` actions are refused here, unconditionally: the framework contract
 * requires an explicit human approval path for locks, alarms and garages, and
 * that path does not exist yet. A prompt or a config flag must not bypass it.
 */
export async function resolveCardAction(
  dashboard: DashboardManifest,
  request: Omit<CardActionRequest, "dashboardId">,
  states: Map<string, HassState>,
  frameworkRoot?: string,
): Promise<ResolvedCardAction> {
  const card = dashboard.cards.find((candidate) => candidate.instanceId === request.instanceId);
  if (!card) {
    throw new CardActionError(
      `Unknown card instance: ${request.instanceId}`,
      404,
      "unknown-card-instance",
    );
  }

  const manifest = await getCard(card.card, frameworkRoot);
  if (!manifest) {
    throw new CardActionError(`Unknown card type: ${card.card}`, 404, "unknown-card-type");
  }

  const action = manifest.actions.find((candidate) => candidate.id === request.actionId);
  if (!action) {
    throw new CardActionError(
      `Card ${card.card} declares no action ${request.actionId}`,
      404,
      "unknown-action",
    );
  }

  const risk = action.risk as CardActionRisk;
  if (risk === "security") {
    throw new CardActionError(
      `${card.card}/${request.actionId} is a security action and requires explicit human approval, which Homeframe does not provide yet`,
      403,
      "security-approval-required",
    );
  }

  return {
    card: card.card,
    actionId: request.actionId,
    risk,
    call: serviceCallFor(card, request.actionId, request.input ?? {}, states),
  };
}
