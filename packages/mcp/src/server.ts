#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  getCard,
  listCards,
  projectInfo,
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

serveStdio(() => {
  const server = new McpServer({
    name: "homeframe",
    version: "0.1.0",
  });

  server.registerTool(
    "project_info",
    {
      description:
        "Describe Homeframe's architecture, agent entrypoint and preferred mutation strategy.",
      inputSchema: z.object({}),
    },
    async () => text(projectInfo()),
  );

  server.registerTool(
    "list_cards",
    {
      description:
        "List reusable Homeframe cards with AI summaries, capability requirements and action risk levels.",
      inputSchema: z.object({}),
    },
    async () => text(await listCards()),
  );

  server.registerTool(
    "get_card",
    {
      description:
        "Read one Homeframe card manifest before deciding whether existing UI can satisfy a dashboard request.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Card ID from list_cards"),
      }),
    },
    async ({ id }) => {
      const card = await getCard(id);
      return card ? text(card) : text({ error: `Unknown card: ${id}` });
    },
  );

  server.registerTool(
    "validate_dashboard",
    {
      description:
        "Validate a candidate dashboard manifest against Homeframe's current schema before saving or proposing it.",
      inputSchema: z.object({
        manifest: z.unknown().describe("Candidate DashboardManifest JSON value"),
      }),
    },
    async ({ manifest }) => text(await validateDashboard(manifest)),
  );

  return server;
});
