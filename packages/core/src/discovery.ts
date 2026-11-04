import { tidyName } from "./names.js";
import type {
  AuthUserEntry,
  Capability,
  CapabilityKind,
  DeviceRegistryEntry,
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
  // `_pv\d*_` covers inverter loggers that name strings "pv_totalpower",
  // "pv1_power", "pv2_power"…
  if (/solar|photovolt|\bpv\b|_pv\d*_|pv_power|solcelle|inverter_power/.test(searchableName)) {
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

/**
 * True for sensors whose unit is a price per kWh, e.g. "DKK/kWh", "€/kWh" or
 * "øre/kWh". The unit is the only reliable signal: price integrations do not
 * share a device class.
 */
function isPricePerKwh(state: HassState): boolean {
  const unit = stringAttribute(state.attributes.unit_of_measurement)?.trim() ?? "";
  return /^[^\d\s/]{1,6}\s*\/\s*kwh$/i.test(unit);
}

/**
 * A power reading without a device class. ESPHome inverter loggers and some
 * template sensors only set the unit; W/kW on a sensor is still power.
 */
function isUnclassedPower(domain: string, deviceClass: string, state: HassState): boolean {
  const unit = stringAttribute(state.attributes.unit_of_measurement)?.trim() ?? "";
  return domain === "sensor" && !deviceClass && /^k?w$/i.test(unit);
}

/**
 * Temperature sensors that measure equipment rather than a room: inverters,
 * CPUs, batteries, chips, "internal"/"device" temperatures and anything Home
 * Assistant files under diagnostic/config. Such a sensor sitting in an area
 * (the inverter in the shed) must not become that room's temperature.
 */
const EQUIPMENT_TEMPERATURE =
  /inverter|vekselretter|\bcpu\b|_cpu|processor|\bchip|_chip|\bsoc\b|_soc_|batter|internal|intern_|device[\s_]temp|mainboard|motherboard|\bcore\b|_core_|\bgpu\b|_gpu|nvme|\bssd\b|\bdisk\b|\bbody\b|_body_|heatsink|igbt|mosfet|module[\s_]temp/;

/**
 * Plausible air temperature, in °C. Wider than an indoor range on purpose:
 * outdoor areas (garden, carport) read well below zero in winter. A
 * 64 °C "room" is an equipment sensor, whatever its name says.
 */
const AMBIENT_RANGE_C = { min: -30, max: 45 } as const;

function isAmbientTemperature(entity: EntityRegistryEntry, state: HassState, searchableName: string): boolean {
  if (entity.entity_category === "diagnostic" || entity.entity_category === "config") return false;
  if (EQUIPMENT_TEMPERATURE.test(searchableName)) return false;

  const value = Number(state.state);
  // unknown/unavailable: nothing to judge yet, keep the sensor.
  if (state.state === "" || !Number.isFinite(value)) return true;
  const unit = stringAttribute(state.attributes.unit_of_measurement) ?? "°C";
  const celsius = /f$/i.test(unit.trim()) ? ((value - 32) * 5) / 9 : value;
  return celsius >= AMBIENT_RANGE_C.min && celsius <= AMBIENT_RANGE_C.max;
}

/**
 * Persons that are integration or service logins rather than people.
 *
 * Home Assistant creates a person for every login, including those made for
 * MQTT brokers, Node-RED or third-party apps. A person that has at least one
 * device tracker is always treated as a household member. One without a
 * tracker is hidden only when there is positive evidence that it is a service
 * account: its login is system-generated, deactivated or restricted to the
 * local network (`local_only`, how service logins are usually created), or —
 * when the user list is not readable — its name is a well-known service.
 * A family member without a tracker therefore stays visible.
 */
const SERVICE_ACCOUNT_NAME =
  /^(mqtt|mosquitto|node[\s_-]?red|zigbee2mqtt|z2m|zwave[\s_-]?js|homebridge|esphome|frigate|appdaemon|grafana|influx(db)?|hass[\s_-]?bot|api|bot|service|integration|system|supervisor)$/i;

function isServicePerson(state: HassState, label: string, users: Map<string, AuthUserEntry> | undefined): boolean {
  const trackers = state.attributes.device_trackers;
  if (Array.isArray(trackers) && trackers.length > 0) return false;

  const userId = stringAttribute(state.attributes.user_id);
  const user = userId ? users?.get(userId) : undefined;
  if (user && (user.system_generated || user.local_only || user.is_active === false)) return true;
  return SERVICE_ACCOUNT_NAME.test(label.trim());
}

/** `camera.l50_ultra_map`, `camera.robot_map_1`, "Robot Map" … */
function isVacuumMap(entityId: string, label: string): boolean {
  return /_map(_\d+)?$/.test(entityId) || /\bmap\b/i.test(label);
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
  users?: Map<string, AuthUserEntry>,
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
  if (domain === "sun") return "sun";
  if (domain === "weather") return "weather";
  // Cameras, calendars and people are whole Home Assistant domains, so the
  // domain alone is a reliable signal. A `person` is a tracked household
  // member; the `presence` kind stays reserved for presence/occupancy sensors.
  // Robot vacuums publish their floor map as a camera entity; it is not
  // something to watch on a camera card.
  if (domain === "camera") return isVacuumMap(entity.entity_id, label) ? "generic" : "camera";
  if (domain === "calendar") return "calendar";
  if (domain === "person") return isServicePerson(state, label, users) ? "generic" : "person";

  // Electricity price sensors (Energi Data Service, Nord Pool, Tibber…) report
  // a currency per kWh. Check this before the energy device class, because a
  // price is not consumption even when an integration tags it oddly.
  if (domain === "sensor" && isPricePerKwh(state)) return "price";

  if (deviceClass === "temperature") {
    return isAmbientTemperature(entity, state, searchableName) ? "temperature" : "generic";
  }
  if (deviceClass === "humidity") return "humidity";
  if (deviceClass === "illuminance") return "illuminance";
  // A binary_sensor with device class power means "power detected" (on/off),
  // not watts, so only sensors take part in the energy flow.
  if ((deviceClass === "power" && domain !== "binary_sensor") || isUnclassedPower(domain, deviceClass, state)) {
    return classifyPowerFlow(searchableName);
  }
  if (deviceClass === "energy") return "energy";
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

/**
 * Whole-home usage sensors ("house load", "consumption") beat individual
 * plugs when the planner picks the one `power`/`energy` sensor for the home.
 */
const HOME_USAGE = /load|house|home|consumption|forbrug|husstand/;
const SINGLE_OUTLET = /plug|socket|outlet|stik/;

/**
 * Camera integrations expose several entities per physical camera: UniFi
 * Protect has high/medium/low resolution channels, an "insecure" RTSP
 * variant and a doorbell's package camera. The main stream is the one to
 * show; the rest are ranked down and later folded per device.
 */
function cameraVariantScore(searchableName: string): number {
  if (/package/.test(searchableName)) return -30;
  if (/insecure|(low|medium)[\s_-]*res|sub[\s_-]*stream|_sub$|fluent/.test(searchableName)) return -20;
  if (/high[\s_-]*res|main[\s_-]*stream|_main$|clear/.test(searchableName)) return 5;
  return 0;
}

function capabilityScore(
  kind: CapabilityKind,
  entity: EntityRegistryEntry,
  state: HassState,
  label = "",
): number {
  let score = kind === "generic" ? 10 : 70;
  const searchableName = `${entity.entity_id} ${label}`.toLowerCase();

  if (state.attributes.device_class) score += 10;
  if (entity.entity_category === "diagnostic") score -= 30;
  if (entity.entity_id.includes("battery")) score -= 20;
  // A dead entity is the last choice for any slot.
  if (state.state === "unavailable") score -= 25;
  if (kind === "camera") score += cameraVariantScore(searchableName);
  if (kind === "power" || kind === "energy") {
    if (HOME_USAGE.test(searchableName)) score += 10;
    if (SINGLE_OUTLET.test(searchableName)) score -= 10;
  }

  return score;
}

function displayName(
  entity: EntityRegistryEntry,
  state: HassState,
  device?: DeviceRegistryEntry,
): string {
  // has_entity_name with no entity name means "this entity is the device"
  // (the vacuum of a vacuum), so the device's own name is the label.
  const deviceName =
    entity.has_entity_name && !entity.name && !entity.original_name?.trim()
      ? (device?.name_by_user ?? device?.name ?? undefined)
      : undefined;
  const raw =
    entity.name ??
    deviceName ??
    entity.original_name ??
    stringAttribute(state.attributes.friendly_name) ??
    entity.entity_id;
  return tidyName(raw) || entity.entity_id;
}

/**
 * Keep one camera per physical device: the best-scored stream. The other
 * streams of the same device become `generic` so a dashboard never shows the
 * same doorbell twice; they can still be bound explicitly by entity id.
 */
function foldCamerasPerDevice(cameras: Capability[]): void {
  const best = new Map<string, Capability>();
  for (const camera of cameras) {
    if (!camera.deviceId) continue;
    const current = best.get(camera.deviceId);
    if (!current || camera.score > current.score) best.set(camera.deviceId, camera);
  }
  for (const camera of cameras) {
    if (camera.deviceId && best.get(camera.deviceId) !== camera) {
      camera.kind = "generic";
      camera.score = 10;
    }
  }
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

  const users = snapshot.users ? new Map(snapshot.users.map((user) => [user.id, user])) : undefined;

  const unassigned: Capability[] = [];
  const cameras: Capability[] = [];

  for (const entity of snapshot.entities) {
    if (entity.disabled_by || entity.hidden_by) continue;

    const state = statesByEntityId.get(entity.entity_id);
    if (!state) continue;

    const device = entity.device_id ? devicesById.get(entity.device_id) : undefined;
    const label = displayName(entity, state, device);
    const kind = classifyCapability(entity, state, label, users);

    const capability: Capability = {
      kind,
      entityId: entity.entity_id,
      label,
      domain: getDomain(entity.entity_id),
      deviceClass: stringAttribute(state.attributes.device_class),
      unit: stringAttribute(state.attributes.unit_of_measurement),
      score: capabilityScore(kind, entity, state, label),
      ...(entity.device_id ? { deviceId: entity.device_id } : {}),
    };
    if (kind === "camera") cameras.push(capability);

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

  foldCamerasPerDevice(cameras);

  // sun.sun and YAML-configured weather entities often have no entity
  // registry entry, yet a dashboard's sky depends on them. Pick these
  // home-wide singletons up from the plain states.
  const registered = new Set(snapshot.entities.map((entity) => entity.entity_id));
  for (const state of snapshot.states) {
    const domain = getDomain(state.entity_id);
    if (registered.has(state.entity_id) || (domain !== "sun" && domain !== "weather")) continue;
    const stub: EntityRegistryEntry = { entity_id: state.entity_id };
    const label = displayName(stub, state);
    const kind = classifyCapability(stub, state, label);
    unassigned.push({ kind, entityId: state.entity_id, label, domain, score: capabilityScore(kind, stub, state, label) });
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
