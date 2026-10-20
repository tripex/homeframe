/**
 * Pure energy-flow model used by the energy-flow card.
 *
 * Inputs are live power readings in watts with Homeframe's sign convention:
 *   - grid:    positive = importing from the grid, negative = exporting
 *   - battery: positive = discharging into the home, negative = charging
 * Cards translate installation-specific conventions (see the `invertGrid` /
 * `invertBattery` props) before calling this.
 *
 * Kept free of Vue and Home Assistant so it can be reasoned about and tested
 * on its own.
 */
export type EnergyReadings = {
  solarW?: number;
  gridW?: number;
  batteryW?: number;
  evW?: number;
  /** Whole-home consumption, when a dedicated sensor exists. Includes the EV. */
  homeW?: number;
};

export type EnergyFlows = {
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  homeToEv: number;
};

export type EnergyFlowModel = {
  flows: EnergyFlows;
  /** Total consumption behind the meter, EV included. */
  loadW: number;
  /** Consumption excluding the EV, shown on the home node. */
  homeOnlyW: number;
  gridImportW: number;
  gridExportW: number;
  /** Share of current consumption not drawn from the grid, 0–1. */
  selfSufficiency: number;
  /** Share of current solar production used on site, 0–1 (undefined without solar). */
  selfConsumption?: number;
};

const positive = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(value, 0) : 0;

export function computeEnergyFlow(readings: EnergyReadings): EnergyFlowModel {
  const solar = positive(readings.solarW);
  const grid = readings.gridW ?? 0;
  const battery = readings.batteryW ?? 0;

  const gridImport = positive(grid);
  const gridExport = positive(-grid);
  const batteryDischarge = positive(battery);
  const batteryCharge = positive(-battery);
  const ev = positive(readings.evW);

  // Prefer a measured whole-home sensor. Otherwise derive consumption from the
  // energy balance: what comes in from solar, grid and battery is consumed.
  const derivedLoad = solar + grid + battery;
  const loadW = readings.homeW !== undefined ? positive(readings.homeW) : positive(derivedLoad);

  // Solar serves the home first, then charges the battery, then exports.
  const solarToHome = Math.min(solar, loadW);
  const solarLeft = solar - solarToHome;
  const solarToBattery = Math.min(solarLeft, batteryCharge);
  const solarToGrid = Math.max(solarLeft - solarToBattery, 0);

  const gridToBattery = Math.max(batteryCharge - solarToBattery, 0);
  const gridToHome = Math.max(gridImport - gridToBattery, 0);
  const batteryToHome = Math.min(batteryDischarge, Math.max(loadW - solarToHome, 0));

  const selfSufficiency = loadW > 0 ? clamp01(1 - gridToHome / loadW) : 1;
  const selfConsumption = solar > 0 ? clamp01((solarToHome + solarToBattery) / solar) : undefined;

  return {
    flows: {
      solarToHome,
      solarToBattery,
      solarToGrid,
      gridToHome,
      gridToBattery,
      batteryToHome,
      homeToEv: Math.min(ev, loadW),
    },
    loadW,
    homeOnlyW: Math.max(loadW - ev, 0),
    gridImportW: gridImport,
    gridExportW: gridExport,
    selfSufficiency,
    selfConsumption,
  };
}

/**
 * Map watts to an animation speed multiplier on a log scale, so 50 W still
 * visibly moves and 10 kW does not turn into a blur.
 */
export function flowSpeed(watts: number, maxWatts: number): number {
  if (watts <= 0) return 0;
  const ratio = Math.log1p(watts) / Math.log1p(Math.max(maxWatts, 1000));
  return 0.35 + Math.min(ratio, 1) * 2.4;
}

export function formatPower(watts: number): { value: string; unit: string } {
  const abs = Math.abs(watts);
  if (abs >= 1000) return { value: (watts / 1000).toFixed(abs >= 10_000 ? 1 : 2), unit: "kW" };
  return { value: Math.round(watts).toString(), unit: "W" };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
