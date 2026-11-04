import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { getTemplate, instantiateTemplate, targetFor, validateDashboard } from "../dist/index.js";

const frameworkRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const exampleHome = JSON.parse(await readFile(path.join(frameworkRoot, "examples", "home-snapshot.json"), "utf8"));
const template = await getTemplate("home-desktop", frameworkRoot);

const COLUMNS = 16;
const ROWS = 13;

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Cards inside the 16×13 screen, never on top of each other. Returns the empty cells. */
function assertFits(dashboard) {
  const { cards } = dashboard;
  for (const card of cards) {
    const { x, y, w, h } = card.layout;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0, card.instanceId);
    assert.ok(x + w <= COLUMNS, `${card.instanceId} is wider than the grid`);
    assert.ok(y + h <= ROWS, `${card.instanceId} would scroll`);
  }
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      assert.ok(!overlaps(cards[i].layout, cards[j].layout), `${cards[i].instanceId} overlaps ${cards[j].instanceId}`);
    }
  }
  let empty = 0;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLUMNS; x += 1) {
      if (!cards.some(({ layout }) => overlaps(layout, { x, y, w: 1, h: 1 }))) empty += 1;
    }
  }
  return empty;
}

const byId = (dashboard) => Object.fromEntries(dashboard.cards.map((card) => [card.instanceId, card]));

const room = (id, capabilities) => ({ id, name: id[0].toUpperCase() + id.slice(1), capabilities });

/** A home like the one the template was designed on: solar, three cameras, many rooms. */
const solarHome = {
  name: "Sun House",
  areas: [
    room("office", { light: ["light.office"] }),
    room("kid", { temperature: ["sensor.kid_t"], humidity: ["sensor.kid_h"], light: ["light.kid"], climate: ["climate.kid"] }),
    room("hall", { temperature: ["sensor.hall_t"], light: ["light.hall"] }),
    room("porch", { temperature: ["sensor.porch_t"], light: ["light.porch"] }),
    room("kitchen", { light: ["light.kitchen"] }),
    room("living", { light: ["light.living"] }),
    room("terrace", { light: ["light.terrace"] }),
    room("stairs", { light: ["light.stairs"] }),
    room("bath", { light: ["light.bath"] }),
    room("garden", { light: ["light.garden"] }),
  ],
  capabilities: {
    sun: ["sun.sun"],
    weather: ["weather.home"],
    lock: ["lock.front"],
    alarm: ["alarm_control_panel.house"],
    climate: ["climate.kid"],
    vacuum: ["vacuum.robot"],
    person: ["person.anna", "person.ben"],
    solar_power: ["sensor.pv_total"],
    grid_power: ["sensor.grid"],
    power: ["sensor.house_load"],
    energy: ["sensor.house_today"],
    camera: ["camera.door", "camera.drive", "camera.garden"],
  },
};

test("the desktop profile is a 27-inch 16:9 monitor on sixteen columns", () => {
  assert.deepEqual(targetFor("desktop"), {
    profile: "desktop",
    width: 2560,
    height: 1440,
    orientation: "landscape",
    columns: 16,
  });
  assert.equal(template.profile, "desktop");
  assert.equal(template.rows, ROWS);
});

test("home-desktop fills in from the example snapshot, validates and fills the screen", async () => {
  const dashboard = instantiateTemplate(template, exampleHome, { locale: "da" });
  const cards = byId(dashboard);

  assert.equal(dashboard.id, "demo-home-home-desktop");
  assert.equal(dashboard.target.profile, "desktop");
  assert.equal(dashboard.generatedBy, "homeframe-template:home-desktop");
  assert.deepEqual(dashboard.navigation, { style: "side", people: ["person.anna", "person.ben"] });
  assert.deepEqual(await validateDashboard(dashboard, frameworkRoot), { valid: true, errors: [] });

  assert.equal(assertFits(dashboard), 0, "no empty cells");
  assert.equal(cards["home-scene"].layout.x, 0);
  assert.deepEqual(cards["climate-overview"].bindings.climate, ["climate.living_room", "climate.kitchen"]);
  assert.deepEqual(cards.agenda.bindings.calendar, ["calendar.family"]);
  assert.ok(cards.presence && cards["lock-status"] && cards.forecast);
  // Two cameras and three rooms cannot fill two rows evenly; one row of
  // two 16:9 cameras and two rooms does, and the top band grows instead.
  const tiles = dashboard.cards.filter((card) => card.card === "camera" || card.card === "room");
  assert.deepEqual(tiles.map((card) => card.instanceId), ["camera-1", "camera-2", "room-living-room", "room-kitchen"]);
  assert.ok(tiles.every((card) => card.layout.y === 10 && card.layout.h === 3));
  assert.deepEqual(cards["camera-1"].layout, { x: 0, y: 10, w: 4, h: 3 });
});

test("solar or a grid meter puts the energy flow at the top right, the vacuum below it", async () => {
  const dashboard = instantiateTemplate(template, solarHome, { locale: "da" });
  const cards = byId(dashboard);

  assert.equal(assertFits(dashboard), 0, "no empty cells");
  assert.deepEqual(cards["energy-flow"].layout, { x: 12, y: 0, w: 4, h: 5 });
  assert.deepEqual(cards["energy-flow"].bindings, {
    solar_power: "sensor.pv_total",
    grid_power: "sensor.grid",
    power: "sensor.house_load",
    energy: "sensor.house_today",
  });
  assert.deepEqual(cards.vacuum.layout, { x: 12, y: 5, w: 4, h: 2 }, "no calendar: the agenda slot shows the vacuum");
  assert.deepEqual(cards["home-scene"].layout, { x: 0, y: 0, w: 8, h: 7 });
  assert.deepEqual(
    ["lock-status", "forecast", "climate-overview", "presence"].map((id) => cards[id].layout),
    [
      { x: 8, y: 0, w: 4, h: 1 },
      { x: 8, y: 1, w: 4, h: 2 },
      { x: 8, y: 3, w: 4, h: 2 },
      { x: 8, y: 5, w: 4, h: 2 },
    ],
  );

  // Two rows of tiles: every camera at 16:9 (four columns, three rows), then
  // rooms, thermometer rooms first, widened to close the rows.
  const cameras = dashboard.cards.filter((card) => card.card === "camera");
  assert.deepEqual(cameras.map((card) => card.bindings.camera), ["camera.door", "camera.drive", "camera.garden"]);
  assert.ok(cameras.every((card) => card.layout.w === 4 && card.layout.h === 3 && card.layout.y === 7));
  const rooms = dashboard.cards.filter((card) => card.card === "room");
  assert.deepEqual(rooms.slice(0, 3).map((card) => card.areaId), ["kid", "hall", "porch"]);
  assert.ok(rooms.length >= 5 && rooms.length <= 8);
  assert.ok(rooms.every((card) => card.layout.w >= 3 && card.layout.w <= 6));
  assert.deepEqual((await validateDashboard(dashboard, frameworkRoot)).errors, []);
});

test("without solar or a grid meter the agenda column grows instead of leaving a hole", () => {
  const { solar_power: _s, grid_power: _g, ...rest } = solarHome.capabilities;
  const dashboard = instantiateTemplate(template, { ...solarHome, capabilities: rest });
  const cards = byId(dashboard);

  assert.equal(cards["energy-flow"], undefined);
  assert.deepEqual(cards.vacuum.layout, { x: 12, y: 0, w: 4, h: 7 });
  assert.equal(assertFits(dashboard), 0);
});

test("at most four cameras, each its own 16:9 tile", () => {
  const cameras = ["camera.a", "camera.b", "camera.c", "camera.d", "camera.e"];
  const dashboard = instantiateTemplate(template, { ...solarHome, capabilities: { ...solarHome.capabilities, camera: cameras } });
  const tiles = dashboard.cards.filter((card) => card.card === "camera");

  assert.deepEqual(tiles.map((card) => card.bindings.camera), cameras.slice(0, 4));
  assert.deepEqual(tiles.map((card) => card.layout), [0, 4, 8, 12].map((x) => ({ x, y: 7, w: 4, h: 3 })));
  assertFits(dashboard);
});

test("rooms with a temperature reading are preferred and capped at eight", () => {
  const areas = Array.from({ length: 12 }, (_, index) =>
    room(`area${index}`, index % 3 === 0 ? { temperature: [`sensor.t${index}`] } : { light: [`light.l${index}`] }),
  );
  const dashboard = instantiateTemplate(template, { areas, capabilities: { weather: ["weather.home"] } });
  const rooms = dashboard.cards.filter((card) => card.card === "room");

  assert.equal(rooms.length, 8);
  assert.deepEqual(rooms.slice(0, 4).map((card) => card.areaId), ["area0", "area3", "area6", "area9"]);
  assertFits(dashboard);
});

test("a bare home keeps the hero, an agenda empty state and its room, without overlaps", async () => {
  const bare = { name: "Flat", areas: [room("lounge", { light: ["light.lounge"] })] };
  const dashboard = instantiateTemplate(template, bare);

  assert.deepEqual(dashboard.cards.map((card) => card.instanceId), ["home-scene", "agenda", "room-lounge"]);
  assert.deepEqual(byId(dashboard).agenda.bindings, {}, "agenda renders its own empty state");
  assert.deepEqual(byId(dashboard)["home-scene"].layout, { x: 0, y: 0, w: 8, h: 10 }, "the hero takes the rows the tiles leave");
  assert.deepEqual(dashboard.navigation, { style: "side" });
  assertFits(dashboard);
  assert.equal((await validateDashboard(dashboard, frameworkRoot)).valid, true);
});

test("without cameras or rooms the hero fills the screen height", () => {
  const dashboard = instantiateTemplate(template, { areas: [], capabilities: { weather: ["weather.home"], person: ["person.anna"] } });
  const cards = byId(dashboard);
  assert.deepEqual(cards["home-scene"].layout, { x: 0, y: 0, w: 8, h: 13 });
  assert.deepEqual(cards.agenda.layout, { x: 12, y: 0, w: 4, h: 13 });
  assertFits(dashboard);
});
