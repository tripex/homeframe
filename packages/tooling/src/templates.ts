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
  otherwise?: Array<Omit<TemplateStackCard, "otherwise" | "h" | "priority" | "grow">>;
  /**
   * With a region `rows` budget: cards are kept by descending priority until
   * the budget is used, then laid out in listed order. Defaults to 0.
   */
  priority?: number;
  /**
   * Grow into rows left over in the budget, up to this many rows in total
   * (never below `h`). Growing cards take what is left in listed order, so a
   * home without an energy card gets its usual tall agenda back.
   */
  grow?: number;
};

/** Cards stacked top to bottom in a fixed column span. */
export type TemplateStackRegion = {
  id: string;
  x: number;
  w: number;
  /**
   * Height budget in grid rows. Cards that do not fit are left out, lowest
   * priority first, so an optional card (energy flow) can push out a less
   * important one (forecast) instead of scrolling the screen. Without one,
   * a template with `rows` gives every stack the rows above its tile band.
   */
  rows?: number;
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

/** One source of tiles in a tile band: every camera, every room… */
export type TemplateTileSource = {
  id: string;
  card: string;
  /** Natural width; a camera at its 16:9 size, a room card at its smallest. */
  w: number;
  /** Widest a tile may become while its row is stretched to the full span. */
  maxW?: number;
  max: number;
  repeat: TemplateRepeatRegion["repeat"];
  bindings?: TemplateBindings;
};

/**
 * A band of equally tall tiles from several sources, packed left to right in
 * source order (cameras, then rooms) into at most `maxRows` rows. Rows are
 * balanced and stretched to the full span, so three cameras and a few rooms
 * share the band without a gap. In a template with `rows` the band sits at
 * the bottom of the screen and the stacks above get the rest.
 */
export type TemplateTileRegion = {
  id: string;
  x?: number;
  span?: number;
  h: number;
  maxRows: number;
  tiles: TemplateTileSource[];
};

export type TemplateRegion = TemplateStackRegion | TemplateRepeatRegion | TemplateTileRegion;

export type DashboardTemplate = {
  id: string;
  displayName: string;
  description: string;
  aiSummary: string;
  profile: DeviceProfileId;
  navigation?: { style?: "side" | "bottom"; people?: string };
  /**
   * Screen height in grid rows for templates that fill the screen (the
   * desktop grid stretches its rows to the window). Stacks without their
   * own `rows` budget get what the tile bands leave.
   */
  rows?: number;
  /** Stacked regions share the top band; repeat rows and tile bands follow below it. */
  regions: TemplateRegion[];
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

function isStack(region: TemplateRegion): region is TemplateStackRegion {
  return "stack" in region;
}

function isTiles(region: TemplateRegion): region is TemplateTileRegion {
  return "tiles" in region;
}

type StackSlot = Omit<TemplateStackCard, "otherwise">;

/**
 * Resolve a stack to the cards that are shown and their heights: pick each
 * slot's first alternative whose `requires` is met, keep slots by priority
 * within the `rows` budget, then let the `grow` slot absorb what is left.
 */
function fitStack(
  region: TemplateStackRegion,
  lookup: (kind: string) => string[],
  budget: number | undefined = region.rows,
): StackSlot[] {
  const met = (candidate: { requires?: string[] }) =>
    !candidate.requires || candidate.requires.some((kind) => lookup(kind).length);

  const available = region.stack.flatMap((preferred, index) => {
    const choice = [preferred, ...(preferred.otherwise ?? [])].find(met);
    if (!choice) return [];
    const slot: StackSlot = {
      instanceId: choice.instanceId,
      card: choice.card,
      h: preferred.h,
      ...(choice.bindings ? { bindings: choice.bindings } : {}),
      ...(choice.props ? { props: choice.props } : {}),
      ...(preferred.priority !== undefined ? { priority: preferred.priority } : {}),
      ...(preferred.grow !== undefined ? { grow: preferred.grow } : {}),
    };
    return [{ slot, index }];
  });

  if (budget === undefined) return available.map(({ slot }) => slot);

  let used = 0;
  const kept = new Set<number>();
  for (const { slot, index } of [...available].sort(
    (a, b) => (b.slot.priority ?? 0) - (a.slot.priority ?? 0) || a.index - b.index,
  )) {
    if (used + slot.h > budget) continue;
    used += slot.h;
    kept.add(index);
  }

  const shown = available.filter(({ index }) => kept.has(index)).map(({ slot }) => ({ ...slot }));
  for (const grower of shown.filter((slot) => slot.grow !== undefined)) {
    const before = grower.h;
    grower.h = Math.max(before, Math.min(grower.grow ?? before, before + budget - used));
    used += grower.h - before;
  }
  return shown;
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

type RepeatSource = Pick<TemplateRepeatRegion, "id" | "card" | "max" | "repeat" | "bindings">;

function repeatCards(region: RepeatSource, home: HomeSnapshot): DashboardCard[] {
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

type Tile = { card: DashboardCard; w: number; maxW: number };

/** Every way to cut `tiles` into `rows` consecutive, non-empty rows that each fit `span`. */
function splits(tiles: Tile[], rows: number, span: number): Tile[][][] {
  if (rows === 1) return tiles.reduce((sum, tile) => sum + tile.w, 0) <= span ? [[tiles]] : [];
  const out: Tile[][][] = [];
  let width = 0;
  for (let cut = 1; cut <= tiles.length - rows + 1; cut += 1) {
    width += tiles[cut - 1].w;
    if (width > span) break;
    for (const rest of splits(tiles.slice(cut), rows - 1, span)) out.push([tiles.slice(0, cut), ...rest]);
  }
  return out;
}

/** How badly a row has to stretch: columns it cannot fill, then the widest stretch. */
function stretchCost(row: Tile[], span: number): [number, number] {
  const natural = row.reduce((sum, tile) => sum + tile.w, 0);
  const capacity = row.reduce((sum, tile) => sum + tile.maxW, 0);
  return [Math.max(0, span - capacity), span / natural];
}

/** Widen the tiles of a row to the span, the least stretched tile first. */
function stretchRow(row: Tile[], span: number): number[] {
  const widths = row.map((tile) => tile.w);
  let extra = span - widths.reduce((sum, w) => sum + w, 0);
  while (extra > 0) {
    let pick = -1;
    row.forEach((tile, index) => {
      if (widths[index] >= tile.maxW) return;
      // Ties go to the later tile: rooms widen before cameras lose 16:9.
      if (pick < 0 || widths[index] / tile.w <= widths[pick] / row[pick].w) pick = index;
    });
    if (pick < 0) break;
    widths[pick] += 1;
    extra -= 1;
  }
  return widths;
}

/**
 * Pack a tile band: take tiles in source order while they fit `maxRows`
 * rows, re-cut them into the most even rows and stretch each row to the
 * span. Returns the number of grid rows the band needs.
 */
function packTiles(region: TemplateTileRegion, home: HomeSnapshot, columns: number): { rows: Tile[][]; height: number } {
  const left = region.x ?? 0;
  const span = Math.min(region.span ?? columns - left, columns - left);
  const tiles: Tile[] = region.tiles.flatMap((source) =>
    repeatCards(source, home).map((card) => ({
      card,
      w: Math.min(source.w, span),
      maxW: Math.min(Math.max(source.maxW ?? source.w, source.w), span),
    })),
  );

  // Greedy fill decides how many tiles fit in `limit` rows…
  const fill = (limit: number) => {
    const taken: Tile[] = [];
    let rowCount = 0;
    let used = span;
    for (const tile of tiles) {
      if (used + tile.w > span) {
        if (rowCount === limit) continue;
        rowCount += 1;
        used = 0;
      }
      used += tile.w;
      taken.push(tile);
    }
    return { taken, rowCount };
  };

  // …then they are re-cut into the most even rows.
  const bestCut = (limit: number) => {
    const { taken, rowCount } = fill(limit);
    if (!taken.length) return undefined;
    return splits(taken, rowCount, span)
      .map((rows) => {
        const costs = rows.map((row) => stretchCost(row, span));
        return { rows, gap: costs.reduce((sum, [gap]) => sum + gap, 0), stretch: Math.max(...costs.map(([, s]) => s)) };
      })
      .sort((a, b) => a.gap - b.gap || a.stretch - b.stretch)[0];
  };

  // A row that cannot be filled (two cameras and three rooms) leaves a
  // hole; one row fewer, with a tile left out, closes it.
  let best = bestCut(region.maxRows);
  for (let limit = (best?.rows.length ?? 0) - 1; best && best.gap > 0 && limit >= 1; limit -= 1) {
    const fewer = bestCut(limit);
    if (fewer && fewer.gap === 0) best = fewer;
  }
  if (!best) return { rows: [], height: 0 };
  return { rows: best.rows, height: best.rows.length * region.h };
}

function placeTiles(region: TemplateTileRegion, rows: Tile[][], columns: number, top: number, out: DashboardCard[]): void {
  const left = region.x ?? 0;
  const span = Math.min(region.span ?? columns - left, columns - left);
  rows.forEach((row, rowIndex) => {
    let x = left;
    stretchRow(row, span).forEach((w, index) => {
      out.push({ ...row[index].card, layout: { x, y: top + rowIndex * region.h, w, h: region.h } });
      x += w;
    });
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

  // Tile bands are packed first: how many rows they need decides how much
  // the stacks above them may use on a screen-filling template.
  const bands = template.regions.filter(isTiles).map((region) => ({ region, ...packTiles(region, home, columns) }));
  const bandRows = bands.reduce((sum, band) => sum + band.height, 0);
  const stackBudget = template.rows === undefined ? undefined : Math.max(0, template.rows - bandRows);

  // Stacked regions sit side by side in the top band.
  const bottoms = new Map<string, number>();
  for (const region of template.regions.filter(isStack)) {
    let y = 0;
    for (const slot of fitStack(region, lookup, region.rows ?? stackBudget)) {
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
    if (isStack(region) || isTiles(region)) continue;
    const top = region.below !== undefined ? (bottoms.get(region.below) ?? 0) : Math.max(0, ...bottoms.values());
    bottoms.set(region.id, tileRow(repeatCards(region, home), region, columns, top, cards));
  }

  // Tile bands close the screen: at its foot on a screen-filling template,
  // otherwise under everything placed so far.
  let bandTop = stackBudget ?? Math.max(0, ...bottoms.values());
  for (const band of bands) {
    placeTiles(band.region, band.rows, columns, bandTop, cards);
    bandTop += band.height;
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
