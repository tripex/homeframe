import { tidyName } from "./names.js";
import type { DeviceRegistryEntry, EntityRegistryEntry, HassState, RegistrySnapshot } from "./types.js";

/**
 * Washers, dryers and dishwashers.
 *
 * An appliance is not one entity: an LG ThinQ washer has a status sensor, a
 * remaining-time sensor, a total-time sensor, energy counters and a power
 * switch on one device. Discovery therefore groups the entities of a device
 * into roles, and the card reads every role through its own binding.
 *
 * Two sources are supported:
 *
 * - **status**: the appliance's own integration reports a state (LG ThinQ,
 *   SmartThinQ, Home Connect, Miele, SmartThings, Electrolux or anything with
 *   a status/state sensor on a device named like an appliance).
 * - **power**: only a smart plug measures it. The plug (or its power sensor)
 *   must be named like the appliance ("Vaskemaskine", "Dishwasher plug").
 *   Running is power above a threshold; see `applianceStatus`.
 *
 * Ideas for the status rules (power threshold, the finished/off word lists,
 * phase words) come from skyrotter/ha-appliance-electromenager-cards (MIT,
 * https://github.com/skyrotter/ha-appliance-electromenager-cards). The code
 * and the per-integration tables here are Homeframe's own.
 */

export type ApplianceKind = "washer" | "dryer" | "dishwasher";

export const APPLIANCE_KINDS: readonly ApplianceKind[] = ["washer", "dryer", "dishwasher"];

/** Card bindings of an appliance; each names one entity. */
export type ApplianceRole =
  | "status"
  | "phase"
  | "remaining"
  | "end_time"
  | "total"
  | "progress"
  | "program"
  | "door"
  | "power"
  | "energy"
  | "switch";

export type Appliance = {
  /** Home Assistant device id, or the entity id of a device-less plug sensor. */
  id: string;
  kind: ApplianceKind;
  name: string;
  areaId?: string;
  /** `status`: the integration reports a state. `power`: a smart plug only. */
  source: "status" | "power";
  entities: Partial<Record<ApplianceRole, string>>;
};

// --- Recognising the appliance kind ----------------------------------------

/**
 * Kind from a device or entity name/model, in English, Danish and a few
 * neighbours. Order matters: "opvaskemaskine" contains "vaskemaskine", and a
 * washer-dryer is a washer.
 */
export function applianceKindFromText(text: string): ApplianceKind | undefined {
  const value = text.toLowerCase();
  if (/dish[\s_-]?wash|dishcare|opvask|geschirrsp|lave[\s_-]?vaisselle|vaatwas|diskmaskin|oppvaskmaskin/.test(value)) {
    return "dishwasher";
  }
  if (/wash[\s_-]?tower|washer[\s_-]?dryer|vaske[\s_-]?t(ø|o)rre|waschtrockner|lavante[\s_-]?s(e|é)chante/.test(value)) {
    return "washer";
  }
  if (/dryer|tumble|t(ø|o)rretumbler|trockner|s(è|e)che[\s_-]?linge|droger|torktumlare/.test(value)) return "dryer";
  if (/washer|washing[\s_-]?machine|vaskemaskin|waschmaschine|lave[\s_-]?linge|wasmachine|tv(ä|a)ttmaskin/.test(value)) {
    return "washer";
  }
  return undefined;
}

/** Translation keys that name the kind even when the device is called "LG" or "Bosch". */
function applianceKindFromEntity(entity: EntityRegistryEntry, state: HassState | undefined): ApplianceKind | undefined {
  const key = `${entity.translation_key ?? ""} ${entity.entity_id}`.toLowerCase();
  // SmartThings: washer_machine_state, dryer_job_state, dishwasher_completion_time…
  const smartThings = /(^|[\s._])(washer|dryer|dishwasher)_(machine_state|job_state|completion_time)/.exec(key);
  if (smartThings) return smartThings[2] as ApplianceKind;
  // Home Connect program selects list keys such as "dishcare_dishwasher_program_eco_50".
  const options = Array.isArray(state?.attributes.options) ? state.attributes.options.join(" ") : "";
  if (/dishcare_dishwasher/.test(options)) return "dishwasher";
  if (/laundrycare_dryer|laundry_care_dryer/.test(options)) return "dryer";
  if (/laundrycare_washer|laundry_care_washer/.test(options)) return "washer";
  return undefined;
}

// --- Roles -------------------------------------------------------------------

const domainOf = (entityId: string) => entityId.split(".")[0] ?? "";

/** Devices with one of these domains are something else (a vacuum that washes its mop, a lamp over the washer). */
const FOREIGN_DOMAINS = new Set(["vacuum", "light", "climate", "media_player", "camera", "lawn_mower", "fan", "water_heater", "cover", "lock"]);

const NOT_A_STATUS = /door|remote|error|connect|wifi|signal|battery|lock|child|rinse_aid|salt|filter|detergent|softener|phase|job_state|tub_clean|drum|water|energy|power|program|course|time|notification|light/;

type Candidate = { role: ApplianceRole; score: number };

function unitOf(state: HassState | undefined): string {
  return typeof state?.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement.trim() : "";
}

function deviceClassOf(state: HassState | undefined): string {
  return typeof state?.attributes.device_class === "string" ? state.attributes.device_class : "";
}

/**
 * Which role one entity of an appliance device plays, if any. `key` holds the
 * translation key, object id and names, lower case, with spaces as `_`.
 */
function roleOf(entity: EntityRegistryEntry, state: HassState | undefined, key: string): Candidate | undefined {
  const domain = domainOf(entity.entity_id);
  const deviceClass = deviceClassOf(state);
  const unit = unitOf(state);
  const tk = entity.translation_key ?? "";

  if (domain === "sensor" || domain === "binary_sensor" || domain === "input_select" || domain === "input_boolean") {
    // Door / lid.
    if ((domain === "binary_sensor" && deviceClass === "door") || /(^|_)(door|lid|d(ø|o)r|l(å|a)ge)(_|$)/.test(key)) {
      if (!/error|lock|alarm/.test(key)) return { role: "door", score: 5 };
    }
  }

  if (domain === "sensor") {
    if (deviceClass === "power" || /^k?w$/i.test(unit)) return { role: "power", score: 5 };
    if (deviceClass === "energy" || /^k?wh$/i.test(unit)) {
      // Only today's use is shown; a lifetime or monthly counter is not.
      if (/today|daily|i_dag|idag|(^|_)dag(_|$)|_day(_|$)/.test(key) && !/yesterday|i_g(å|a)r/.test(key)) {
        return { role: "energy", score: 5 };
      }
      return undefined;
    }
    if (/progress|fremskridt|fremdrift/.test(key) && (unit === "%" || !unit)) return { role: "progress", score: 5 };
    if (/delay|start_time|starttid|elapsed|forl(ø|o)bet|last_cycle|cycle_count|cycles/.test(key)) return undefined;
    if (/remain|time_to_end|timetoend|rest_?tid|resterende|tid_tilbage/.test(key)) return { role: "remaining", score: 5 };
    if (deviceClass === "timestamp" && /finish|complet|end_time|ends?_at|program_end|f(æ|ae)rdig|slut/.test(key)) {
      return { role: "end_time", score: 5 };
    }
    if (/(^|_)(total|total_time|initial_time|program_duration|estimated_duration|samlet_tid)(_|$)/.test(tk ? `_${tk}_` : key)) {
      return { role: "total", score: 4 };
    }
    if (/job_state|program_phase|cycle_phase|(^|_)phase(_|$)|programfase/.test(key)) return { role: "phase", score: 4 };
    if (/program|course|(^|_)cycle(_|$)/.test(key) && !/count|option|temp|spin|level|remote|selected/.test(key)) {
      return { role: "program", score: /active|current/.test(key) ? 5 : 4 };
    }
  }

  if (domain === "select" && /program|course/.test(key) && !/option|temp|spin|level/.test(key)) {
    // Home Connect: the running program beats the one merely selected.
    return { role: "program", score: /active/.test(key) ? 4 : 2 };
  }

  if (domain === "sensor" || domain === "binary_sensor" || domain === "input_select" || domain === "input_boolean") {
    const statusWord =
      /(^|_)(current_state|current_status|operation_state|operating_state|run_state|machine_state|appliance_state|status|state|tilstand|running|kører|in_use)(_|$)/;
    if (statusWord.test(key) && !NOT_A_STATUS.test(tk || key.replace(statusWord, "_"))) {
      let score = 4;
      if (/current_state|operation_state|run_state|machine_state|appliance_state|operating_state/.test(key)) score += 3;
      if (deviceClass === "enum") score += 1;
      if (domain === "binary_sensor" || domain === "input_boolean") score -= 2;
      return { role: "status", score };
    }
  }

  if (domain === "switch" && !/remote|child|lock|light|eco|mode|dry|steam|turbo|signal/.test(key)) {
    return { role: "switch", score: /power|plug|stik|outlet|socket|tænd/.test(key) ? 3 : 1 };
  }

  return undefined;
}

function entityKey(entity: EntityRegistryEntry, state: HassState | undefined): string {
  const objectId = entity.entity_id.split(".")[1] ?? "";
  const names = [entity.translation_key, objectId, entity.original_name, entity.name, String(state?.attributes.friendly_name ?? "")]
    .filter(Boolean)
    .join(" ");
  return `_${names.toLowerCase().replace(/[\s.-]+/g, "_")}_`;
}

function deviceName(device: DeviceRegistryEntry | undefined): string {
  return tidyName(device?.name_by_user ?? device?.name ?? "");
}

function kindName(kind: ApplianceKind): string {
  return kind === "washer" ? "Washer" : kind === "dryer" ? "Dryer" : "Dishwasher";
}

type Grouped = { entity: EntityRegistryEntry; state: HassState | undefined; key: string };

/** Best entity per role on one device. */
function assignRoles(members: Grouped[]): Partial<Record<ApplianceRole, string>> {
  const best = new Map<ApplianceRole, { entityId: string; score: number }>();
  for (const { entity, state, key } of members) {
    const candidate = roleOf(entity, state, key);
    if (!candidate) continue;
    let score = candidate.score;
    if (entity.entity_category === "diagnostic") score -= 1;
    if (state?.state === "unavailable") score -= 1;
    const current = best.get(candidate.role);
    if (!current || score > current.score) best.set(candidate.role, { entityId: entity.entity_id, score });
  }
  const roles: Partial<Record<ApplianceRole, string>> = {};
  for (const [role, { entityId }] of best) roles[role] = entityId;
  return roles;
}

function orderedRoles(roles: Partial<Record<ApplianceRole, string>>): Partial<Record<ApplianceRole, string>> {
  const order: ApplianceRole[] = ["status", "phase", "remaining", "end_time", "total", "progress", "program", "door", "power", "energy", "switch"];
  const out: Partial<Record<ApplianceRole, string>> = {};
  for (const role of order) if (roles[role]) out[role] = roles[role];
  return out;
}

/**
 * Find the washers, dryers and dishwashers of a home.
 *
 * Per device: the kind comes from the device name, model (LG: "…
 * (DEVICE_WASHER)") or a kind-specific translation key / program option.
 * Devices that also carry a light, vacuum, climate… are skipped (a lamp
 * named "Bad - vaskemaskine" is not a washer). The device needs a status
 * entity or a power sensor to count.
 *
 * Plug fallback: a power sensor without such a device, whose own name says
 * washer/vaskemaskine/…, becomes a `power` appliance. When a home has exactly
 * one status appliance and one plug appliance of the same kind, the plug's
 * power (and energy, when missing) is added to the status appliance instead:
 * it is the same machine.
 */
export function discoverAppliances(snapshot: RegistrySnapshot): Appliance[] {
  const states = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const byDevice = new Map<string, Grouped[]>();
  const loose: Grouped[] = [];

  for (const entity of snapshot.entities) {
    if (entity.disabled_by || entity.hidden_by) continue;
    const state = states.get(entity.entity_id);
    if (!state) continue;
    const grouped = { entity, state, key: entityKey(entity, state) };
    if (entity.device_id && devices.has(entity.device_id)) {
      const list = byDevice.get(entity.device_id) ?? [];
      list.push(grouped);
      byDevice.set(entity.device_id, list);
    } else {
      loose.push(grouped);
    }
  }

  const found: Appliance[] = [];
  const plugs: Appliance[] = [];

  for (const [deviceId, members] of byDevice) {
    if (members.some(({ entity }) => FOREIGN_DOMAINS.has(domainOf(entity.entity_id)))) continue;
    const device = devices.get(deviceId);
    const name = deviceName(device);
    const kind =
      applianceKindFromText(`${device?.name_by_user ?? ""} ${device?.name ?? ""} ${device?.model ?? ""}`) ??
      members.map(({ entity, state }) => applianceKindFromEntity(entity, state)).find(Boolean);

    if (kind) {
      const roles = assignRoles(members);
      if (!roles.status && !roles.power) continue;
      const appliance: Appliance = {
        id: deviceId,
        kind,
        name: name || kindName(kind),
        ...(device?.area_id ? { areaId: device.area_id } : {}),
        source: roles.status ? "status" : "power",
        entities: orderedRoles(roles),
      };
      (appliance.source === "status" ? found : plugs).push(appliance);
      continue;
    }

    // A generic plug ("Stikkontakt 3") whose power sensor is named after the appliance.
    for (const member of members) {
      const candidate = roleOf(member.entity, member.state, member.key);
      const kindFromName = candidate?.role === "power" ? applianceKindFromText(member.key) : undefined;
      if (!kindFromName) continue;
      const roles = assignRoles(members);
      plugs.push({
        id: deviceId,
        kind: kindFromName,
        name: tidyName(String(member.state?.attributes.friendly_name ?? "")).replace(/\s*(power|effekt|strøm)$/i, "") || name || kindName(kindFromName),
        ...(device?.area_id ? { areaId: device.area_id } : {}),
        source: "power",
        entities: orderedRoles({ power: member.entity.entity_id, ...(roles.energy ? { energy: roles.energy } : {}), ...(roles.switch ? { switch: roles.switch } : {}) }),
      });
      break;
    }
  }

  for (const member of loose) {
    const candidate = roleOf(member.entity, member.state, member.key);
    if (candidate?.role !== "power" && candidate?.role !== "status") continue;
    const kind = applianceKindFromText(member.key);
    if (!kind) continue;
    // A template sensor or helper ("input_boolean.washer_running") reports
    // the state; a device-less power sensor is a plug.
    const appliance: Appliance = {
      id: member.entity.entity_id,
      kind,
      name: tidyName(String(member.state?.attributes.friendly_name ?? "")).replace(/\s*(power|effekt|strøm|state|status|tilstand|running)$/i, "") || kindName(kind),
      ...(member.entity.area_id ? { areaId: member.entity.area_id } : {}),
      source: candidate.role,
      entities: { [candidate.role]: member.entity.entity_id },
    };
    (candidate.role === "status" ? found : plugs).push(appliance);
  }

  // One washer with a status and one washer plug: the same machine.
  for (const kind of APPLIANCE_KINDS) {
    const withStatus = found.filter((appliance) => appliance.kind === kind);
    const kindPlugs = plugs.filter((appliance) => appliance.kind === kind);
    if (withStatus.length === 1 && kindPlugs.length === 1) {
      const [target] = withStatus;
      const [plug] = kindPlugs;
      target.entities = orderedRoles({
        ...target.entities,
        power: target.entities.power ?? plug.entities.power,
        ...(target.entities.energy ?? plug.entities.energy ? { energy: target.entities.energy ?? plug.entities.energy } : {}),
      });
      plugs.splice(plugs.indexOf(plug), 1);
    }
  }

  return [...found, ...plugs].sort(
    (a, b) => APPLIANCE_KINDS.indexOf(a.kind) - APPLIANCE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name),
  );
}

/** The entity that stands for the whole appliance: its status, or the plug's power. */
export function primaryApplianceEntity(appliance: Appliance): string | undefined {
  return appliance.entities.status ?? appliance.entities.power;
}

// --- State -------------------------------------------------------------------

/**
 * What the card shows. `paused`, `error` and `finished` count as active, like
 * `running`: they are worth a place on the screen.
 */
export type ApplianceState = "running" | "paused" | "finished" | "error" | "idle" | "off" | "unavailable";

export type AppliancePhase = "wash" | "rinse" | "spin" | "dry" | "heat" | "cool" | "delayed";

export function applianceIsActive(state: ApplianceState): boolean {
  return state === "running" || state === "paused" || state === "finished" || state === "error";
}

/** Raw state words across integrations, normalised to lower case with `_`. */
const RAW_STATES: Record<string, ApplianceState | "delayed"> = {};
function table(state: ApplianceState | "delayed", words: string): void {
  for (const word of words.trim().split(/\s+/)) RAW_STATES[word] = state;
}
// LG ThinQ (current_state), SmartThinQ (run_state), Home Connect
// (operation_state), Miele (status), SmartThings (machine/job state),
// Electrolux (appliance_state) and generic words; Danish last.
table("running", `
  run running in_use inuse busy active program_running cycle_running in_progress on
  wash washing main_wash prewash pre_wash rinse rinsing spin spinning dry drying cooling cool_down
  soak soaking steam steam_softening refreshing detecting weight_sensing sensing dispensing
  add_drain drain draining heating preheat preheating frozen_prevent_running frozen_prevent_initial
  air_wash ai_wash ai_rinse ai_spin wrinkle_prevent anti_crease
  autocleaning drying_phase running_main
  kører vasker skyller centrifugerer tørrer i_gang`);
table("paused", `pause paused rinse_hold frozen_prevent_pause actionrequired action_required program_interrupted interrupted aborting sat_på_pause`);
table("finished", `end ended finish finished done complete completed program_ended cycle_finished end_of_cycle færdig slut afsluttet`);
table("error", `error failure fault alarm`);
table("off", `off power_off poweroff inactive slukket`);
table("idle", `idle ready standby stop stopped initial sleep programmed none waiting ready_to_start klar standby_mode`);
table("delayed", `delayedstart delayed_start delay_wash delay reserved waiting_to_start scheduled`);

/** Phase words from the status, a phase/job-state sensor or the program. */
export function phaseOf(text: string): AppliancePhase | undefined {
  const value = text.toLowerCase();
  if (/rins|skyl/.test(value)) return "rinse";
  if (/spin|centrif|essor/.test(value)) return "spin";
  if (/cool|køl|wrinkle|crease|refroid/.test(value)) return "cool";
  // At a word start: Home Connect keys like "laundry_care_washer_program_…" contain "dry".
  if (/(^|[^a-zæøå])(dry|drying|tør)/.test(value)) return "dry";
  if (/(^|[^a-zæøå])(heat|varm)/.test(value)) return "heat";
  if (/wash|vask|soak|steam|prewash|detect|sens|dispens/.test(value)) return "wash";
  return undefined;
}

/** Normalise one raw status state. Unknown text that names a phase counts as running. */
export function normaliseApplianceState(raw: string | undefined): { state: ApplianceState; delayed?: boolean } {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!value || value === "unknown" || value === "unavailable") return { state: "unavailable" };
  const known = RAW_STATES[value];
  if (known === "delayed") return { state: "idle", delayed: true };
  if (known) return { state: known };
  // Free text ("End of cycle", "Ready to start", "Program running"…).
  if (/finish|complete|done|end_of|ended|færdig/.test(value)) return { state: "finished" };
  if (/delay|reserv|scheduled|waiting_to/.test(value)) return { state: "idle", delayed: true };
  if (/error|fail|fault/.test(value)) return { state: "error" };
  if (/pause|hold|interrupt/.test(value)) return { state: "paused" };
  if (/(^|_)off(_|$)|power_off/.test(value)) return { state: "off" };
  if (/idle|ready|standby|stop|klar/.test(value)) return { state: "idle" };
  if (/run|kør|progress/.test(value) || phaseOf(value)) return { state: "running" };
  return { state: "idle" };
}

/** Plug fallback: above this the appliance runs (W). */
export const DEFAULT_POWER_THRESHOLD_W = 10;
/** Below the threshold for less than this, a cycle is only soaking or pausing. */
export const PLUG_CYCLE_GAP_MS = 5 * 60_000;
/** After this long below the threshold, "finished" becomes "idle". */
export const PLUG_FINISHED_FOR_MS = 2 * 60 * 60_000;

/** Remembered between calls for plug appliances: when power was last above the threshold. */
export type ApplianceMemory = { lastActiveAt?: number };

export type ApplianceStates = Partial<Record<ApplianceRole, HassState | undefined>>;

export type ApplianceReading = {
  state: ApplianceState;
  phase?: AppliancePhase;
  /** Whole minutes left while running or paused. */
  remainingMinutes?: number;
  /** When the program ends (running) or ended (finished), if known. */
  endsAt?: Date;
  progress?: number;
  program?: string;
  doorOpen?: boolean;
  powerW?: number;
  energyTodayKwh?: number;
  memory: ApplianceMemory;
};

const MISSING = new Set(["", "unknown", "unavailable", "none", "-", "null"]);

function present(state: HassState | undefined): state is HassState {
  return Boolean(state && !MISSING.has(String(state.state).trim().toLowerCase()));
}

function numberOf(state: HassState | undefined): number | undefined {
  if (!present(state)) return undefined;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : undefined;
}

function wattsOf(state: HassState | undefined): number | undefined {
  const value = numberOf(state);
  if (value === undefined) return undefined;
  return /^kw$/i.test(unitOf(state)) ? value * 1000 : value;
}

/** Minutes from a duration sensor: min/h/s, or text such as "1:23" / "01:23:00". */
function minutesOf(state: HassState | undefined): number | undefined {
  if (!present(state)) return undefined;
  const text = String(state.state).trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  const unit = unitOf(state).toLowerCase();
  if (unit === "h") return value * 60;
  if (unit === "s") return value / 60;
  if (unit === "d") return value * 24 * 60;
  return value;
}

function timestampOf(state: HassState | undefined): number | undefined {
  if (!present(state)) return undefined;
  const parsed = Date.parse(String(state.state));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isOnState(state: HassState | undefined): boolean {
  return ["on", "open", "opened", "true", "åben"].includes(String(state?.state ?? "").toLowerCase());
}

/** "laundry_care_washer_program_cotton_eco" → "Cotton eco"; "Bomuld" stays. */
export function programLabel(raw: string): string {
  const stripped = raw
    .replace(/^.*?(?:_program_|\.program\.|programs?\.)/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!stripped) return raw;
  return stripped === stripped.toLowerCase() ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : stripped;
}

/**
 * Read an appliance's state from its bound entities. Pure: the caller passes
 * the clock, a threshold for plugs and the memory returned last time.
 *
 * - With a status entity, its normalised state wins. A plug that still draws
 *   power turns "finished" back into "running"; a power switch that is off
 *   means off.
 * - Plug only: power above the threshold is running. Below it, the cycle is
 *   still running for `PLUG_CYCLE_GAP_MS` (soaking), then finished for
 *   `PLUG_FINISHED_FOR_MS`, then idle. That needs `memory`; without it (a
 *   fresh page) a quiet plug is idle.
 */
export function applianceStatus(
  states: ApplianceStates,
  options: { now?: number; thresholdW?: number; memory?: ApplianceMemory } = {},
): ApplianceReading {
  const now = options.now ?? Date.now();
  const threshold = options.thresholdW ?? DEFAULT_POWER_THRESHOLD_W;
  const memory: ApplianceMemory = { ...options.memory };
  const powerW = wattsOf(states.power);
  if (powerW !== undefined && powerW > threshold) memory.lastActiveAt = now;

  let state: ApplianceState;
  let delayed = false;
  const status = states.status;

  if (status) {
    const domain = domainOf(status.entity_id);
    const normalised = normaliseApplianceState(status.state);
    if (normalised.state === "unavailable") state = "unavailable";
    else if (domain === "binary_sensor" || domain === "input_boolean") state = status.state === "on" ? "running" : "idle";
    else {
      state = normalised.state;
      delayed = normalised.delayed === true;
    }
    // Some integrations stop reporting while the machine is off.
    if (state === "unavailable" && states.switch?.state === "off") state = "off";
    if (state === "finished" && powerW !== undefined && powerW > threshold) state = "running";
  } else if (states.power) {
    if (powerW === undefined) state = "unavailable";
    else if (powerW > threshold) state = "running";
    else {
      const since = memory.lastActiveAt === undefined ? Infinity : now - memory.lastActiveAt;
      state = since < PLUG_CYCLE_GAP_MS ? "running" : since < PLUG_FINISHED_FOR_MS ? "finished" : "idle";
    }
  } else {
    state = "unavailable";
  }

  if (states.switch?.state === "off" && state !== "unavailable" && !applianceIsActive(state)) state = "off";
  if (states.switch?.state === "off" && !status && state !== "unavailable") state = "off";

  const reading: ApplianceReading = { state, memory };
  if (powerW !== undefined) reading.powerW = powerW;

  const energy = numberOf(states.energy);
  if (energy !== undefined) reading.energyTodayKwh = /^wh$/i.test(unitOf(states.energy)) ? energy / 1000 : energy;

  if (present(states.program)) reading.program = programLabel(String(states.program.state));
  if (states.door && present(states.door)) reading.doorOpen = isOnState(states.door);

  if (delayed) reading.phase = "delayed";
  else if (state === "running" || state === "paused") {
    const text = [states.phase?.state, status?.state].filter((value) => value && !MISSING.has(value)).join(" ");
    const phase = phaseOf(text);
    if (phase) reading.phase = phase;
  }

  if (state === "running" || state === "paused") {
    // A "remaining" sensor may be a timestamp (LG ThinQ, Home Connect) or a duration.
    const remainingAt = deviceClassOf(states.remaining) === "timestamp" ? timestampOf(states.remaining) : undefined;
    const endAt = remainingAt ?? timestampOf(states.end_time);
    let remaining = remainingAt === undefined ? minutesOf(states.remaining) : undefined;
    if (remaining === undefined && endAt !== undefined) remaining = (endAt - now) / 60_000;
    if (remaining !== undefined && remaining >= 0 && remaining < 48 * 60) {
      reading.remainingMinutes = Math.max(0, Math.round(remaining));
      reading.endsAt = new Date(endAt ?? now + remaining * 60_000);
    }

    const progress = numberOf(states.progress);
    const total = minutesOf(states.total);
    if (progress !== undefined) reading.progress = Math.min(100, Math.max(0, progress));
    else if (total && reading.remainingMinutes !== undefined && total >= reading.remainingMinutes) {
      reading.progress = Math.round(((total - reading.remainingMinutes) / total) * 100);
    }
  } else if (state === "finished") {
    // When the status turned "finished" is when the program ended.
    const changed = status ? Date.parse(status.last_changed) : memory.lastActiveAt;
    if (changed !== undefined && Number.isFinite(changed)) reading.endsAt = new Date(changed);
  }

  return reading;
}

/** Which active appliance deserves a shared slot first: finished laundry waits, then errors, running, paused. */
export function applianceUrgency(state: ApplianceState): number {
  return { finished: 4, error: 3, running: 2, paused: 1 }[state as "finished"] ?? 0;
}
