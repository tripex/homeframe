import type {
  Capability,
  CapabilityKind,
  EntityRegistryEntry,
  HassState,
  RegistrySnapshot,
  SemanticHome,
} from "./types";

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
  if (domain === "cover") return "cover";
  if (domain === "lock") return "lock";
  if (domain === "vacuum") return "vacuum";
  if (domain === "media_player") return "media";

  if (deviceClass === "temperature") return "temperature";
  if (deviceClass === "humidity") return "humidity";
  if (deviceClass === "illuminance") return "illuminance";
  if (deviceClass === "power") return "power";
  if (deviceClass === "energy") return "energy";
  if (deviceClass === "window") return "window";
  if (deviceClass === "door" || deviceClass === "garage_door") return "door";
  if (deviceClass === "motion" || deviceClass === "occupancy") return "motion";
  if (deviceClass === "presence") return "presence";

  if (/washer|washing|vaskemask|laundry/.test(searchableName)) return "washer";

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
