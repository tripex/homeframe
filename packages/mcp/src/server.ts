#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  addCard,
  createDashboard,
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
  validateDashboard,
} from "@homeframe/tooling";

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const profile = z.enum(["tablet-10", "nest-hub", "mobile", "desktop", "custom"]);
const capabilityMap = z.record(z.string(), z.array(z.string()));
const homeSnapshot = z.object({
  name: z.string().optional(),
  areas: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      capabilities: capabilityMap,
    }),
  ),
  capabilities: capabilityMap.optional(),
});
const entityBinding = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const layout = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
const dashboardCard = z.object({
  instanceId: z.string().min(1),
  card: z.string().min(1),
  areaId: z.string().optional(),
  size: z.enum(["sm", "md", "lg", "wide"]).optional(),
  bindings: z.record(z.string(), entityBinding).optional(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  layout: layout.optional(),
});

serveStdio(() => {
  const server = new McpServer({ name: "homeframe", version: "0.2.0" });

  server.registerTool(
    "project_info",
    {
      description:
        "Describe Homeframe's public model. Use this to understand the product; normal dashboard tasks should use operations rather than edit framework source.",
      inputSchema: z.object({}),
    },
    async () => text(projectInfo()),
  );

  server.registerTool(
    "installation_info",
    {
      description: "Show where this Homeframe installation stores user dashboard manifests.",
      inputSchema: z.object({}),
    },
    async () => text(installationInfo()),
  );

  server.registerTool(
    "list_cards",
    {
      description:
        "List reusable Homeframe card types, their semantic capability requirements and action risk levels.",
      inputSchema: z.object({}),
    },
    async () => text(await listCards()),
  );

  server.registerTool(
    "get_card",
    {
      description: "Read one reusable card contract before adding it to a dashboard.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => text((await getCard(id)) ?? { error: `Unknown card: ${id}` }),
  );

  server.registerTool(
    "validate_dashboard",
    {
      description: "Validate a candidate dashboard manifest without saving it.",
      inputSchema: z.object({ manifest: z.unknown() }),
    },
    async ({ manifest }) => text(await validateDashboard(manifest)),
  );

  server.registerTool(
    "list_dashboards",
    {
      description: "List dashboards in the current Homeframe installation.",
      inputSchema: z.object({}),
    },
    async () => text(await listDashboards()),
  );

  server.registerTool(
    "get_dashboard",
    {
      description: "Read a saved dashboard manifest by id.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => text((await getDashboard(id)) ?? { error: `Unknown dashboard: ${id}` }),
  );

  server.registerTool(
    "plan_dashboards",
    {
      description:
        "Plan one or more dashboards from a semantic home snapshot without saving. Build the snapshot from Home Assistant MCP first.",
      inputSchema: z.object({
        home: homeSnapshot,
        targets: z.array(profile).min(1),
        namePrefix: z.string().optional(),
      }),
    },
    async ({ home, targets, namePrefix }) =>
      text(planDashboards({ home, targets, namePrefix })),
  );

  server.registerTool(
    "create_planned_dashboards",
    {
      description:
        "Create and persist one or more device-specific dashboards from a semantic home snapshot. Use after reviewing plan_dashboards.",
      inputSchema: z.object({
        home: homeSnapshot,
        targets: z.array(profile).min(1),
        namePrefix: z.string().optional(),
      }),
    },
    async ({ home, targets, namePrefix }) =>
      text(await planAndSaveDashboards({ home, targets, namePrefix })),
  );

  server.registerTool(
    "create_dashboard",
    {
      description: "Create an empty dashboard for one device profile.",
      inputSchema: z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        name: z.string().min(1),
        profile,
        theme: z.string().optional(),
      }),
    },
    async ({ id, name, profile: targetProfile, theme }) =>
      text(
        await createDashboard({
          id,
          name,
          profile: targetProfile,
          theme,
          generatedBy: "homeframe-mcp",
        }),
      ),
  );

  server.registerTool(
    "save_dashboard",
    {
      description:
        "Validate and persist a complete DashboardManifest. Prefer smaller operations for routine changes.",
      inputSchema: z.object({ manifest: z.unknown() }),
    },
    async ({ manifest }) =>
      text(await saveDashboard(manifest as Parameters<typeof saveDashboard>[0])),
  );

  server.registerTool(
    "add_card",
    {
      description:
        "Add a reusable card instance to a saved dashboard and automatically reflow the grid.",
      inputSchema: z.object({ dashboardId: z.string().min(1), card: dashboardCard }),
    },
    async ({ dashboardId, card }) =>
      text(await addCard(dashboardId, card as Parameters<typeof addCard>[1])),
  );

  server.registerTool(
    "remove_card",
    {
      description: "Remove a card instance from a dashboard and reflow the remaining grid.",
      inputSchema: z.object({
        dashboardId: z.string().min(1),
        instanceId: z.string().min(1),
      }),
    },
    async ({ dashboardId, instanceId }) => text(await removeCard(dashboardId, instanceId)),
  );

  server.registerTool(
    "set_binding",
    {
      description:
        "Bind a semantic capability on a card to one or more concrete Home Assistant entity ids. Entity ids belong here, not in reusable framework code.",
      inputSchema: z.object({
        dashboardId: z.string().min(1),
        instanceId: z.string().min(1),
        capability: z.string().min(1),
        entity: entityBinding,
      }),
    },
    async ({ dashboardId, instanceId, capability, entity }) =>
      text(await setBinding(dashboardId, instanceId, capability, entity)),
  );

  server.registerTool(
    "set_card_layout",
    {
      description: "Move or resize one card on its dashboard grid.",
      inputSchema: z.object({
        dashboardId: z.string().min(1),
        instanceId: z.string().min(1),
        layout,
      }),
    },
    async ({ dashboardId, instanceId, layout: cardLayout }) =>
      text(await setCardLayout(dashboardId, instanceId, cardLayout)),
  );

  server.registerTool(
    "reflow_dashboard",
    {
      description: "Recalculate a clean non-overlapping grid for all cards in a dashboard.",
      inputSchema: z.object({ dashboardId: z.string().min(1) }),
    },
    async ({ dashboardId }) => text(await reflowDashboard(dashboardId)),
  );

  server.registerTool(
    "delete_dashboard",
    {
      description: "Delete a saved Homeframe dashboard manifest. This does not change Home Assistant.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => text({ id, deleted: await removeDashboard(id) }),
  );

  return server;
});
