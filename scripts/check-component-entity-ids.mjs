#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const componentRoot = path.resolve("apps/dashboard/src/components");
const entityIdPattern = /\b(?:sensor|binary_sensor|light|climate|cover|lock|vacuum|switch|media_player)\.[a-z0-9_]+\b/g;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (/\.(vue|ts)$/.test(entry.name)) files.push(fullPath);
  }

  return files;
}

const violations = [];
for (const file of await walk(componentRoot)) {
  const source = await readFile(file, "utf8");
  const matches = source.match(entityIdPattern) ?? [];
  for (const match of matches) violations.push({ file, match });
}

if (violations.length) {
  console.error("Reusable components contain raw Home Assistant entity IDs:");
  for (const violation of violations) {
    console.error(`- ${path.relative(process.cwd(), violation.file)}: ${violation.match}`);
  }
  process.exitCode = 1;
} else {
  console.log("✓ Reusable components contain no hardcoded Home Assistant entity IDs.");
}
