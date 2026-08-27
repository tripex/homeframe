import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DashboardManifest } from "@homeframe/sdk";

export function dataDir(explicitDir?: string): string {
  return path.resolve(
    explicitDir ?? process.env.HOMEFRAME_DATA_DIR ?? path.join(os.homedir(), ".homeframe"),
  );
}

function dashboardsDir(explicitDir?: string): string {
  return path.join(dataDir(explicitDir), "dashboards");
}

function dashboardPath(id: string, explicitDir?: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid dashboard id: ${id}`);
  }

  return path.join(dashboardsDir(explicitDir), `${id}.json`);
}

export async function ensureDataDir(explicitDir?: string): Promise<string> {
  const dir = dashboardsDir(explicitDir);
  await mkdir(dir, { recursive: true });
  return dataDir(explicitDir);
}

export async function listDashboards(explicitDir?: string): Promise<DashboardManifest[]> {
  await ensureDataDir(explicitDir);
  const dir = dashboardsDir(explicitDir);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));

  const dashboards = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(dir, file), "utf8");
      return JSON.parse(raw) as DashboardManifest;
    }),
  );

  return dashboards.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readDashboard(
  id: string,
  explicitDir?: string,
): Promise<DashboardManifest | undefined> {
  try {
    const raw = await readFile(dashboardPath(id, explicitDir), "utf8");
    return JSON.parse(raw) as DashboardManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeDashboard(
  manifest: DashboardManifest,
  explicitDir?: string,
): Promise<DashboardManifest> {
  await ensureDataDir(explicitDir);
  const now = new Date().toISOString();
  const existing = await readDashboard(manifest.id, explicitDir);
  const saved: DashboardManifest = {
    ...manifest,
    createdAt: existing?.createdAt ?? manifest.createdAt ?? now,
    updatedAt: now,
  };

  await writeFile(
    dashboardPath(saved.id, explicitDir),
    `${JSON.stringify(saved, null, 2)}\n`,
    "utf8",
  );

  return saved;
}

export async function deleteDashboard(
  id: string,
  explicitDir?: string,
): Promise<boolean> {
  try {
    await rm(dashboardPath(id, explicitDir));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
