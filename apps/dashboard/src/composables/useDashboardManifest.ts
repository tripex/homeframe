import { computed, ref } from "vue";
import type { DashboardManifest, DeviceProfileId } from "@homeframe/sdk";

export type ManifestStatus = "idle" | "loading" | "ready" | "missing" | "error";

function inferProfile(): DeviceProfileId {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (width <= 520) return "mobile";
  if (height <= 650 && width <= 1200) return "nest-hub";
  if (width <= 1400) return "tablet-10";
  return "desktop";
}

export function useDashboardManifest() {
  const manifest = ref<DashboardManifest>();
  const status = ref<ManifestStatus>("idle");
  const error = ref<string>();
  const selectedProfile = ref<DeviceProfileId>(inferProfile());

  const dashboardId = computed(() => manifest.value?.id);

  async function load(): Promise<void> {
    status.value = "loading";
    error.value = undefined;

    try {
      const params = new URLSearchParams(window.location.search);
      const explicitId = params.get("dashboard");
      const explicitProfile = params.get("profile") as DeviceProfileId | null;

      if (explicitProfile) selectedProfile.value = explicitProfile;

      if (explicitId) {
        const response = await fetch(`/api/dashboards/${encodeURIComponent(explicitId)}`);
        if (!response.ok) {
          status.value = "missing";
          return;
        }
        manifest.value = (await response.json()) as DashboardManifest;
        status.value = "ready";
        return;
      }

      const response = await fetch(
        `/api/dashboards?profile=${encodeURIComponent(selectedProfile.value)}`,
      );
      if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);

      const dashboards = (await response.json()) as DashboardManifest[];
      manifest.value = dashboards[0];
      status.value = manifest.value ? "ready" : "missing";
    } catch (reason) {
      // Vite-only development has no runtime API. The app deliberately falls
      // back to its reference/demo view instead of failing hard.
      status.value = "error";
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  }

  return {
    manifest,
    dashboardId,
    selectedProfile,
    status,
    error,
    load,
  };
}
