import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { getTemplate, instantiateTemplate, validateDashboard } from "../dist/index.js";

const frameworkRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const exampleHome = JSON.parse(await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"));
const template = await getTemplate("home-tablet", frameworkRoot);

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("home-tablet fills in from the example snapshot and validates", async () => {
  const dashboard = instantiateTemplate(template, exampleHome, { locale: "da" });

  assert.equal(dashboard.id, "demo-home-home-tablet");
  assert.equal(dashboard.target.profile, "tablet-10");
  assert.equal(dashboard.locale, "da");
  assert.deepEqual(dashboard.navigation, { style: "side", people: ["person.anna", "person.ben"] });
  assert.deepEqual(await validateDashboard(dashboard, frameworkRoot), { valid: true, errors: [] });

  const byId = Object.fromEntries(dashboard.cards.map((card) => [card.instanceId, card]));
  assert.deepEqual(byId["home-scene"].layout, { x: 0, y: 0, w: 8, h: 7 });
  assert.deepEqual(byId["home-scene"].bindings.lock, ["lock.front_door"]);
  assert.equal(byId["home-scene"].bindings.sun, "sun.sun");
  assert.equal(byId["forecast"].bindings.weather, "weather.home");
  assert.deepEqual(byId["agenda"].bindings.calendar, ["calendar.family"]);
  assert.equal(byId["camera-1"].bindings.camera, "camera.front_door");
  assert.equal(byId["camera-2"].bindings.camera, "camera.driveway");
  assert.equal(byId["room-living-room"].props.name, "Living room");
});

test("home-tablet cards never overlap and stay inside the 12-column grid", () => {
  const { cards } = instantiateTemplate(template, exampleHome);
  for (const card of cards) assert.ok(card.layout.x + card.layout.w <= 12, card.instanceId);
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      assert.ok(!overlaps(cards[i].layout, cards[j].layout), `${cards[i].instanceId} overlaps ${cards[j].instanceId}`);
    }
  }
});

test("a bare home keeps the hero and an agenda empty state, and drops cards it cannot fill", async () => {
  const bare = { name: "Flat", areas: [{ id: "lounge", name: "Lounge", capabilities: { light: ["light.lounge"] } }] };
  const dashboard = instantiateTemplate(template, bare);
  const ids = dashboard.cards.map((card) => card.instanceId);

  assert.deepEqual(ids, ["home-scene", "agenda", "room-lounge"]);
  assert.deepEqual(dashboard.cards[1].bindings, {}, "agenda renders its own empty state");
  // The room row starts right below the tallest stacked region (the hero).
  assert.equal(dashboard.cards[2].layout.y, 7);
  assert.deepEqual(dashboard.navigation, { style: "side" });
  assert.equal((await validateDashboard(dashboard, frameworkRoot)).valid, true);
});

test("rooms with a temperature reading are preferred and capped at four", () => {
  const areas = Array.from({ length: 6 }, (_, index) => ({
    id: `area-${index}`,
    name: `Area ${index}`,
    capabilities: index % 2 ? { temperature: [`sensor.t${index}`] } : { light: [`light.l${index}`] },
  }));
  const rooms = instantiateTemplate(template, { areas }).cards.filter((card) => card.card === "room");

  assert.equal(rooms.length, 4);
  assert.deepEqual(rooms.map((card) => card.areaId), ["area-1", "area-3", "area-5", "area-0"]);
});

test("without calendars the agenda slot falls back to the vacuum, then people", () => {
  const withVacuum = instantiateTemplate(template, { areas: [], capabilities: { vacuum: ["vacuum.robot"], person: ["person.anna"] } });
  const vacuum = withVacuum.cards.find((card) => card.instanceId === "vacuum");
  assert.deepEqual(vacuum.bindings, { vacuum: "vacuum.robot" });
  assert.deepEqual(vacuum.layout, { x: 8, y: 0, w: 4, h: 5 }, "the fallback keeps the slot's height");

  const withPeople = instantiateTemplate(template, { areas: [], capabilities: { person: ["person.anna"] } });
  assert.ok(withPeople.cards.some((card) => card.card === "presence"));
});
