import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  DashboardCard,
  DashboardManifest,
  DeviceProfileId,
  EntityBinding,
} from "@homeframe/sdk";
import { frameworkRoot } from "./catalog.js";
import type { HomeAreaSnapshot, HomeSnapshot } from "./planner.js";
import { atmosphereFor, slug, targetFor } from "./planner.js";

/**
 * A dashboard template is a hand-designed screen layout that can be filled in
 * from any HomeSnapshot. Templates live in `catalog/templates` next to the
 * card contracts and, like them, never contain entity ids — only capability
 * kinds.
 *
 * Binding sources are capability kinds: `"lock"` binds the first lock in the
 * home, `"lock[]"` binds every lock.
 */
export type TemplateBindings = Record<string, string>;

/** One card in a stacked region. */
export type TemplateStackCard = {
  instanceId: string;
  card: string;
  h: number;
  bindings?: TemplateBindings;
  props?: Record<string, string | number | boolean>;
  /** Skip the card unless at least one of these capability kinds exists. */
  requires?: string[];
  /** Tried in order when `requires` is not met, e.g. a vacuum when there is no calendar. */
  otherwise?: Array<Omit<TemplateStackCard, "otherwise" | "h">>;
};

/** Cards stacked top to bottom in a fixed column span. */
export type TemplateStackRegion = {
  id: string;
  x: number;
  w: number;
  stack: TemplateStackCard[];
};

/** One card per matching entity (e.g. every camera) or per area. */
export type TemplateRepeatRegion = {
  id: string;
  card: string;
  /** Minimum card width; with `fill` cards widen to share the row evenly. */
  w: number;
  h: number;
  max: number;
  fill?: boolean;
  /** Column span of the row; defaults to the whole grid. */
  x?: number;
  span?: number;
  /** Start directly under this region instead of under everything placed so far. */
  below?: string;
  /** `{ "kind": "camera", "binding": "camera" }` or `{ "areas": true }`. */
  repeat: { kind: string; binding: string } | { areas: true };
  bindings?: TemplateBindings;
};

export type DashboardTemplate = {
  id: string;
  displayName: string;
  description: string;
  aiSummary: string;
  profile: DeviceProfileId;
  navigation?: { style?: "side" | "bottom"; people?: string };
  /** Stacked regions share the top band; repeat rows follow below it in order. */
  regions: Array<TemplateStackRegion | TemplateRepeatRegion>;
};

export type TemplateOptions = {
  id?: string;
  name?: string;
  locale?: string;
};

function templatesDir(root?: string): string {
  return path.join(frameworkRoot(root), "catalog", "templates");
}

export async function listTemplates(root?: string): Promise<DashboardTemplate[]> {
  const dir = templatesDir(root);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const templates = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(dir, file), "utf8")) as DashboardTemplate),
  );
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getTemplate(id: string, root?: string): Promise<DashboardTemplate | undefined> {
  return (await listTemplates(root)).find((template) => template.id === id);
}

/** Every entity of `kind` in the home: home-level ones first, then per area. */
function homeEntities(home: HomeSnapshot, kind: string): string[] {
  const all = [
    ...(home.capabilities?.[kind] ?? []),
    ...home.areas.flatMap((area) => area.capabilities[kind] ?? []),
  ];
  return [...new Set(all.filter(Boolean))];
}

function resolveSource(source: string, lookup: (kind: string) => string[]): EntityBinding | undefined {
  const many = source.endsWith("[]");
  const ids = lookup(many ? source.slice(0, -2) : source);
  if (!ids.length) return undefined;
  return many ? ids : ids[0];
}

function resolveBindings(
  spec: TemplateBindings | undefined,
  lookup: (kind: string) => string[],
): Record<string, EntityBinding> {
  const resolved: Record<string, EntityBinding> = {};
  for (const [binding, source] of Object.entries(spec ?? {})) {
    const value = resolveSource(source, lookup);
    if (value) resolved[binding] = value;
  }
  return resolved;
}

function isStack(region: TemplateStackRegion | TemplateRepeatRegion): region is TemplateStackRegion {
  return "stack" in region;
}

/**
 * Rooms worth a card first: a temperature reading is what a room card shows
 * biggest, lights make it actionable. Ties keep the snapshot's order.
 */
function roomScore(area: HomeAreaSnapshot): number {
  const has = (kind: string) => (area.capabilities[kind]?.length ?? 0) > 0;
  return (has("temperature") ? 4 : 0) + (has("light") ? 2 : 0) + (has("climate") ? 1 : 0) + (has("humidity") ? 1 : 0);
}

/** Tile cards left to right from `top`, wrapping at the row width. Returns the next free row. */
function tileRow(cards: DashboardCard[], region: TemplateRepeatRegion, columns: number, top: number, out: DashboardCard[]): number {
  if (!cards.length) return top;
  const left = region.x ?? 0;
  const span = Math.min(region.span ?? columns - left, columns - left);
  const minimum = Math.min(region.w, span);
  // Three rooms on a twelve-column row become three cards of four, not
  // three of three with an empty gap at the end.
  const width = region.fill ? Math.max(minimum, Math.floor(span / Math.min(cards.length, Math.floor(span / minimum)))) : minimum;
  const perRow = Math.max(1, Math.floor(span / width));

  cards.forEach((card, index) => {
    out.push({
      ...card,
      layout: {
        x: left + (index % perRow) * width,
        y: top + Math.floor(index / perRow) * region.h,
        w: width,
        h: region.h,
      },
    });
  });

  return top + Math.ceil(cards.length / perRow) * region.h;
}

function repeatCards(region: TemplateRepeatRegion, home: HomeSnapshot): DashboardCard[] {
  if ("kind" in region.repeat) {
    const { kind, binding } = region.repeat;
    return homeEntities(home, kind)
      .slice(0, region.max)
      .map((entityId, index) => ({
        instanceId: `${region.id}-${index + 1}`,
        card: region.card,
        bindings: { ...resolveBindings(region.bindings, (k) => homeEntities(home, k)), [binding]: entityId },
      }));
  }

  return home.areas
    .map((area, index) => ({ area, index, score: roomScore(area) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, region.max)
    .flatMap(({ area }) => {
      const bindings = resolveBindings(region.bindings, (kind) => area.capabilities[kind] ?? []);
      if (!Object.keys(bindings).length) return [];
      return [
        {
          instanceId: `${region.id}-${slug(area.id)}`,
          card: region.card,
          areaId: area.id,
          props: { name: area.name },
          bindings,
        } satisfies DashboardCard,
      ];
    });
}

/**
 * Fill a template in from a HomeSnapshot. Pure, so it can be previewed
 * before anything is saved. Cards whose `requires` cannot be met are left out
 * and their stack closes the gap; cards that only miss optional bindings stay
 * and render their own empty state.
 */
export function instantiateTemplate(
  template: DashboardTemplate,
  home: HomeSnapshot,
  options: TemplateOptions = {},
): DashboardManifest {
  const target = targetFor(template.profile);
  const columns = target.columns ?? 12;
  const lookup = (kind: string) => homeEntities(home, kind);
  const cards: DashboardCard[] = [];

  // Stacked regions sit side by side in the top band.
  const bottoms = new Map<string, number>();
  for (const region of template.regions.filter(isStack)) {
    let y = 0;
    for (const preferred of region.stack) {
      const met = (candidate: { requires?: string[] }) =>
        !candidate.requires || candidate.requires.some((kind) => lookup(kind).length);
      const choice = [preferred, ...(preferred.otherwise ?? [])].find(met);
      if (!choice) continue;
      const slot = { ...choice, h: preferred.h };
      cards.push({
        instanceId: slot.instanceId,
        card: slot.card,
        ...(slot.props ? { props: { ...slot.props } } : {}),
        bindings: resolveBindings(slot.bindings, lookup),
        layout: { x: region.x, y, w: region.w, h: slot.h },
      });
      y += slot.h;
    }
    bottoms.set(region.id, y);
  }

  // Repeat rows follow, each under a named region or under everything so far.
  for (const region of template.regions) {
    if (isStack(region)) continue;
    const top = region.below !== undefined ? (bottoms.get(region.below) ?? 0) : Math.max(0, ...bottoms.values());
    bottoms.set(region.id, tileRow(repeatCards(region, home), region, columns, top, cards));
  }

  const homeName = home.name ?? "Home";
  // Always a list in the manifest, even when the template names a single kind.
  const peopleKind = template.navigation?.people?.replace(/\[\]$/, "");
  const people = peopleKind ? lookup(peopleKind) : [];

  return {
    schemaVersion: "2",
    id: options.id ?? `${slug(homeName)}-${template.id}`,
    name: options.name ?? `${homeName} · ${template.displayName}`,
    target,
    theme: "glass-dark",
    atmosphere: atmosphereFor(home),
    navigation: {
      ...(template.navigation?.style ? { style: template.navigation.style } : {}),
      ...(people.length ? { people } : {}),
    },
    ...(options.locale ? { locale: options.locale } : {}),
    generatedBy: `homeframe-template:${template.id}`,
    cards,
  };
}
