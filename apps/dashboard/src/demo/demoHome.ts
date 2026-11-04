export const demoRooms = [
  {
    name: "Living room",
    temperature: 22.4,
    humidity: 47,
    lightsOn: 3,
    active: true,
  },
  {
    name: "Kitchen",
    temperature: 21.7,
    humidity: 44,
    lightsOn: 1,
    active: true,
  },
  {
    name: "Bedroom",
    temperature: 20.9,
    humidity: 49,
    lightsOn: 0,
    active: false,
  },
];

export const demoClimateZones = [
  { name: "Living room", current: 21.5, target: 22, heating: true },
  { name: "Kitchen", current: 21.8, target: 22, heating: true },
  { name: "Bathroom", current: 23.1, target: 23, heating: false },
];

/**
 * Reference energy readings for demo mode. Loops through a few minutes of a
 * sunny day: surplus solar being sold, an EV starting to charge, the battery
 * stepping in. Small noise keeps the flow speeds moving like real sensors.
 */
export function demoEnergyAt(timeMs: number) {
  const cycle = (timeMs / 1000) % 90; // seconds into the 90 s loop
  const noise = (seed: number) => Math.sin(timeMs / 1700 + seed) * 0.5 + Math.sin(timeMs / 610 + seed * 3) * 0.5;

  const solarW = 4200 + noise(1) * 380;
  const houseW = 1150 + noise(2) * 260;
  const evW = cycle > 30 && cycle < 70 ? 7200 + noise(3) * 120 : 0;

  // Battery charges from surplus, then discharges while the car charges.
  const surplus = solarW - houseW - evW;
  const batteryW = surplus > 0 ? -Math.min(surplus * 0.55, 2500) : Math.min(-surplus * 0.6, 3000);
  const gridW = houseW + evW - solarW - batteryW;

  return {
    solarW,
    gridW,
    batteryW,
    batteryPct: 64 + noise(4) * 3,
    evW,
    todayKwh: 9.8,
    price: evW ? 1.12 : 0.74,
    priceLevel: (evW ? "normal" : "low") as "normal" | "low",
  };
}
