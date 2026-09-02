import { computed, ref } from "vue";

export type ControlActionsStatus = "unknown" | "enabled" | "disabled";

export type DashboardActionInput = {
  entityId?: string;
  temperature?: number;
};

type ActionErrorReason =
  | "invalid-request"
  | "no-bound-entities"
  | "entity-not-bound"
  | "invalid-input"
  | "unsupported-action"
  | "control-disabled"
  | "security-approval-required"
  | "unknown-dashboard"
  | "unknown-card-instance"
  | "unknown-card-type"
  | "unknown-action"
  | "service-call-failed"
  | "home-assistant-unavailable";

type ActionResponse = {
  error?: string;
  reason?: ActionErrorReason;
};

type HealthResponse = {
  ok: boolean;
  service: string;
  homeAssistant: unknown;
  controlActions: "enabled" | "disabled";
};

// Human-readable messages for failure reasons a user can actually act on or
// understand; everything else falls back to the server's own error text.
const REASON_MESSAGES: Partial<Record<ActionErrorReason, string>> = {
  "control-disabled":
    "Controls are disabled on this runtime (HOMEFRAME_ALLOW_CONTROL=true enables them).",
  "security-approval-required":
    "Security actions need explicit approval and are not available from the dashboard.",
  "home-assistant-unavailable": "Home Assistant is not connected.",
};

const controlActions = ref<ControlActionsStatus>("unknown");
const pending = ref(new Set<string>());
const lastError = ref<string>();

function pendingKey(instanceId: string, actionId: string): string {
  return `${instanceId}/${actionId}`;
}

/**
 * Shared dashboard action state: which card/action pairs are in flight, the
 * last error, and whether the runtime allows control actions at all. Shared
 * at module scope like useHomeAssistant so any component can read the same
 * pending/error state without prop-drilling.
 */
export function useDashboardActions() {
  async function loadStatus(): Promise<void> {
    try {
      const response = await fetch("/api/health", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;

      const health = (await response.json()) as HealthResponse;
      controlActions.value = health.controlActions;
    } catch {
      // No runtime reachable (e.g. plain Vite dev). Leave status "unknown"
      // so control buttons still work once a runtime does appear.
    }
  }

  async function run(
    dashboardId: string,
    instanceId: string,
    actionId: string,
    input?: DashboardActionInput,
  ): Promise<boolean> {
    const key = pendingKey(instanceId, actionId);
    const next = new Set(pending.value);
    next.add(key);
    pending.value = next;

    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dashboardId, instanceId, actionId, input }),
      });

      if (response.ok) {
        lastError.value = undefined;
        return true;
      }

      const body = (await response.json().catch(() => ({}))) as ActionResponse;
      lastError.value =
        (body.reason && REASON_MESSAGES[body.reason]) ||
        body.error ||
        `Action failed (${response.status}).`;
      return false;
    } catch (reason) {
      lastError.value = reason instanceof Error ? reason.message : String(reason);
      return false;
    } finally {
      const after = new Set(pending.value);
      after.delete(key);
      pending.value = after;
    }
  }

  function isPending(instanceId: string, actionId: string): boolean {
    return pending.value.has(pendingKey(instanceId, actionId));
  }

  // Unknown counts as allowed so buttons are usable in development before
  // /api/health has answered; the server still enforces the real check.
  const canControl = computed(() => controlActions.value !== "disabled");

  return {
    controlActions,
    lastError,
    canControl,
    loadStatus,
    run,
    isPending,
  };
}
