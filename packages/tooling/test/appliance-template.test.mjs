import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { getTemplate, homeSnapshotFromSemanticHome, instantiateTemplate, planDashboards, validateDashboard } from "../dist/index.js";

const frameworkRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const exampleHome = JSON.parse(await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"));
const templates = await Promise.all(["home-tablet", "home-desktop"].map((id) => getTemplate(id, frameworkRoot)));

function withoutAppliances(home) {
  const { appliances: _appliances, ...rest } = home;
  return rest;
}

function withoutStandIns(dashboard) {
  return { ...dashboard, cards: dashboard.cards.map(({ standIns: _standIns, ...card }) => card) };
}

for (const template of templates) {
  test(`${template.id}: appliances ride on the agenda slot as stand-ins and validate`, async () => {
    const dashboard = instantiateTemplate(template, exampleHome, { locale: "da" });
    assert.deepEqual(await validateDashboard(dashboard, frameworkRoot), { valid: true, errors: [] });

    const hosts = dashboard.cards.filter((card) => card.standIns);
    assert.deepEqual(hosts.map((card) => card.instanceId), ["agenda"]);
    assert.deepEqual(
      hosts[0].standIns.map((standIn) => [standIn.instanceId, standIn.card, standIn.props.kind, standIn.bindings.status]),
      [
        ["appliance-1", "appliance", "washer", "sensor.washing_machine_current_status"],
        ["appliance-2", "appliance", "dishwasher", "sensor.dishwasher_operation_state"],
      ],
    );
    assert.equal(hosts[0].standIns[0].bindings.remaining, "sensor.washing_machine_remaining_time");
    assert.equal(hosts[0].standIns[1].bindings.program, "select.dishwasher_active_program");
  });

  test(`${template.id}: a home without appliances gets exactly the layout it had`, () => {
    const plain = instantiateTemplate(template, withoutAppliances(exampleHome), { locale: "da" });
    const withAppliances = instantiateTemplate(template, exampleHome, { locale: "da" });
    assert.equal(plain.cards.some((card) => card.standIns), false);
    assert.equal(JSON.stringify(withoutStandIns(withAppliances)), JSON.stringify(plain), "stand-ins never move a card");
  });

  test(`${template.id}: with the vacuum in the slot (no calendar) the appliance borrows the vacuum's place`, () => {
    const home = {
      areas: [],
      capabilities: { vacuum: ["vacuum.robot"] },
      appliances: [{ id: "w", kind: "washer", name: "Vaskemaskine", entities: { status: "sensor.vaskemaskine_status" } }],
    };
    const vacuum = instantiateTemplate(template, home).cards.find((card) => card.instanceId === "vacuum");
    assert.deepEqual(vacuum.standIns, [
      { instanceId: "appliance-1", card: "appliance", bindings: { status: "sensor.vaskemaskine_status" }, props: { kind: "washer", name: "Vaskemaskine" } },
    ]);
  });
}

test("a live semantic home carries its appliances into the snapshot, and only when there are some", () => {
  const appliance = {
    id: "dev1",
    kind: "dryer",
    name: "Tørretumbler",
    areaId: "bryggers",
    source: "status",
    entities: { status: "sensor.dryer_status", remaining: "sensor.dryer_remaining" },
  };
  const status = { kind: "dryer", entityId: "sensor.dryer_status", label: "Status", domain: "sensor", score: 80 };
  const home = homeSnapshotFromSemanticHome({ areas: [], unassigned: [status], appliances: [appliance] });
  assert.deepEqual(home.appliances, [
    { id: "dev1", kind: "dryer", name: "Tørretumbler", areaId: "bryggers", entities: { status: "sensor.dryer_status", remaining: "sensor.dryer_remaining" } },
  ]);
  assert.deepEqual(home.capabilities.dryer, ["sensor.dryer_status"]);
  assert.equal("appliances" in homeSnapshotFromSemanticHome({ areas: [], unassigned: [] }), false);
});

test("the planner gives every appliance its own card with role bindings", async () => {
  const [dashboard] = planDashboards({ home: exampleHome, targets: ["tablet-10"] });
  const appliances = dashboard.cards.filter((card) => card.card === "appliance");
  assert.deepEqual(
    appliances.map((card) => [card.instanceId, card.props.kind, card.bindings.status]),
    [
      ["appliance-washing-machine", "washer", "sensor.washing_machine_current_status"],
      ["appliance-dishwasher", "dishwasher", "sensor.dishwasher_operation_state"],
    ],
  );
  assert.equal((await validateDashboard(dashboard, frameworkRoot)).valid, true);
});
