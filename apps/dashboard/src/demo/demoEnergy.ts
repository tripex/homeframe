import { summarizeEnergy, type PricePoint, type StatisticPoint } from "@homeframe/core";
import type { EnergyHistory } from "../composables/useEnergyHistory";

const HOUR = 60 * 60 * 1000;

/** Same shape of day as the fake Home Assistant: quiet nights, an evening peak. */
function demoKwh(hour: number): number {
  const morning = hour >= 6 && hour <= 8 ? 0.5 : 0;
  const evening = hour >= 17 && hour <= 21 ? 1.1 - Math.abs(hour - 19) * 0.25 : 0;
  return 0.3 + morning + evening + ((hour * 7) % 5) * 0.04;
}

function demoPrice(hour: number): number {
  const night = hour >= 1 && hour <= 5 ? -0.55 : 0;
  const peak = hour >= 17 && hour <= 20 ? 1.35 : 0;
  const morning = hour >= 7 && hour <= 9 ? 0.45 : 0;
  return 1.3 + night + peak + morning;
}

/**
 * A believable energy day for the reference view, computed with the same
 * summarizeEnergy the runtime uses so the demo never drifts from reality.
 */
export function demoEnergyHistory(now = new Date()): EnergyHistory {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 24 * HOUR;

  const hourly: StatisticPoint[] = [];
  for (let start = yesterday; start + HOUR <= now.getTime(); start += HOUR) {
    hourly.push({ start, change: demoKwh(new Date(start).getHours()) });
  }

  const prices: PricePoint[] = Array.from({ length: 24 }, (_, hour) => ({
    start: today + hour * HOUR,
    end: today + (hour + 1) * HOUR,
    price: demoPrice(hour),
  }));

  return {
    summary: summarizeEnergy({
      now,
      source: "change",
      hourly,
      monthly: [{ start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), change: now.getDate() * 11.4 }],
      prices: { points: prices },
    }),
    currency: "DKK",
  };
}
