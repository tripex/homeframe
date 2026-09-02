import {
  discoverHome,
  HomeAssistantClient,
  type Capability,
  type CapabilityKind,
  type SemanticHome,
} from "@homeframe/core";
import type { CapabilityMap, HomeAreaSnapshot, HomeSnapshot } from "./planner.js";

/**
 * Capability kinds the planner reads from `HomeSnapshot.capabilities` (the
 * global map) rather than from a specific area — see `globalCards` in
 * planner.ts. Real installations usually still assign these entities to an
 * area (the vacuum lives in the hallway closet, the front-door lock belongs
 * to the entryway), so when converting a live SemanticHome we promote them
 * into the global map *in addition to* leaving them in their area, instead of
 * requiring the entity to be unassigned in Home Assistant.
 */
const HOME_LEVEL_KINDS: readonly CapabilityKind[] = [
  "power",
  "energy",
  "washer",
  "dryer",
  "vacuum",
  "lock",
  "alarm",
  "garage",
];

/** Add one capability's entity id to a capability map, deduped and in order. */
function addCapability(map: CapabilityMap, capability: Capability): void {
  if (capability.kind === "generic") return;

  const existing = map[capability.kind];
  if (existing) {
    if (!existing.includes(capability.entityId)) existing.push(capability.entityId);
  } else {
    map[capability.kind] = [capability.entityId];
  }
}

function groupCapabilities(capabilities: Capability[]): CapabilityMap {
  const map: CapabilityMap = {};
  for (const capability of capabilities) addCapability(map, capability);
  return map;
}

/**
 * Convert the live SemanticHome that `discoverHome` produces into the neutral
 * HomeSnapshot the dashboard planner consumes. Pure and synchronous so it can
 * be unit-tested without a Home Assistant connection.
 */
export function homeSnapshotFromSemanticHome(home: SemanticHome, name?: string): HomeSnapshot {
  const globalCapabilities = groupCapabilities(home.unassigned);
  const areas: HomeAreaSnapshot[] = [];

  for (const area of home.areas) {
    const capabilities = groupCapabilities(area.capabilities);

    // Areas that only had "generic" (unclassified) capabilities have nothing
    // a card contract can bind to, so they would just be dead weight on a
    // dashboard plan.
    if (Object.keys(capabilities).length === 0) continue;

    areas.push({ id: area.id, name: area.name, capabilities });

    for (const capability of area.capabilities) {
      if (HOME_LEVEL_KINDS.includes(capability.kind)) {
        addCapability(globalCapabilities, capability);
      }
    }
  }

  return {
    name: name ?? "Home",
    areas,
    capabilities: globalCapabilities,
  };
}

export type HomeSnapshotSource = {
  /** Homeframe Runtime base URL, e.g. http://127.0.0.1:4173 */
  runtimeUrl?: string;
  /** Direct Home Assistant base URL, used when no runtime is available. */
  homeAssistantUrl?: string;
  homeAssistantToken?: string;
  name?: string;
};

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4173";

const NO_SOURCE_CONFIGURED_MESSAGE =
  "No way to reach a live home was configured. Provide one of: " +
  "a runtimeUrl (or HOMEFRAME_RUNTIME_URL) pointing at a running Homeframe Runtime, " +
  "or HOMEFRAME_HA_URL + HOMEFRAME_HA_TOKEN for a direct Home Assistant connection. " +
  `Also tried the default local runtime at ${DEFAULT_RUNTIME_URL} and could not reach it.`;

/** Thrown when a Homeframe Runtime answered but is not connected to Home Assistant. */
class RuntimeNotConnectedError extends Error {}

type RuntimeSnapshotBody = {
  status?: string;
  error?: string;
  semanticHome?: SemanticHome;
};

async function loadFromRuntime(runtimeUrl: string, name?: string): Promise<HomeSnapshot> {
  const base = runtimeUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/ha/snapshot`);
  const body = (await response.json().catch(() => ({}))) as RuntimeSnapshotBody;

  if (!response.ok || body.status !== "connected") {
    const status = body.status ?? String(response.status);
    const detail = body.error ? `, error: ${body.error}` : "";
    throw new RuntimeNotConnectedError(
      `Homeframe Runtime at ${runtimeUrl} is not connected to Home Assistant (status: ${status}${detail})`,
    );
  }

  return homeSnapshotFromSemanticHome(body.semanticHome as SemanticHome, name);
}

async function loadFromHomeAssistant(
  url: string,
  token: string,
  name?: string,
): Promise<HomeSnapshot> {
  const client = new HomeAssistantClient(url, token);

  try {
    await client.connect();
    const registrySnapshot = await client.getSnapshot();
    return homeSnapshotFromSemanticHome(discoverHome(registrySnapshot), name);
  } finally {
    client.close();
  }
}

/**
 * Load a HomeSnapshot from whichever live source is configured, preferring
 * Homeframe Runtime (it already holds an open Home Assistant connection) over
 * a direct Home Assistant connection made just for this call.
 */
export async function loadHomeSnapshot(source: HomeSnapshotSource = {}): Promise<HomeSnapshot> {
  const runtimeUrl = source.runtimeUrl ?? process.env.HOMEFRAME_RUNTIME_URL;
  const homeAssistantUrl = source.homeAssistantUrl ?? process.env.HOMEFRAME_HA_URL;
  const homeAssistantToken = source.homeAssistantToken ?? process.env.HOMEFRAME_HA_TOKEN;

  if (runtimeUrl) {
    return loadFromRuntime(runtimeUrl, source.name);
  }

  if (homeAssistantUrl && homeAssistantToken) {
    return loadFromHomeAssistant(homeAssistantUrl, homeAssistantToken, source.name);
  }

  // Nothing was explicitly configured. Most installations run `npm start` on
  // the same host as the agent, so try the default local runtime once before
  // giving up.
  try {
    return await loadFromRuntime(DEFAULT_RUNTIME_URL, source.name);
  } catch (reason) {
    if (reason instanceof RuntimeNotConnectedError) throw reason;
    throw new Error(NO_SOURCE_CONFIGURED_MESSAGE);
  }
}
