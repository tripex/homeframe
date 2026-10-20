import type {
  Capability,
  CapabilityKind,
  EntityRegistryEntry,
  HassState,
  RegistrySnapshot,
  SemanticHome,
} from "./types.js";

function getDomain(entityId: string): string {
  return entityId.split(".")[0] ?? "unknown";
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * Split power sensors into the parts of an energy flow.
 *
 * Home Assistant only says "this is power" (device_class: power); it does not
 * say whether the watts come from solar panels, the grid meter or a battery.
 * Integration names are fairly consistent, so name matching is the pragmatic
 * fallback. Anything unrecognised stays plain `power` (whole-home usage).
 */
function classifyPowerFlow(searchableName: string): CapabilityKind {
  if (/solar|photovolt|\bpv\b|_pv_|pv_power|solcelle|inverter_power/.test(searchableName)) {
    return "solar_power";
  }
  if (/batter|powerwall|husbatteri/.test(searchableName)) return "battery_power";
  if (/(^|[._\s])ev([._\s]|$)|wallbox|easee|zaptec|charger|ladeboks|elbil/.test(searchableName)) {
    return "ev_power";
  }
  if (/grid|\bp1\b|p1_|_han_|han_|elnet|net_power|utility_meter/.test(searchableName)) {
    return "grid_power";
  }
  return "power";
}

/** Spot/tariff price sensors, e.g. Energi Data Service or Nord Pool (DKK/kWh, €/kWh). */
function isElectricityPrice(domain: string, deviceClass: string, state: HassState): boolean {
  if (domain !== "sensor") return false;
  const unit = normalized(state.attributes.unit_of_measurement);
  return /\/\s*kwh$/.test(unit) && (deviceClass === "" || deviceClass === "monetary");
}

/**
 * Classify one entity into the semantic concept that is most useful to a dashboard.
 *
 * Home Assistant integrations vary a lot, so this is intentionally conservative.
 * We prefer explicit domain/device-class metadata and only use name matching as a
 * fallback for device types that commonly lack a standard device class.
 */
function classifyCapability(
  entity: EntityRegistryEntry,
  state: HassState,
  label: string,
): CapabilityKind {
  const domain = getDomain(entity.entity_id);
  const deviceClass = normalized(state.attributes.device_class);
  const searchableName = `${entity.entity_id} ${label}`.toLowerCase();

  if (domain === "climate") return "climate";
  if (domain === "light") return "light";
  // A garage door opener is a controllable cover, so it must be checked before
  // the generic cover rule below or it would just be classified as "cover".
  if (domain === "cover" && deviceClass === "garage") return "garage";
  if (domain === "cover") return "cover";
  if (domain === "lock") return "lock";
  if (domain === "alarm_control_panel") return "alarm";
  if (domain === "vacuum") return "vacuum";
  if (domain === "media_player") return "media";

  if (deviceClass === "temperature") return "temperature";
  if (deviceClass === "humidity") return "humidity";
  if (deviceClass === "illuminance") return "illuminance";
  if (deviceClass === "power") return classifyPowerFlow(searchableName);
  if (deviceClass === "energy") return "energy";
  if (isElectricityPrice(domain, deviceClass, state)) return "electricity_price";
  if (deviceClass === "window") return "window";
  // "garage_door" here is a binary_sensor device class, i.e. a contact sensor
  // reporting open/closed. It is not a controllable garage (that's the cover
  // domain rule above), so it stays a plain door for dashboard purposes.
  if (deviceClass === "door" || deviceClass === "garage_door") return "door";
  if (deviceClass === "motion" || deviceClass === "occupancy") return "motion";
  if (deviceClass === "presence") return "presence";

  // Washers and dryers rarely expose a standard device class, so fall back to
  // name matching. Restricted to domains that plausibly report appliance
  // status/progress as a sensor, contact, or plug rather than an operable
  // switch/cover with its own domain handling above.
  if (domain === "sensor" || domain === "binary_sensor" || domain === "switch") {
    if (/washer|washing|vaskemask|laundry/.test(searchableName)) return "washer";
    if (/dryer|tumble|tørretumbler|torretumbler/.test(searchableName)) return "dryer";
  }

  return "generic";
}

function capabilityScore(
  kind: CapabilityKind,
  entity: EntityRegistryEntry,
  state: HassState,
): number {
  let score = kind === "generic" ? 10 : 70;

  if (state.attributes.device_class) score += 10;
  if (entity.entity_category === "diagnostic") score -= 30;
  if (entity.entity_id.includes("battery")) score -= 20;

  return score;
}

function displayName(entity: EntityRegistryEntry, state: HassState): string {
  return (
    entity.name ??
    entity.original_name ??
    stringAttribute(state.attributes.friendly_name) ??
    entity.entity_id
  );
}

/** Convert raw Home Assistant registries into the semantic home used by Homeframe. */
export function discoverHome(snapshot: RegistrySnapshot): SemanticHome {
  const statesByEntityId = new Map(
    snapshot.states.map((state) => [state.entity_id, state]),
  );

  const devicesById = new Map(
    snapshot.devices.map((device) => [device.id, device]),
  );

  const discoveredAreas = new Map(
    snapshot.areas.map((area) => [
      area.area_id,
      {
        id: area.area_id,
        name: area.name,
        capabilities: [] as Capability[],
      },
    ]),
  );

  const unassigned: Capability[] = [];

  for (const entity of snapshot.entities) {
    if (entity.disabled_by || entity.hidden_by) continue;

    const state = statesByEntityId.get(entity.entity_id);
    if (!state) continue;

    const label = displayName(entity, state);
    const kind = classifyCapability(entity, state, label);

    const capability: Capability = {
      kind,
      entityId: entity.entity_id,
      label,
      domain: getDomain(entity.entity_id),
      deviceClass: stringAttribute(state.attributes.device_class),
      unit: stringAttribute(state.attributes.unit_of_measurement),
      score: capabilityScore(kind, entity, state),
    };

    const deviceAreaId = entity.device_id
      ? devicesById.get(entity.device_id)?.area_id
      : undefined;

    const areaId = entity.area_id ?? deviceAreaId;
    const area = areaId ? discoveredAreas.get(areaId) : undefined;

    if (area) {
      area.capabilities.push(capability);
    } else {
      unassigned.push(capability);
    }
  }

  for (const area of discoveredAreas.values()) {
    area.capabilities.sort(
      (left, right) =>
        right.score - left.score || left.label.localeCompare(right.label),
    );
  }

  return {
    areas: [...discoveredAreas.values()].filter(
      (area) => area.capabilities.length > 0,
    ),
    unassigned,
  };
}
