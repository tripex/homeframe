// The autumn DST change repeats an hour. Pin a zone that has one so this runs
// the same everywhere; node --test gives each file its own process.
process.env.TZ = "Europe/Copenhagen";

import { test } from "node:test";
import assert from "node:assert/strict";

const { summarizeEnergy } = await import("../dist/index.js");

test("both occurrences of the repeated 02:00 hour keep their own consumption", () => {
  // 2026-10-25: 02:00 CEST is 00:00Z, the repeated 02:00 CET is 01:00Z.
  const first = Date.UTC(2026, 9, 25, 0);
  const second = Date.UTC(2026, 9, 25, 1);
  const summary = summarizeEnergy({
    now: new Date(Date.UTC(2026, 9, 25, 12)),
    source: "change",
    hourly: [
      { start: first, change: 1, mean: null },
      { start: second, change: 2, mean: null },
    ],
  });

  assert.equal(summary.hours.length, 25);
  assert.equal(summary.todayKwh, 3);
  assert.equal(summary.hours.find((hour) => hour.start === first)?.kwh, 1);
  assert.equal(summary.hours.find((hour) => hour.start === second)?.kwh, 2);
});
