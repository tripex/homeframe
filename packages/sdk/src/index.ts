export type CardSize = "sm" | "md" | "lg" | "wide";

export type CapabilityRequirement = {
  kind: string;
  required?: boolean;
  multiple?: boolean;
};

export type CardActionRisk = "read" | "control" | "security";

export type CardManifest = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  aiSummary: string;
  sizes: CardSize[];
  capabilities: CapabilityRequirement[];
  props: Record<
    string,
    {
      type: "string" | "number" | "boolean";
      description: string;
      default?: unknown;
    }
  >;
  actions: Array<{
    id: string;
    description: string;
    risk: CardActionRisk;
  }>;
};

/**
 * Built-in device profiles are deliberately broad.
 * A user may override width, height and columns without creating a new framework profile.
 */
export type DeviceProfileId =
  | "tablet-10"
  | "nest-hub"
  | "mobile"
  | "desktop"
  | "custom";

export type DashboardTarget = {
  profile: DeviceProfileId;
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "any";
  columns?: number;
};

export type CardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EntityBinding = string | string[];

export type DashboardCard = {
  instanceId: string;
  card: string;
  areaId?: string;
  size?: CardSize;
  bindings?: Record<string, EntityBinding>;
  props?: Record<string, string | number | boolean>;
  layout?: CardLayout;
};

/**
 * How alive the background behind the cards is.
 *
 * - `live`: sky follows the sun, weather is drawn (rain, snow, fog…)
 * - `calm`: sky colors follow the sun, no weather motion
 * - `off`: a fixed, neutral background
 */
export type AtmosphereMode = "live" | "calm" | "off";

/**
 * Dashboard-wide ambient scene. Like card bindings, the entity ids here are
 * installation data; the renderer only ever sees the derived sky description.
 */
export type DashboardAtmosphere = {
  mode?: AtmosphereMode;
  /** Usually `sun.sun`. Without it the sky falls back to the local clock. */
  sun?: string;
  /** A `weather.*` entity for precipitation, clouds and outdoor temperature. */
  weather?: string;
};

/**
 * A DashboardManifest is installation data, not framework source code.
 * Different screens should normally use separate manifests.
 *
 * Schema v2 is the first multi-device runtime contract. Homeframe has not made
 * a public compatibility promise for the earlier prototype schema.
 */
export type DashboardManifest = {
  schemaVersion: "2";
  id: string;
  name: string;
  target: DashboardTarget;
  theme?: string;
  atmosphere?: DashboardAtmosphere;
  generatedBy?: string;
  cards: DashboardCard[];
  createdAt?: string;
  updatedAt?: string;
};

/** Preserve a card manifest's inferred literal types while validating its shape. */
export function defineCard<T extends CardManifest>(manifest: T): T {
  return manifest;
}
