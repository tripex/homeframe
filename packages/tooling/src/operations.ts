import type {
  CardLayout,
  DashboardCard,
  DashboardManifest,
  DeviceProfileId,
  EntityBinding,
} from "@homeframe/sdk";
import { getCard } from "./catalog.js";
import {
  dataDir,
  deleteDashboard as deleteStoredDashboard,
  listDashboards as listStoredDashboards,
  readDashboard,
  writeDashboard,
} from "./dashboard-store.js";
import {
  autoLayout,
  planDashboards,
  targetFor,
  type PlanRequest,
} from "./planner.js";
import { validateDashboard } from "./validation.js";

export type EngineOptions = {
  dataDir?: string;
  frameworkRoot?: string;
};

export async function listDashboards(options: EngineOptions = {}) {
  return listStoredDashboards(options.dataDir);
}

export async function getDashboard(id: string, options: EngineOptions = {}) {
  return readDashboard(id, options.dataDir);
}

async function requireDashboard(
  id: string,
  options: EngineOptions,
): Promise<DashboardManifest> {
  const dashboard = await readDashboard(id, options.dataDir);
  if (!dashboard) throw new Error(`Unknown dashboard: ${id}`);
  return dashboard;
}

export async function saveDashboard(
  manifest: DashboardManifest,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const validation = await validateDashboard(manifest, options.frameworkRoot);
  if (!validation.valid) {
    throw new Error(`Invalid dashboard:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`);
  }

  for (const card of manifest.cards) {
    if (!(await getCard(card.card, options.frameworkRoot))) {
      throw new Error(`Dashboard references unknown card: ${card.card}`);
    }
  }

  return writeDashboard(manifest, options.dataDir);
}

export async function createDashboard(
  input: {
    id: string;
    name: string;
    profile: DeviceProfileId;
    theme?: string;
    generatedBy?: string;
  },
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  if (await readDashboard(input.id, options.dataDir)) {
    throw new Error(`Dashboard already exists: ${input.id}`);
  }

  return saveDashboard(
    {
      schemaVersion: "1",
      id: input.id,
      name: input.name,
      target: targetFor(input.profile),
      theme: input.theme ?? "glass-dark",
      generatedBy: input.generatedBy,
      cards: [],
    },
    options,
  );
}

export async function removeDashboard(
  id: string,
  options: EngineOptions = {},
): Promise<boolean> {
  return deleteStoredDashboard(id, options.dataDir);
}

export async function addCard(
  dashboardId: string,
  card: DashboardCard,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const dashboard = await requireDashboard(dashboardId, options);
  if (dashboard.cards.some((existing) => existing.instanceId === card.instanceId)) {
    throw new Error(`Card instance already exists: ${card.instanceId}`);
  }
  if (!(await getCard(card.card, options.frameworkRoot))) {
    throw new Error(`Unknown card type: ${card.card}`);
  }

  const columns = dashboard.target.columns ?? 12;
  return saveDashboard(
    {
      ...dashboard,
      cards: autoLayout([...dashboard.cards, card], columns),
    },
    options,
  );
}

export async function updateCard(
  dashboardId: string,
  instanceId: string,
  patch: Partial<Omit<DashboardCard, "instanceId">>,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const dashboard = await requireDashboard(dashboardId, options);
  let found = false;
  const cards = dashboard.cards.map((card) => {
    if (card.instanceId !== instanceId) return card;
    found = true;
    return { ...card, ...patch, instanceId };
  });

  if (!found) throw new Error(`Unknown card instance: ${instanceId}`);
  return saveDashboard({ ...dashboard, cards }, options);
}

export async function removeCard(
  dashboardId: string,
  instanceId: string,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const dashboard = await requireDashboard(dashboardId, options);
  const cards = dashboard.cards.filter((card) => card.instanceId !== instanceId);
  if (cards.length === dashboard.cards.length) {
    throw new Error(`Unknown card instance: ${instanceId}`);
  }

  return saveDashboard(
    {
      ...dashboard,
      cards: autoLayout(cards, dashboard.target.columns ?? 12),
    },
    options,
  );
}

export async function setBinding(
  dashboardId: string,
  instanceId: string,
  capability: string,
  entity: EntityBinding,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const dashboard = await requireDashboard(dashboardId, options);
  const card = dashboard.cards.find((candidate) => candidate.instanceId === instanceId);
  if (!card) throw new Error(`Unknown card instance: ${instanceId}`);

  return updateCard(
    dashboardId,
    instanceId,
    { bindings: { ...card.bindings, [capability]: entity } },
    options,
  );
}

export async function setCardLayout(
  dashboardId: string,
  instanceId: string,
  layout: CardLayout,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  return updateCard(dashboardId, instanceId, { layout }, options);
}

export async function reflowDashboard(
  dashboardId: string,
  options: EngineOptions = {},
): Promise<DashboardManifest> {
  const dashboard = await requireDashboard(dashboardId, options);
  return saveDashboard(
    {
      ...dashboard,
      cards: autoLayout(dashboard.cards, dashboard.target.columns ?? 12),
    },
    options,
  );
}

export async function planAndSaveDashboards(
  request: PlanRequest,
  options: EngineOptions = {},
): Promise<DashboardManifest[]> {
  const planned = planDashboards(request);
  const saved: DashboardManifest[] = [];

  for (const dashboard of planned) {
    saved.push(await saveDashboard(dashboard, options));
  }

  return saved;
}

export function installationInfo(options: EngineOptions = {}) {
  return {
    dataDir: dataDir(options.dataDir),
    frameworkRoot: options.frameworkRoot ?? process.env.HOMEFRAME_ROOT ?? process.cwd(),
    model: "framework code is separate from installation dashboards",
  };
}
