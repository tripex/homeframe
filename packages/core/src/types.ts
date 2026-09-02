/** A subset of the Home Assistant state object used by Homeframe. */
export type HassState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
};

export type AreaRegistryEntry = {
  area_id: string;
  name: string;
  floor_id?: string | null;
};

export type DeviceRegistryEntry = {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
};

export type EntityRegistryEntry = {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  platform?: string;
  hidden_by?: string | null;
  disabled_by?: string | null;
  entity_category?: string | null;
};

/** Everything semantic discovery needs from Home Assistant at one point in time. */
export type RegistrySnapshot = {
  areas: AreaRegistryEntry[];
  devices: DeviceRegistryEntry[];
  entities: EntityRegistryEntry[];
  states: HassState[];
};

export type CapabilityKind =
  | "temperature"
  | "humidity"
  | "illuminance"
  | "power"
  | "energy"
  | "light"
  | "climate"
  | "cover"
  | "garage"
  | "lock"
  | "alarm"
  | "presence"
  | "window"
  | "door"
  | "motion"
  | "vacuum"
  | "washer"
  | "dryer"
  | "media"
  | "generic";

/**
 * A Home Assistant entity expressed as a concept Homeframe understands.
 *
 * Entity IDs are allowed here because this is the boundary between Homeframe
 * and Home Assistant. Reusable visual components should receive semantic data
 * rather than hardcoding these IDs themselves.
 */
export type Capability = {
  kind: CapabilityKind;
  entityId: string;
  label: string;
  domain: string;
  deviceClass?: string;
  unit?: string;
  score: number;
};

export type DiscoveredArea = {
  id: string;
  name: string;
  capabilities: Capability[];
};

export type SemanticHome = {
  areas: DiscoveredArea[];
  unassigned: Capability[];
};

export type ServiceCall = {
  domain: string;
  service: string;
  serviceData?: Record<string, unknown>;
  target?: {
    entity_id?: string | string[];
    device_id?: string | string[];
    area_id?: string | string[];
  };
};
