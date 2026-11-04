import { computed, onUnmounted, ref, type Ref } from "vue";
import {
  deriveAtmosphere,
  type Atmosphere,
  type HassState,
  type SemanticHome,
  type SkyPhase,
} from "@homeframe/core";
import type { AtmosphereMode, DashboardManifest } from "@homeframe/sdk";

const PHASES: SkyPhase[] = ["night", "dawn", "day", "dusk"];

/**
 * A preview sky for demos and screenshots: `?phase=dusk&weather=rainy`.
 * The weather value is a Home Assistant condition (rainy, snowy, fog,
 * lightning-rainy…), so previews go through exactly the same mapping as a
 * live weather entity.
 */
export type SkyPreview = { phase?: SkyPhase; condition?: string };

function previewFromUrl(): SkyPreview {
  const params = new URLSearchParams(window.location.search);
  const phase = params.get("phase") as SkyPhase | null;
  return {
    phase: phase && PHASES.includes(phase) ? phase : undefined,
    condition: params.get("weather") ?? undefined,
  };
}

/** True in the hosted demo build, which has no runtime or Home Assistant. */
export const isDemoBuild = import.meta.env.VITE_HOMEFRAME_DEMO === "true";

/**
 * Shared so the sky switcher and the sky read the same preview. Changes are
 * mirrored into the URL, so any sky in the demo can be linked to.
 */
// The demo has no weather entity, so without a ?weather choice it shows a
// partly cloudy sample day. A plain spread would let the URL's undefined
// condition overwrite that default.
const initialPreview = previewFromUrl();
const preview = ref<SkyPreview>(
  isDemoBuild
    ? { ...initialPreview, condition: initialPreview.condition ?? "partlycloudy" }
    : initialPreview,
);

export function setSkyPreview(next: SkyPreview): void {
  preview.value = next;
  const url = new URL(window.location.href);
  for (const [key, value] of [["phase", next.phase], ["weather", next.condition]] as const) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

export function useSkyPreview() {
  return { preview, setSkyPreview };
}

const PREVIEW_POSITIONS: Record<SkyPhase, Pick<Atmosphere, "arcProgress" | "daylight" | "sunElevation">> = {
  night: { arcProgress: 0.45, daylight: 0, sunElevation: -30 },
  dawn: { arcProgress: 0.97, daylight: 0.3, sunElevation: -2 },
  day: { arcProgress: 0.42, daylight: 1, sunElevation: 24 },
  dusk: { arcProgress: 0.03, daylight: 0.3, sunElevation: -2 },
};

/**
 * Resolve the sky behind the dashboard. Entity ids come from the manifest's
 * atmosphere bindings, or — for older manifests and the reference view —
 * from the first discovered sun and weather capability. Components only ever
 * receive the derived Atmosphere.
 */
export function useAtmosphere(
  manifest: Ref<DashboardManifest | undefined>,
  states: Ref<Map<string, HassState>>,
  semanticHome: Ref<SemanticHome>,
) {
  const now = ref(new Date());
  // The sun moves slowly; once a minute is plenty and costs nothing.
  const timer = setInterval(() => {
    now.value = new Date();
  }, 60_000);
  onUnmounted(() => clearInterval(timer));

  function discovered(kind: "sun" | "weather"): string | undefined {
    return semanticHome.value.unassigned.find((capability) => capability.kind === kind)?.entityId ??
      semanticHome.value.areas
        .flatMap((area) => area.capabilities)
        .find((capability) => capability.kind === kind)?.entityId;
  }

  const mode = computed<AtmosphereMode>(() => manifest.value?.atmosphere?.mode ?? "live");

  const atmosphere = computed<Atmosphere>(() => {
    const sunId = manifest.value?.atmosphere?.sun ?? discovered("sun");
    const weatherId = manifest.value?.atmosphere?.weather ?? discovered("weather");

    let weather = weatherId ? states.value.get(weatherId) : undefined;
    const condition = preview.value.condition;
    if (condition) {
      weather = {
        entity_id: "weather.preview",
        state: condition,
        // The demo has no weather entity, so give the header a plausible
        // outdoor temperature to show next to the condition.
        attributes: weather?.attributes ?? (isDemoBuild ? { temperature: 9, temperature_unit: "°C" } : {}),
        last_changed: "",
        last_updated: "",
      };
    }

    const derived = deriveAtmosphere({
      sun: sunId ? states.value.get(sunId) : undefined,
      weather,
      now: now.value,
    });

    const phase = preview.value.phase;
    return phase ? { ...derived, phase, ...PREVIEW_POSITIONS[phase] } : derived;
  });

  return { atmosphere, mode };
}
