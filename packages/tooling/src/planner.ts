import type {
  DashboardCard,
  DashboardManifest,
  DashboardTarget,
  DeviceProfileId,
  EntityBinding,
} from "@homeframe/sdk";

export type CapabilityMap = Record<string, string[]>;

export type HomeAreaSnapshot = {
  id: string;
  name: string;
  capabilities: CapabilityMap;
};

/**
 * Neutral input format for dashboard planning.
 * An agent can build this from Home Assistant MCP without Homeframe knowing
 * which Home Assistant MCP implementation the user chose.
 */
export type HomeSnapshot = {
  name?: string;
  areas: HomeAreaSnapshot[];
  capabilities?: CapabilityMap;
};

export type PlanRequest = {
  home: HomeSnapshot;
  targets: DeviceProfileId[];
  namePrefix?: string;
};

const profiles: Record<Exclude<DeviceProfileId, "custom">, DashboardTarget> = {
  "tablet-10": {
    profile: "tablet-10",
    width: 1280,
    height: 800,
    orientation: "landscape",
    columns: 12,
  },
  "nest-hub": {
    profile: "nest-hub",
    width: 1024,
    height: 600,
    orientation: "landscape",
    columns: 8,
  },
  mobile: {
    profile: "mobile",
    width: 390,
    height: 844,
    orientation: "portrait",
    columns: 4,
  },
  desktop: {
    profile: "desktop",
    width: 1440,
    height: 900,
    orientation: "landscape",
    columns: 12,
  },
};

export function targetFor(profile: DeviceProfileId): DashboardTarget {
  if (profile === "custom") return { profile: "custom", columns: 12 };
  return { ...profiles[profile] };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "home";
}

function first(capabilities: CapabilityMap | undefined, kind: string): EntityBinding | undefined {
  const values = capabilities?.[kind]?.filter(Boolean) ?? [];
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : values;
}

function bindingsFrom(
  capabilities: CapabilityMap | undefined,
  kinds: string[],
): Record<string, EntityBinding> {
  return Object.fromEntries(
    kinds.flatMap((kind) => {
      const value = first(capabilities, kind);
      return value ? [[kind, value] as const] : [];
    }),
  );
}

function cardWidth(card: string, columns: number): number {
  if (columns <= 4) return columns;
  if (card === "climate") return columns;
  if (columns <= 8) return Math.min(4, columns);
  if (card === "room") return 4;
  return 4;
}

function cardHeight(card: string): number {
  if (card === "climate") return 3;
  return 3;
}

/** Place cards left-to-right, wrapping onto the next grid row. */
export function autoLayout(cards: DashboardCard[], columns: number): DashboardCard[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  return cards.map((card) => {
    const w = Math.min(cardWidth(card.card, columns), columns);
    const h = cardHeight(card.card);

    if (x + w > columns) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    const laidOut = {
      ...card,
      layout: { x, y, w, h },
    };

    x += w;
    rowHeight = Math.max(rowHeight, h);
    if (x >= columns) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    return laidOut;
  });
}

function roomCards(home: HomeSnapshot, profile: DeviceProfileId): DashboardCard[] {
  const visibleAreas = profile === "nest-hub" ? home.areas.slice(0, 4) : home.areas;

  return visibleAreas.flatMap((area) => {
    const bindings = bindingsFrom(area.capabilities, [
      "temperature",
      "humidity",
      "light",
      "climate",
    ]);

    if (!Object.keys(bindings).length) return [];

    return [
      {
        instanceId: `room-${slug(area.id)}`,
        card: "room",
        areaId: area.id,
        size: profile === "mobile" ? "md" : "lg",
        props: { name: area.name },
        bindings,
      } satisfies DashboardCard,
    ];
  });
}

function globalCards(home: HomeSnapshot): DashboardCard[] {
  const global = home.capabilities ?? {};
  const cards: DashboardCard[] = [];

  const energyBindings = bindingsFrom(global, ["power", "energy"]);
  if (energyBindings.power) {
    cards.push({
      instanceId: "energy-overview",
      card: "energy",
      size: "md",
      bindings: energyBindings,
    });
  }

  const climateEntities = home.areas.flatMap((area) => area.capabilities.climate ?? []);
  if (climateEntities.length) {
    cards.push({
      instanceId: "climate-overview",
      card: "climate",
      size: "wide",
      bindings: { climate: climateEntities },
    });
  }

  for (const [kind, title] of [
    ["washer", "Washing machine"],
    ["dryer", "Dryer"],
  ] as const) {
    const binding = first(global, kind);
    if (binding) {
      cards.push({
        instanceId: `${kind}-overview`,
        card: "appliance",
        size: "md",
        bindings: { [kind]: binding },
        props: { title },
      });
    }
  }

  const vacuum = first(global, "vacuum");
  if (vacuum) {
    cards.push({
      instanceId: "vacuum-overview",
      card: "vacuum",
      size: "md",
      bindings: { vacuum },
      props: { title: "Robot vacuum" },
    });
  }

  const security = bindingsFrom(global, ["lock", "alarm", "garage"]);
  if (Object.keys(security).length) {
    cards.push({
      instanceId: "security-overview",
      card: "security",
      size: "md",
      bindings: security,
    });
  }

  return cards;
}

export function planDashboards(request: PlanRequest): DashboardManifest[] {
  const prefix = request.namePrefix ?? request.home.name ?? "Home";

  return request.targets.map((profile) => {
    const target = targetFor(profile);
    const columns = target.columns ?? 12;
    const cards = autoLayout(
      [...roomCards(request.home, profile), ...globalCards(request.home)],
      columns,
    );

    return {
      schemaVersion: "2",
      id: `${slug(prefix)}-${profile}`,
      name: `${prefix} · ${profile}`,
      target,
      theme: "glass-dark",
      generatedBy: "homeframe-planner",
      cards,
    };
  });
}
