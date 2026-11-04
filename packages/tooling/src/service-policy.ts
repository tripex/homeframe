import type { HassState, ServiceCall } from "@homeframe/core";

/**
 * Last line of defence before the runtime calls a Home Assistant service on a
 * screen's behalf.
 *
 * Card actions are already an allowlist (catalog action → fixed service
 * mapping in actions.ts), but the entities they touch come from saved
 * bindings, and bindings are just data in a JSON file. Someone could bind
 * `lock.front_door` as a room card's "light". This policy checks the final
 * service call itself, so a mistaken or tampered manifest still cannot reach
 * a lock, an alarm or a garage door.
 */

/** Domains a screen may change through `control` actions. */
export const CONTROL_DOMAINS: ReadonlySet<string> = new Set([
  "light",
  "switch",
  "climate",
  "media_player",
  "vacuum",
  "fan",
  "humidifier",
  "water_heater",
  "cover",
]);

/** Domains that are always `security` risk, whatever the card claims. */
export const SECURITY_DOMAINS: ReadonlySet<string> = new Set([
  "lock",
  "alarm_control_panel",
]);

/** Cover device classes that open the house to the outside. */
const SECURITY_COVER_CLASSES: ReadonlySet<string> = new Set(["garage", "gate", "door"]);

export type ServicePolicyFailure = "security-entity" | "domain-not-allowed";

export class ServicePolicyError extends Error {
  readonly status = 403;

  constructor(
    message: string,
    readonly reason: ServicePolicyFailure,
  ) {
    super(message);
    this.name = "ServicePolicyError";
  }
}

function domainOf(entityId: string): string {
  return entityId.split(".")[0] ?? "";
}

function isSecurityEntity(entityId: string, states: Map<string, HassState>): boolean {
  const domain = domainOf(entityId);
  if (SECURITY_DOMAINS.has(domain)) return true;
  if (domain !== "cover") return false;

  const deviceClass = states.get(entityId)?.attributes.device_class;
  return typeof deviceClass === "string" && SECURITY_COVER_CLASSES.has(deviceClass);
}

function targetedEntities(call: ServiceCall): string[] {
  const value = call.target?.entity_id;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Throw a ServicePolicyError unless `call` only changes ordinary devices.
 *
 * Device and area targets are refused because Homeframe cannot tell which
 * entities they expand to — an area may well contain the front door lock.
 */
export function assertControlServiceCall(call: ServiceCall, states: Map<string, HassState>): void {
  if (SECURITY_DOMAINS.has(call.domain)) {
    throw new ServicePolicyError(`${call.domain}.${call.service} is a security service`, "security-entity");
  }
  if (!CONTROL_DOMAINS.has(call.domain)) {
    throw new ServicePolicyError(`${call.domain}.${call.service} is not a control service`, "domain-not-allowed");
  }
  if (call.target?.device_id || call.target?.area_id) {
    throw new ServicePolicyError(
      "Card actions may only target explicit entity ids, not devices or areas",
      "domain-not-allowed",
    );
  }

  const entities = targetedEntities(call);
  if (!entities.length) {
    throw new ServicePolicyError("Card actions must target at least one entity", "domain-not-allowed");
  }

  for (const entityId of entities) {
    if (isSecurityEntity(entityId, states)) {
      throw new ServicePolicyError(`${entityId} is a security entity`, "security-entity");
    }
    if (domainOf(entityId) !== call.domain) {
      // light.turn_off on a switch would fail in Home Assistant anyway; refusing
      // here keeps the rule simple: a service only touches its own domain.
      throw new ServicePolicyError(
        `${call.domain}.${call.service} cannot target ${entityId}`,
        "domain-not-allowed",
      );
    }
  }
}

/**
 * Read-only services the runtime itself may call to fetch data for cards.
 * They return a response and change nothing in Home Assistant.
 */
export const READ_SERVICES: ReadonlySet<string> = new Set([
  "weather.get_forecasts",
  "calendar.get_events",
]);
