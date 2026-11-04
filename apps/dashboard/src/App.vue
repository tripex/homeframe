<script setup lang="ts">
import { House, Settings2, Sparkles, Wifi, WifiOff } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watchEffect } from "vue";
import ApplianceCard from "./components/cards/ApplianceCard.vue";
import AgendaCard from "./components/cards/AgendaCard.vue";
import ClimateCard from "./components/cards/ClimateCard.vue";
import EnergyCard from "./components/cards/EnergyCard.vue";
import ForecastCard from "./components/cards/ForecastCard.vue";
import PresenceCard from "./components/cards/PresenceCard.vue";
import RoomCard from "./components/cards/RoomCard.vue";
import SecurityCard from "./components/cards/SecurityCard.vue";
import AtmosphereLayer from "./components/atmosphere/AtmosphereLayer.vue";
import SkySwitcher from "./components/demo/SkySwitcher.vue";
import BottomNav from "./components/layout/BottomNav.vue";
import SideNav from "./components/layout/SideNav.vue";
import ManifestCardRenderer from "./components/ManifestCardRenderer.vue";
import ConnectionModal from "./components/settings/ConnectionModal.vue";
import { isDemoBuild, useAtmosphere } from "./composables/useAtmosphere";
import { useDashboardActions } from "./composables/useDashboardActions";
import { useDashboardData } from "./composables/useDashboardData";
import { useDashboardManifest } from "./composables/useDashboardManifest";
import { useHomeAssistant } from "./composables/useHomeAssistant";
import { demoEnergyHistory } from "./demo/demoEnergy";
import { demoAgenda, demoForecast, demoPeople } from "./demo/demoTablet";
import { setLocale, useI18n } from "./i18n";

const {
  status,
  states,
  semanticHome,
  connectRuntime,
  connect,
  error,
} = useHomeAssistant();
const { rooms, powerWatts, climateZones } = useDashboardData(
  status,
  states,
  semanticHome,
);
const {
  manifest,
  selectedProfile,
  status: manifestStatus,
  views,
  load: loadManifest,
  select: selectDashboard,
} = useDashboardManifest();
const { lastError: actionError, loadStatus: loadActionStatus } = useDashboardActions();
const { atmosphere, mode: atmosphereMode } = useAtmosphere(manifest, states, semanticHome);
const showSkySwitcher = isDemoBuild || new URLSearchParams(window.location.search).has("preview");

const { t, has, time, longDate, number } = useI18n();

// The manifest decides the language; ?lang=da previews one without editing it.
watchEffect(() => {
  setLocale(manifest.value?.locale ?? new URLSearchParams(window.location.search).get("lang") ?? undefined);
});

const weatherNow = computed(() => {
  const { temperature, condition } = atmosphere.value;
  if (temperature === undefined && !condition) return undefined;
  const conditionKey = `weather.${condition}`;
  return {
    temperature: temperature === undefined ? undefined : `${number(Math.round(temperature))}°`,
    condition: condition ? (has(conditionKey) ? t(conditionKey) : condition) : undefined,
  };
});

/**
 * Tablets and desktops get the side navigation; phones keep the bottom bar.
 * A manifest can choose explicitly with `navigation.style`.
 */
const useSideNav = computed(() => {
  const style = manifest.value?.navigation?.style;
  if (style) return style === "side";
  return manifest.value ? ["tablet-10", "desktop"].includes(manifest.value.target.profile) : false;
});

const navViews = computed(() =>
  views.value.map((view) => ({ ...view, active: view.id === manifest.value?.id })),
);

/** People in the side navigation, read from the manifest's own list. */
const navPeople = computed(() =>
  (manifest.value?.navigation?.people ?? []).map((entityId) => {
    const state = states.value.get(entityId);
    return {
      id: entityId,
      name: String(state?.attributes.friendly_name ?? entityId.split(".")[1] ?? entityId),
      home: state?.state === "home",
    };
  }),
);

const now = ref(new Date());
// The reference view shows a full energy day so the card can be judged
// without Home Assistant; manifests always use real runtime history.
const demoEnergy = demoEnergyHistory();
const sampleForecast = demoForecast();
const sampleAgenda = demoAgenda();
const showConnectionModal = ref(false);
let clockTimer: ReturnType<typeof setInterval> | undefined;

const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour < 12) return t("greeting.morning");
  if (hour < 18) return t("greeting.afternoon");
  return t("greeting.evening");
});

const discoveryLabel = computed(() => {
  if (status.value === "connected") return `${semanticHome.value.areas.length} areas discovered`;
  if (status.value === "connecting") return "Connecting…";
  if (status.value === "error") return "Connection needs attention";
  return isDemoBuild ? "Sample home" : "Demo mode · ready for Home Assistant";
});

const dashboardLabel = computed(() =>
  // Planned dashboard names already end in their profile ("Home · tablet-10").
  manifest.value ? manifest.value.name : isDemoBuild ? "Live demo" : `Reference · ${selectedProfile.value}`,
);

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${manifest.value?.target.columns ?? 12}, minmax(0, 1fr))`,
}));

async function connectHomeAssistant(baseUrl: string, token: string): Promise<void> {
  await connect(baseUrl, token);
  if (status.value === "connected") showConnectionModal.value = false;
}

onMounted(async () => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 30_000);

  // The hosted demo is a static page: there is no runtime to ask.
  if (isDemoBuild) return;

  await loadManifest();
  await loadActionStatus();

  const runtimeConnected = await connectRuntime();
  // A browser-held token is a development convenience only. Production builds
  // talk to Home Assistant exclusively through the runtime.
  if (!runtimeConnected && import.meta.env.DEV) {
    const baseUrl = import.meta.env.VITE_HA_URL;
    const token = import.meta.env.VITE_HA_TOKEN;
    if (baseUrl && token) await connect(baseUrl, token);
  }
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<template>
  <div v-if="manifest && useSideNav" class="app-shell tablet-shell">
    <AtmosphereLayer :atmosphere="atmosphere" :mode="atmosphereMode" :quick="showSkySwitcher" />

    <SideNav
      :outdoor-temperature="weatherNow?.temperature"
      :outdoor-condition="weatherNow?.condition"
      :views="navViews"
      :people="navPeople"
      @select="selectDashboard"
    />

    <main class="tablet-main">
      <header class="tablet-header">
        <div>
          <h1>{{ greeting }}</h1>
          <p class="tablet-date">{{ longDate(now) }}</p>
        </div>
        <div class="tablet-header-status">
          <span v-if="weatherNow" class="weather-now">
            <strong v-if="weatherNow.temperature">{{ weatherNow.temperature }}</strong>
            <span v-if="weatherNow.condition">{{ weatherNow.condition }}</span>
          </span>
          <span class="tablet-clock">{{ time(now) }}</span>
        </div>
      </header>

      <p v-if="actionError" class="action-error tablet-error">
        {{ actionError }}
        <button type="button" class="dismiss-error" @click="actionError = undefined">✕</button>
      </p>

      <section class="dashboard-grid manifest-grid tablet-grid" :style="gridStyle">
        <ManifestCardRenderer
          v-for="card in manifest.cards"
          :key="card.instanceId"
          :card="card"
          :states="states"
          :dashboard-id="manifest.id"
          :atmosphere="atmosphere"
          :atmosphere-mode="atmosphereMode"
        />
      </section>
    </main>

    <SkySwitcher v-if="showSkySwitcher" :current-phase="atmosphere.phase" />
  </div>

  <div v-else class="app-shell">
    <AtmosphereLayer :atmosphere="atmosphere" :mode="atmosphereMode" :quick="showSkySwitcher" />

    <main>
      <header class="topbar">
        <div>
          <p class="eyebrow">HOMEFRAME · {{ dashboardLabel }}</p>
          <h1>{{ greeting }}.</h1>
          <p class="subtitle">Everything that matters, without the noise.</p>
        </div>

        <div class="top-status">
          <button class="pill connect-pill" type="button" @click="showConnectionModal = true">
            <component :is="isDemoBuild ? House : status === 'connected' ? Wifi : WifiOff" :size="14" />
            {{ discoveryLabel }}
            <Settings2 :size="13" />
          </button>

          <span v-if="weatherNow" class="weather-now">
            <strong v-if="weatherNow.temperature">{{ weatherNow.temperature }}</strong>
            <span v-if="weatherNow.condition">{{ weatherNow.condition }}</span>
          </span>

          <span class="clock">
            {{ time(now) }}
          </span>
        </div>
      </header>

      <section class="ai-strip">
        <div class="ai-icon"><Sparkles :size="20" /></div>
        <div>
          <strong>{{ manifest ? "Dashboard managed by Homeframe." : "House looks calm." }}</strong>
          <p v-if="manifest">
            {{ manifest.cards.length }} cards · {{ manifest.target.profile }} · {{ manifest.theme ?? "default theme" }}
          </p>
          <p v-else>
            {{
              isDemoBuild
                ? "A sample home running in your browser. Install Homeframe to see your own."
                : manifestStatus === "loading"
                  ? "Loading installation dashboard…"
                  : "Reference view. Create a dashboard with CLI or MCP to replace it."
            }}
          </p>
          <p v-if="actionError" class="action-error">
            {{ actionError }}
            <button type="button" class="dismiss-error" @click="actionError = undefined">Dismiss</button>
          </p>
        </div>
        <button type="button">Ask home</button>
      </section>

      <section v-if="manifest" class="dashboard-grid manifest-grid" :style="gridStyle">
        <ManifestCardRenderer
          v-for="card in manifest.cards"
          :key="card.instanceId"
          :card="card"
          :states="states"
          :dashboard-id="manifest.id"
          :atmosphere="atmosphere"
          :atmosphere-mode="atmosphereMode"
        />
      </section>

      <section v-else class="dashboard-grid">
        <RoomCard v-for="room in rooms" :key="room.name" v-bind="room" />
        <EnergyCard
          :watts="powerWatts ?? 1420"
          :summary="status === 'connected' ? undefined : demoEnergy.summary"
          :currency="demoEnergy.currency"
        />
        <ClimateCard v-if="climateZones.length" :zones="climateZones" />
        <ApplianceCard kind="washer" title="Washing machine" state="38 min remaining" detail="Reference surface" :progress="64" />
        <ApplianceCard kind="vacuum" title="Robot vacuum" state="Docked" detail="Reference surface" />
        <SecurityCard />
        <ForecastCard :days="sampleForecast" />
        <AgendaCard :events="sampleAgenda" has-calendars />
        <PresenceCard :people="demoPeople" />
      </section>
    </main>

    <BottomNav />

    <SkySwitcher v-if="showSkySwitcher" :current-phase="atmosphere.phase" />

    <ConnectionModal
      v-if="showConnectionModal"
      :status="status"
      :error="error"
      @close="showConnectionModal = false"
      @connect="connectHomeAssistant"
    />
  </div>
</template>
