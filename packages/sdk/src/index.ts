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

export type DashboardCard = {
  instanceId: string;
  card: string;
  areaId?: string;
  size?: CardSize;
  bindings?: Record<string, string>;
};

export type DashboardManifest = {
  schemaVersion: "1";
  name: string;
  generatedBy?: string;
  cards: DashboardCard[];
};

/** Preserve a card manifest's inferred literal types while validating its shape. */
export function defineCard<T extends CardManifest>(manifest: T): T {
  return manifest;
}
