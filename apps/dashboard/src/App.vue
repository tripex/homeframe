<script setup lang="ts">
import { Settings2, Sparkles, Wifi, WifiOff } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref } from "vue";
import ApplianceCard from "./components/cards/ApplianceCard.vue";
import ClimateCard from "./components/cards/ClimateCard.vue";
import EnergyCard from "./components/cards/EnergyCard.vue";
import RoomCard from "./components/cards/RoomCard.vue";
import SecurityCard from "./components/cards/SecurityCard.vue";
import BottomNav from "./components/layout/BottomNav.vue";
import ManifestCardRenderer from "./components/ManifestCardRenderer.vue";
import ConnectionModal from "./components/settings/ConnectionModal.vue";
import { useDashboardData } from "./composables/useDashboardData";
import { useDashboardManifest } from "./composables/useDashboardManifest";
import { useHomeAssistant } from "./composables/useHomeAssistant";

const {
  status,
  states,
  semanticHome,
  connectRuntime,
  connect,
  error,
} = useHomeAssistant();
const { rooms, powerWatts, energyTodayKwh, climateZones } = useDashboardData(
  status,
  states,
  semanticHome,
);
const {
  manifest,
  selectedProfile,
  status: manifestStatus,
  load: loadManifest,
} = useDashboardManifest();

const now = ref(new Date());
const showConnectionModal = ref(false);
let clockTimer: ReturnType<typeof setInterval> | undefined;

const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
});

const discoveryLabel = computed(() => {
  if (status.value === "connected") return `${semanticHome.value.areas.length} areas discovered`;
  if (status.value === "connecting") return "Connecting…";
  if (status.value === "error") return "Connection needs attention";
  return "Demo mode · ready for Home Assistant";
});

const dashboardLabel = computed(() =>
  manifest.value ? `${manifest.value.name} · ${manifest.value.target.profile}` : `Reference · ${selectedProfile.value}`,
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

  await loadManifest();

  const runtimeConnected = await connectRuntime();
  if (!runtimeConnected) {
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
  <div class="app-shell">
    <div class="ambient ambient-a" />
    <div class="ambient ambient-b" />

    <main>
      <header class="topbar">
        <div>
          <p class="eyebrow">HOMEFRAME · {{ dashboardLabel }}</p>
          <h1>{{ greeting }}.</h1>
          <p class="subtitle">Everything that matters, without the noise.</p>
        </div>

        <div class="top-status">
          <button class="pill connect-pill" type="button" @click="showConnectionModal = true">
            <component :is="status === 'connected' ? Wifi : WifiOff" :size="14" />
            {{ discoveryLabel }}
            <Settings2 :size="13" />
          </button>

          <span class="clock">
            {{ now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}
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
            {{ manifestStatus === "loading" ? "Loading installation dashboard…" : "Reference view. Create a dashboard with CLI or MCP to replace it." }}
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
        />
      </section>

      <section v-else class="dashboard-grid">
        <RoomCard v-for="room in rooms" :key="room.name" v-bind="room" />
        <EnergyCard :watts="powerWatts ?? 1420" :today-kwh="energyTodayKwh ?? 9.8" />
        <ClimateCard v-if="climateZones.length" :zones="climateZones" />
        <ApplianceCard kind="washer" title="Washing machine" state="38 min remaining" detail="Reference surface" :progress="64" />
        <ApplianceCard kind="vacuum" title="Robot vacuum" state="Docked" detail="Reference surface" />
        <SecurityCard />
      </section>
    </main>

    <BottomNav />

    <ConnectionModal
      v-if="showConnectionModal"
      :status="status"
      :error="error"
      @close="showConnectionModal = false"
      @connect="connectHomeAssistant"
    />
  </div>
</template>
