/**
 * Sample data for the forecast, agenda and presence cards, so the reference
 * view and the hosted demo show them without Home Assistant. Dates are
 * relative to "now" so the demo never looks stale.
 */

function daysFromNow(days: number, hour = 12, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function localDate(days: number): string {
  const date = daysFromNow(days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function demoForecast() {
  const outlook = [
    ["partlycloudy", 9, 4],
    ["rainy", 8, 5],
    ["cloudy", 7, 3],
    ["sunny", 10, 2],
    ["windy", 9, 4],
  ] as const;
  return outlook.map(([condition, high, low], index) => ({
    date: daysFromNow(index).toISOString(),
    condition,
    high,
    low,
  }));
}

export function demoAgenda() {
  return [
    { summary: "Football practice", start: daysFromNow(0, 16, 30).toISOString(), end: daysFromNow(0, 17, 30).toISOString(), allDay: false },
    { summary: "Dentist", start: daysFromNow(1, 8, 15).toISOString(), end: daysFromNow(1, 9).toISOString(), allDay: false },
    { summary: "Bins: paper & plastic", start: localDate(2), end: localDate(3), allDay: true },
  ];
}

export const demoPeople = [
  { id: "anna", name: "Anna", home: true },
  { id: "ben", name: "Ben", home: false },
];
