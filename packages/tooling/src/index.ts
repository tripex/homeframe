import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

export type CardCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  aiSummary: string;
  sizes: string[];
  capabilities: Array<{ kind: string; required?: boolean; multiple?: boolean }>;
  actions: Array<{ id: string; description: string; risk: string }>;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function repoPath(root: string, ...parts: string[]): string {
  return path.resolve(root, ...parts);
}

export async function listCards(root = process.cwd()): Promise<CardCatalogEntry[]> {
  const catalogDir = repoPath(root, "catalog", "cards");
  const files = (await readdir(catalogDir)).filter((file) => file.endsWith(".json"));

  const cards = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(catalogDir, file), "utf8");
      return JSON.parse(raw) as CardCatalogEntry;
    }),
  );

  return cards.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getCard(
  id: string,
  root = process.cwd(),
): Promise<CardCatalogEntry | undefined> {
  const cards = await listCards(root);
  return cards.find((card) => card.id === id);
}

export async function validateDashboardFile(
  filePath: string,
  root = process.cwd(),
): Promise<ValidationResult> {
  const [schemaRaw, dashboardRaw] = await Promise.all([
    readFile(repoPath(root, "schemas", "dashboard-manifest.schema.json"), "utf8"),
    readFile(path.resolve(filePath), "utf8"),
  ]);

  const schema = JSON.parse(schemaRaw);
  const dashboard = JSON.parse(dashboardRaw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(dashboard);

  return {
    valid: Boolean(valid),
    errors: (validate.errors ?? []).map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    ),
  };
}

export async function doctor(root = process.cwd()): Promise<{
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  for (const [name, relativePath] of [
    ["Card catalog", "catalog/cards"],
    ["Dashboard schema", "schemas/dashboard-manifest.schema.json"],
    ["Agent entrypoint", "AGENTS.md"],
    ["Agent metadata", "homeframe.agent.json"],
  ] as const) {
    try {
      const target = repoPath(root, relativePath);
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
    architecture: "Home Assistant → semantic discovery → manifests → cards",
    preferredMutation: "dashboard manifest or bindings before framework code",
    agentEntrypoint: "AGENTS.md",
    cardCatalog: "catalog/cards",
    dashboardSchema: "schemas/dashboard-manifest.schema.json",
  };
}
