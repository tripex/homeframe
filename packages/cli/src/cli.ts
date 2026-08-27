#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  addCard,
  createDashboard,
  doctor,
  getCard,
  getDashboard,
  installationInfo,
  listCards,
  listDashboards,
  planAndSaveDashboards,
  planDashboards,
  projectInfo,
  reflowDashboard,
  removeCard,
  removeDashboard,
  saveDashboard,
  setBinding,
  setCardLayout,
  validateDashboardFile,
  type HomeSnapshot,
} from "@homeframe/tooling";
import type { DashboardManifest, DeviceProfileId } from "@homeframe/sdk";

function printHelp(): void {
  console.log(`Homeframe CLI

Framework
  homeframe cards list
  homeframe cards show <id>
  homeframe doctor
  homeframe agent-info
  homeframe installation-info

Dashboards
  homeframe dashboard list
  homeframe dashboard show <id>
  homeframe dashboard validate <file>
  homeframe dashboard save <file>
  homeframe dashboard create <id> <name> <profile>
  homeframe dashboard delete <id>
  homeframe dashboard plan <home-snapshot.json> <profiles> [--save]
  homeframe dashboard reflow <id>

Cards and bindings
  homeframe card add <dashboard> <card> <instance-id> [area-id]
  homeframe card remove <dashboard> <instance-id>
  homeframe binding set <dashboard> <instance-id> <capability> <entity[,entity...]>
  homeframe layout set <dashboard> <instance-id> <x> <y> <w> <h>

Profiles
  tablet-10, nest-hub, mobile, desktop, custom
`);
}

function print(value: unknown): void {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  const [group, command, ...values] = args;

  if (!group || group === "help" || group === "--help" || group === "-h") {
    printHelp();
    return;
  }

  if (group === "cards" && command === "list") {
    for (const card of await listCards()) {
      console.log(`${card.id}\t${card.displayName}\t${card.aiSummary}`);
    }
    return;
  }

  if (group === "cards" && command === "show" && values[0]) {
    const card = await getCard(values[0]);
    if (!card) throw new Error(`Unknown card: ${values[0]}`);
    print(card);
    return;
  }

  if (group === "dashboard" && command === "list") {
    print(await listDashboards());
    return;
  }

  if (group === "dashboard" && command === "show" && values[0]) {
    const dashboard = await getDashboard(values[0]);
    if (!dashboard) throw new Error(`Unknown dashboard: ${values[0]}`);
    print(dashboard);
    return;
  }

  if (group === "dashboard" && command === "validate" && values[0]) {
    const result = await validateDashboardFile(values[0]);
    if (!result.valid) {
      print(result);
      process.exitCode = 1;
      return;
    }
    console.log("Dashboard manifest is valid.");
    return;
  }

  if (group === "dashboard" && command === "save" && values[0]) {
    print(await saveDashboard(await readJson<DashboardManifest>(values[0])));
    return;
  }

  if (group === "dashboard" && command === "create" && values.length >= 3) {
    const [id, name, profile] = values;
    print(
      await createDashboard({
        id,
        name,
        profile: profile as DeviceProfileId,
        generatedBy: "homeframe-cli",
      }),
    );
    return;
  }

  if (group === "dashboard" && command === "delete" && values[0]) {
    print({ deleted: await removeDashboard(values[0]), id: values[0] });
    return;
  }

  if (group === "dashboard" && command === "plan" && values.length >= 2) {
    const home = await readJson<HomeSnapshot>(values[0]);
    const targets = values[1].split(",") as DeviceProfileId[];
    const request = { home, targets };
    print(values.includes("--save") ? await planAndSaveDashboards(request) : planDashboards(request));
    return;
  }

  if (group === "dashboard" && command === "reflow" && values[0]) {
    print(await reflowDashboard(values[0]));
    return;
  }

  if (group === "card" && command === "add" && values.length >= 3) {
    const [dashboardId, card, instanceId, areaId] = values;
    print(await addCard(dashboardId, { instanceId, card, areaId }));
    return;
  }

  if (group === "card" && command === "remove" && values.length >= 2) {
    print(await removeCard(values[0], values[1]));
    return;
  }

  if (group === "binding" && command === "set" && values.length >= 4) {
    const [dashboardId, instanceId, capability, rawEntities] = values;
    const entities = rawEntities.split(",").filter(Boolean);
    print(
      await setBinding(
        dashboardId,
        instanceId,
        capability,
        entities.length === 1 ? entities[0] : entities,
      ),
    );
    return;
  }

  if (group === "layout" && command === "set" && values.length >= 6) {
    const [dashboardId, instanceId, x, y, w, h] = values;
    print(
      await setCardLayout(dashboardId, instanceId, {
        x: Number(x),
        y: Number(y),
        w: Number(w),
        h: Number(h),
      }),
    );
    return;
  }

  if (group === "doctor") {
    const result = await doctor();
    for (const check of result.checks) {
      console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (group === "agent-info") {
    print(projectInfo());
    return;
  }

  if (group === "installation-info") {
    print(installationInfo());
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
