#!/usr/bin/env node
/**
 * The dashboard bundle must never carry a Home Assistant credential.
 *
 * Builds the dashboard once more with a recognizable fake VITE_HA_TOKEN (the
 * variable a developer might have in .env for `npm run dev`) and fails if that
 * value, or any JWT-shaped string, appears anywhere in the output. Production
 * builds only reach Home Assistant through Homeframe Runtime.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const sentinel = "homeframe-bundle-canary-0f4e2c";
const outDir = await mkdtemp(path.join(os.tmpdir(), "homeframe-bundle-"));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? files(full) : [full];
    }),
  );
  return nested.flat();
}

try {
  const build = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/vite/bin/vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
    {
      cwd: path.join(root, "apps/dashboard"),
      env: { ...process.env, VITE_HA_TOKEN: sentinel, VITE_HA_URL: "http://homeassistant.local:8123" },
      encoding: "utf8",
    },
  );
  if (build.status !== 0) throw new Error(`vite build failed:\n${build.stderr}`);

  // A Home Assistant long-lived token is a JWT: three base64url parts, the
  // first always starting with eyJ.
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
  const problems = [];
  for (const file of await files(outDir)) {
    const content = await readFile(file, "utf8");
    if (content.includes(sentinel)) problems.push(`${path.relative(outDir, file)} contains VITE_HA_TOKEN`);
    if (jwt.test(content)) problems.push(`${path.relative(outDir, file)} contains a JWT-shaped string`);
    if (content.includes("SUPERVISOR_TOKEN")) problems.push(`${path.relative(outDir, file)} mentions SUPERVISOR_TOKEN`);
  }

  // Relative asset URLs are what lets the same bundle work under ingress.
  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  if (/(src|href)="\/assets\//.test(html)) problems.push("index.html uses absolute /assets/ URLs");

  if (problems.length) {
    console.error(problems.map((problem) => `- ${problem}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("✓ dashboard bundle contains no Home Assistant token and uses relative URLs");
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}
