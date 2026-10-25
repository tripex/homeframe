import type { HassState } from "./types.js";

/**
 * Where the sun is in its daily cycle, in the four steps a screen can show.
 * Dawn and dusk are civil twilight: the sun within 6° of the horizon.
 */
export type SkyPhase = "night" | "dawn" | "day" | "dusk";

/** Home Assistant's many weather conditions folded into what a scene can render. */
export type WeatherMood =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "rain"
  | "heavy-rain"
  | "storm"
  | "snow"
  | "sleet"
  | "hail"
  | "wind";

/**
 * Everything the ambient layer needs to paint the sky behind a dashboard.
 * Plain numbers and enums only, so the renderer never touches Home Assistant
 * attribute names.
 */
export type Atmosphere = {
  phase: SkyPhase;
  /** Degrees above the horizon, when a sun entity reports it. */
  sunElevation?: number;
  /**
   * 0 → 1 across the current arc: sunrise to sunset while the sun is up,
   * sunset to sunrise while it is down. Drives where the sun or moon sits.
   */
  arcProgress: number;
  /** 0 (dark night) → 1 (full daylight). */
  daylight: number;
  weather: WeatherMood;
  /** 0 → 1 precipitation intensity, used for particle density. */
  precipitation: number;
  /** 0 → 1 how much cloud haze to draw. */
  cloudCover: number;
  /** Outdoor temperature from the weather entity. */
  temperature?: number;
  temperatureUnit?: string;
  /** The untouched Home Assistant condition, e.g. "lightning-rainy". */
  condition?: string;
  /** Whether the sun position came from a real sun entity or the local clock. */
  source: "sun-entity" | "clock";
};

export type AtmosphereInput = {
  sun?: HassState;
  weather?: HassState;
  now: Date;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TWILIGHT_DEGREES = 6;

type WeatherShape = { weather: WeatherMood; precipitation: number; cloudCover: number };

const WEATHER_CONDITIONS: Record<string, WeatherShape> = {
  sunny: { weather: "clear", precipitation: 0, cloudCover: 0 },
  "clear-night": { weather: "clear", precipitation: 0, cloudCover: 0 },
  partlycloudy: { weather: "partly-cloudy", precipitation: 0, cloudCover: 0.4 },
  cloudy: { weather: "cloudy", precipitation: 0, cloudCover: 0.85 },
  exceptional: { weather: "cloudy", precipitation: 0, cloudCover: 0.85 },
  fog: { weather: "fog", precipitation: 0, cloudCover: 0.7 },
  rainy: { weather: "rain", precipitation: 0.5, cloudCover: 0.85 },
  pouring: { weather: "heavy-rain", precipitation: 1, cloudCover: 0.95 },
  lightning: { weather: "storm", precipitation: 0.15, cloudCover: 0.95 },
  "lightning-rainy": { weather: "storm", precipitation: 0.8, cloudCover: 1 },
  snowy: { weather: "snow", precipitation: 0.6, cloudCover: 0.8 },
  "snowy-rainy": { weather: "sleet", precipitation: 0.6, cloudCover: 0.85 },
  hail: { weather: "hail", precipitation: 0.7, cloudCover: 0.9 },
  windy: { weather: "wind", precipitation: 0, cloudCover: 0.3 },
  "windy-variant": { weather: "wind", precipitation: 0, cloudCover: 0.6 },
};

const CLEAR_SKY: WeatherShape = { weather: "clear", precipitation: 0, cloudCover: 0 };

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function phaseFromElevation(elevation: number, rising: boolean): SkyPhase {
  if (elevation <= -TWILIGHT_DEGREES) return "night";
  if (elevation < TWILIGHT_DEGREES) return rising ? "dawn" : "dusk";
  return "day";
}

/**
 * Brightness of the sky from the sun's elevation: dark below civil twilight,
 * a soft ramp through it and full daylight a little above the horizon.
 */
function daylightFromElevation(elevation: number): number {
  return clamp01((elevation + TWILIGHT_DEGREES) / (TWILIGHT_DEGREES + 12));
}

/**
 * Read Home Assistant's `sun.sun` entity. It reports elevation, whether the
 * sun is rising and the next sunrise/sunset, which is all we need. The last
 * sunrise/sunset is approximated as the next one minus a day; the error is a
 * few minutes at most and only moves the sun a hair along its arc.
 */
function fromSunEntity(sun: HassState, now: number) {
  const elevation = finiteNumber(sun.attributes.elevation);
  const nextRising = timestamp(sun.attributes.next_rising);
  const nextSetting = timestamp(sun.attributes.next_setting);
  if (elevation === undefined || nextRising === undefined || nextSetting === undefined) {
    return undefined;
  }

  const above = sun.state === "above_horizon";
  const rising =
    typeof sun.attributes.rising === "boolean" ? sun.attributes.rising : nextSetting > nextRising;

  // Above the horizon the arc runs from the last sunrise to the next sunset;
  // below it, from the last sunset to the next sunrise.
  const arcEnd = above ? nextSetting : nextRising;
  const arcStart = (above ? nextRising : nextSetting) - DAY;
  const arcProgress = clamp01((now - arcStart) / Math.max(arcEnd - arcStart, HOUR));

  return {
    phase: phaseFromElevation(elevation, rising),
    sunElevation: elevation,
    arcProgress,
    daylight: daylightFromElevation(elevation),
  };
}

/**
 * Fallback when no sun entity exists (demo mode, or a stripped-down Home
 * Assistant). A fixed 06:00–18:00 day is wrong for most of the year at
 * Nordic latitudes, so this is a stand-in, not a substitute for `sun.sun`.
 */
function fromClock(now: Date) {
  const hours = now.getHours() + now.getMinutes() / 60;
  const sunrise = 6.5;
  const sunset = 18;

  if (hours >= sunrise && hours < sunset) {
    const arcProgress = (hours - sunrise) / (sunset - sunrise);
    const elevation = Math.sin(arcProgress * Math.PI) * 40;
    const phase: SkyPhase =
      hours < sunrise + 1 ? "dawn" : hours >= sunset - 1 ? "dusk" : "day";
    return {
      phase,
      arcProgress,
      daylight: phase === "day" ? daylightFromElevation(elevation) : 0.45,
    };
  }

  const nightLength = 24 - (sunset - sunrise);
  const sinceSunset = (hours - sunset + 24) % 24;
  const arcProgress = sinceSunset / nightLength;
  const phase: SkyPhase =
    sinceSunset < 1 ? "dusk" : sinceSunset > nightLength - 1 ? "dawn" : "night";
  return { phase, arcProgress, daylight: phase === "night" ? 0 : 0.3 };
}

function fromWeatherEntity(weather: HassState | undefined) {
  if (!weather) return { ...CLEAR_SKY };

  const condition = weather.state;
  const shape = WEATHER_CONDITIONS[condition] ?? CLEAR_SKY;
  const temperature = finiteNumber(weather.attributes.temperature);
  const unit = weather.attributes.temperature_unit;

  return {
    ...shape,
    condition: condition === "unknown" || condition === "unavailable" ? undefined : condition,
    temperature,
    temperatureUnit: typeof unit === "string" ? unit : undefined,
  };
}

/** Turn the sun and weather entities into a renderer-friendly description of the sky. */
export function deriveAtmosphere(input: AtmosphereInput): Atmosphere {
  const sunPosition = input.sun ? fromSunEntity(input.sun, input.now.getTime()) : undefined;
  const position = sunPosition ?? fromClock(input.now);

  return {
    ...position,
    ...fromWeatherEntity(input.weather),
    source: sunPosition ? "sun-entity" : "clock",
  };
}
