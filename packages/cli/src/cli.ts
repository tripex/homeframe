#!/usr/bin/env node
import { doctor, getCard, listCards, projectInfo, validateDashboardFile } from "@homeframe/tooling";

function printHelp(): void {
  console.log(`Homeframe CLI\n\nUsage:\n  homeframe cards list\n  homeframe cards show <id>\n  homeframe dashboard validate <file>\n  homeframe doctor\n  homeframe agent-info\n`);
}

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  const [group, command, value] = args;

  if (!group || group === "help" || group === "--help" || group === "-h") {
    printHelp();
    return;
  }

  if (group === "cards" && command === "list") {
    const cards = await listCards();
    for (const card of cards) {
      console.log(`${card.id}\t${card.displayName}\t${card.aiSummary}`);
    }
    return;
  }

  if (group === "cards" && command === "show" && value) {
    const card = await getCard(value);
    if (!card) {
      console.error(`Unknown card: ${value}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  if (group === "dashboard" && command === "validate" && value) {
    const result = await validateDashboardFile(value);
    if (result.valid) {
      console.log("Dashboard manifest is valid.");
      return;
    }

    console.error("Dashboard manifest is invalid:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
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
    console.log(JSON.stringify(projectInfo(), null, 2));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
