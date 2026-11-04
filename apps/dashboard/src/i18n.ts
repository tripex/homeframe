import { computed, ref } from "vue";

/**
 * A deliberately tiny i18n layer: one flat dictionary per language, English
 * as the fallback, `{name}` placeholders and nothing else. Homeframe has a
 * handful of UI strings; a full i18n library would cost more than it saves.
 *
 * To add a language, copy the `en` block, translate the values and register
 * it in `dictionaries`. Missing keys fall back to English.
 */
const en = {
  "greeting.morning": "Good morning",
  "greeting.afternoon": "Good afternoon",
  "greeting.evening": "Good evening",
  "nav.label": "Dashboard navigation",
  "nav.outside": "Outside",
  "nav.home": "Home",
  "nav.rooms": "Rooms",
  "nav.energy": "Energy",
  "nav.automations": "Automations",
  "nav.settings": "Settings",
  "nav.people": "People",
  "presence.home": "Home",
  "presence.away": "Away",
  "presence.title": "Who's home",
  "presence.empty": "No people are tracked in Home Assistant.",
  "scene.allLocked": "All locked",
  "scene.unlocked": "Unlocked",
  "scene.lockUnknown": "Lock unavailable",
  "scene.lightsOff": "All lights off",
  "scene.lightsOn.one": "1 light on",
  "scene.lightsOn.other": "{count} lights on",
  "scene.inside": "{temperature}° inside",
  "scene.heating": "{count} heating",
  "scene.title": "Home",
  "room.eyebrow": "ROOM",
  "room.temperature": "Temperature",
  "room.humidity": "Humidity",
  "room.lightsOff": "Lights off",
  "room.toggleLights": "Toggle lights in {name}",
  "climateCard.eyebrow": "CLIMATE",
  "climateCard.title": "Heating",
  "climateCard.empty": "No climate devices are bound.",
  "security.eyebrow": "SECURITY",
  "security.title": "Status",
  "security.locks": "Locks",
  "security.doorsAndWindows": "Doors & windows",
  "security.nightMode": "Night mode",
  "security.secure": "Locked",
  "security.attention": "Unlocked",
  "security.review": "Check",
  "security.ready": "Ready",
  "cameraCard.eyebrow": "CAMERA",
  "cameraCard.unavailable": "Camera unavailable",
  "cameraCard.empty": "No camera is bound.",
  "forecast.eyebrow": "FORECAST",
  "forecast.title": "Next days",
  "forecast.empty": "No forecast available.",
  "forecast.today": "Today",
  "agenda.eyebrow": "AGENDA",
  "agenda.title": "Coming up",
  "agenda.empty": "Nothing planned this week.",
  "agenda.noCalendars": "No calendars are bound.",
  "agenda.allDay": "All day",
  "agenda.today": "Today",
  "agenda.tomorrow": "Tomorrow",
  "appliance.washer": "WASHER",
  "appliance.dryer": "DRYER",
  "appliance.vacuum": "VACUUM",
  "vacuum.docked": "Docked",
  "vacuum.cleaning": "Cleaning",
  "vacuum.returning": "Returning to dock",
  "vacuum.paused": "Paused",
  "vacuum.idle": "Idle",
  "vacuum.error": "Needs attention",
  "vacuum.unavailable": "Unavailable",
  "weather.clear-night": "Clear",
  "weather.cloudy": "Cloudy",
  "weather.exceptional": "Unusual weather",
  "weather.fog": "Fog",
  "weather.hail": "Hail",
  "weather.lightning": "Thunder",
  "weather.lightning-rainy": "Thunderstorm",
  "weather.partlycloudy": "Partly cloudy",
  "weather.pouring": "Heavy rain",
  "weather.rainy": "Rain",
  "weather.snowy": "Snow",
  "weather.snowy-rainy": "Sleet",
  "weather.sunny": "Sunny",
  "weather.windy": "Windy",
  "weather.windy-variant": "Windy",
};

export type MessageKey = keyof typeof en;

const da: Partial<Record<MessageKey, string>> = {
  "greeting.morning": "Godmorgen",
  "greeting.afternoon": "God eftermiddag",
  "greeting.evening": "Godaften",
  "nav.label": "Navigation",
  "nav.outside": "Ude",
  "nav.home": "Hjem",
  "nav.rooms": "Rum",
  "nav.energy": "Energi",
  "nav.automations": "Automationer",
  "nav.settings": "Indstillinger",
  "nav.people": "Personer",
  "presence.home": "Hjemme",
  "presence.away": "Ude",
  "presence.title": "Hvem er hjemme",
  "presence.empty": "Ingen personer følges i Home Assistant.",
  "scene.allLocked": "Alt låst",
  "scene.unlocked": "Ulåst",
  "scene.lockUnknown": "Lås utilgængelig",
  "scene.lightsOff": "Alle lys slukket",
  "scene.lightsOn.one": "1 lys tændt",
  "scene.lightsOn.other": "{count} lys tændt",
  "scene.inside": "{temperature}° inde",
  "scene.heating": "{count} varmer",
  "scene.title": "Hjem",
  "room.eyebrow": "RUM",
  "room.temperature": "Temperatur",
  "room.humidity": "Luftfugtighed",
  "room.lightsOff": "Lys slukket",
  "room.toggleLights": "Tænd/sluk lys i {name}",
  "climateCard.eyebrow": "KLIMA",
  "climateCard.title": "Varme",
  "climateCard.empty": "Ingen klimaenheder er tilknyttet.",
  "security.eyebrow": "SIKRING",
  "security.title": "Status",
  "security.locks": "Låse",
  "security.doorsAndWindows": "Døre & vinduer",
  "security.nightMode": "Nattilstand",
  "security.secure": "Låst",
  "security.attention": "Ulåst",
  "security.review": "Tjek",
  "security.ready": "Klar",
  "cameraCard.eyebrow": "KAMERA",
  "cameraCard.unavailable": "Kamera utilgængeligt",
  "cameraCard.empty": "Intet kamera er tilknyttet.",
  "forecast.eyebrow": "VEJRUDSIGT",
  "forecast.title": "De næste dage",
  "forecast.empty": "Ingen vejrudsigt tilgængelig.",
  "forecast.today": "I dag",
  "agenda.eyebrow": "KALENDER",
  "agenda.title": "Det sker",
  "agenda.empty": "Intet planlagt i denne uge.",
  "agenda.noCalendars": "Ingen kalendere er tilknyttet.",
  "agenda.allDay": "Hele dagen",
  "agenda.today": "I dag",
  "agenda.tomorrow": "I morgen",
  "appliance.washer": "VASKEMASKINE",
  "appliance.dryer": "TØRRETUMBLER",
  "appliance.vacuum": "ROBOTSTØVSUGER",
  "vacuum.docked": "I dock",
  "vacuum.cleaning": "Gør rent",
  "vacuum.returning": "Kører hjem",
  "vacuum.paused": "På pause",
  "vacuum.idle": "Klar",
  "vacuum.error": "Kræver opmærksomhed",
  "vacuum.unavailable": "Utilgængelig",
  "weather.clear-night": "Klart",
  "weather.cloudy": "Overskyet",
  "weather.exceptional": "Usædvanligt vejr",
  "weather.fog": "Tåge",
  "weather.hail": "Hagl",
  "weather.lightning": "Torden",
  "weather.lightning-rainy": "Tordenbyger",
  "weather.partlycloudy": "Delvist skyet",
  "weather.pouring": "Skybrud",
  "weather.rainy": "Regn",
  "weather.snowy": "Sne",
  "weather.snowy-rainy": "Slud",
  "weather.sunny": "Sol",
  "weather.windy": "Blæsende",
  "weather.windy-variant": "Blæsende",
};

const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { en, da };

/** Shared like the other composables so every component follows one setting. */
const locale = ref("en");

export function setLocale(next: string | undefined): void {
  locale.value = next || "en";
  document.documentElement.lang = locale.value;
}

export function translate(key: MessageKey, params: Record<string, string | number> = {}): string {
  const language = locale.value.split("-")[0];
  const template = dictionaries[language]?.[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

export function useI18n() {
  const numberFormat = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }));

  return {
    locale,
    t: translate,
    /** True when the language has a translation for this key (e.g. weather states). */
    has: (key: string): key is MessageKey => key in en,
    number: (value: number) => numberFormat.value.format(value),
    time: (date: Date) => date.toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" }),
    weekday: (date: Date) => date.toLocaleDateString(locale.value, { weekday: "short" }),
    longDate: (date: Date) => date.toLocaleDateString(locale.value, { weekday: "long", day: "numeric", month: "long" }),
  };
}
