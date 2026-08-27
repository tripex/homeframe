import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type CardCatalogEntry = {
  id: string;
  version?: string;
  displayName: string;
  description: string;
  aiSummary: string;
  sizes: string[];
  capabilities: Array<{ kind: string; required?: boolean; multiple?: boolean }>;
  actions: Array<{ id: string; description: string; risk: string }>;
};

export function frameworkRoot(explicitRoot?: string): string {
  return path.resolve(explicitRoot ?? process.env.HOMEFRAME_ROOT ?? process.cwd());
}

export async function listCards(root?: string): Promise<CardCatalogEntry[]> {
  const catalogDir = path.join(frameworkRoot(root), "catalog", "cards");
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
  root?: string,
): Promise<CardCatalogEntry | undefined> {
  const cards = await listCards(root);
  return cards.find((card) => card.id === id);
}
