import { computed, ref } from "vue";
import type { DashboardManifest, DeviceProfileId } from "@homeframe/sdk";

export type ManifestStatus = "idle" | "loading" | "ready" | "missing" | "error";

export type DashboardView = { id: string; name: string; profile: DeviceProfileId };

/**
 * Which kind of screen this is, from the window size: a 1920+ wide desktop
 * window gets the desktop dashboard, a 1280×800 wall tablet the tablet one.
 */
function inferProfile(): DeviceProfileId {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (width <= 520) return "mobile";
  if (height <= 650 && width <= 1200) return "nest-hub";
  if (width <= 1400) return "tablet-10";
  return "desktop";
}

/**
 * A desktop without a desktop dashboard (e.g. before the add-on created one)
 * still shows the tablet's instead of the reference view. Smaller screens
 * never borrow a bigger screen's dashboard.
 */
const FALLBACK: Partial<Record<DeviceProfileId, DeviceProfileId>> = { desktop: "tablet-10" };

export function useDashboardManifest() {
  const manifest = ref<DashboardManifest>();
  const status = ref<ManifestStatus>("idle");
  const error = ref<string>();
  const selectedProfile = ref<DeviceProfileId>(inferProfile());
  /** Every saved dashboard, for the side navigation. */
  const all = ref<DashboardView[]>([]);

  const shownProfile = computed(() => manifest.value?.target.profile ?? selectedProfile.value);
  /** Dashboards for the same kind of screen as the one shown. */
  const views = computed(() => all.value.filter((view) => view.profile === shownProfile.value));
  /** Dashboards made for other screens (the tablet's, the desktop's…). */
  const otherViews = computed(() =>
    all.value.filter((view) => view.profile !== shownProfile.value && view.profile !== "mobile"),
  );

  async function fetchAll(): Promise<DashboardManifest[]> {
    const response = await fetch("api/dashboards");
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    const dashboards = (await response.json()) as DashboardManifest[];
    all.value = dashboards.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      profile: dashboard.target.profile,
    }));
    return dashboards;
  }

  /** Switch dashboard without a reload; the URL keeps it bookmarkable. */
  async function select(id: string): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set("dashboard", id);
    window.history.replaceState(null, "", url);
    await load();
  }

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
        const response = await fetch(`api/dashboards/${encodeURIComponent(explicitId)}`);
        if (!response.ok) {
          status.value = "missing";
          return;
        }
        manifest.value = (await response.json()) as DashboardManifest;
        status.value = "ready";
        await fetchAll().catch(() => undefined);
        return;
      }

      const dashboards = await fetchAll();
      const forProfile = (profile: DeviceProfileId | undefined) =>
        dashboards.find((dashboard) => dashboard.target.profile === profile);
      manifest.value = forProfile(selectedProfile.value) ?? forProfile(FALLBACK[selectedProfile.value]);
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
    views,
    otherViews,
    load,
    select,
  };
}
