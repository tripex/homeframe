import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { frameworkRoot } from "./catalog.js";

export * from "./catalog.js";
export * from "./operations.js";
export * from "./planner.js";
export * from "./validation.js";
export * from "./home-snapshot.js";

export async function doctor(root?: string): Promise<{
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}> {
  const base = frameworkRoot(root);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  for (const [name, relativePath] of [
    ["Card catalog", "catalog/cards"],
    ["Dashboard schema", "schemas/dashboard-manifest.schema.json"],
    ["Agent entrypoint", "AGENTS.md"],
    ["Agent metadata", "homeframe.agent.json"],
  ] as const) {
    try {
      const target = path.join(base, relativePath);
      if (relativePath.endsWith(".json") || relativePath.endsWith(".md")) {
        await readFile(target, "utf8");
      } else {
        await readdir(target);
      }
      checks.push({ name, ok: true, detail: relativePath });
    } catch {
      checks.push({ name, ok: false, detail: `Missing ${relativePath}` });
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}

export function projectInfo() {
  return {
    name: "Homeframe",
    architecture: "Home Assistant → semantic capabilities → manifests → reusable cards",
    installationModel: "framework code and user dashboard data are separate",
    preferredMutation: "Homeframe operations on dashboard manifests, not source-code edits",
    agentEntrypoint: "AGENTS.md",
    cardCatalog: "catalog/cards",
    dashboardSchema: "schemas/dashboard-manifest.schema.json",
    deviceProfiles: ["tablet-10", "nest-hub", "mobile", "desktop", "custom"],
  };
}
export * from "./actions.js";
