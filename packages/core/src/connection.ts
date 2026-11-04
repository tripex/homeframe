/**
 * Small, pure decisions about connection health, shared by the runtime (when
 * to retry Home Assistant) and the dashboard (when to call its data stale).
 * Kept free of timers and sockets so they are trivially testable.
 */

/**
 * Wait times between reconnect attempts. Short at first because most drops
 * are a Home Assistant restart that is back within seconds; capped at 30 s so
 * a long outage costs nothing but is still noticed quickly once it ends.
 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/**
 * Delay before reconnect attempt number `attempt` (0-based). The last entry
 * repeats forever. Up to 10 % jitter keeps several screens or add-ons from
 * hitting a freshly restarted Home Assistant in the same millisecond.
 */
export function reconnectDelayMs(
  attempt: number,
  delays: readonly number[] = RECONNECT_DELAYS_MS,
  random: () => number = Math.random,
): number {
  const base = delays[Math.min(Math.max(0, attempt), delays.length - 1)] ?? 30_000;
  return Math.round(base * (1 + random() * 0.1));
}

export type LiveDataReason = "home-assistant" | "runtime";

export type LiveDataInput = {
  /** The runtime reports a working Home Assistant connection. */
  homeAssistantConnected: boolean;
  /** The browser's event stream to the runtime is open. */
  streamOpen: boolean;
  /** When the data stopped being live (ms epoch); undefined while healthy. */
  unhealthySince?: number;
  now: number;
  /**
   * How long a problem must last before the screen says so. The event stream
   * reconnects on its own within a few seconds after a blip; flashing a
   * warning for that would teach people to ignore it.
   */
  graceMs?: number;
};

export type LiveDataHealth = {
  stale: boolean;
  /** Which link is broken. A broken stream hides the Home Assistant status, so it wins. */
  reason?: LiveDataReason;
  /** How long ago the data was last known to be live, when stale. */
  staleForMs?: number;
};

export const LIVE_DATA_GRACE_MS = 4_000;

/** Decide whether a screen should mark its values as possibly out of date. */
export function liveDataHealth(input: LiveDataInput): LiveDataHealth {
  const healthy = input.homeAssistantConnected && input.streamOpen;
  if (healthy || input.unhealthySince === undefined) return { stale: false };

  const staleForMs = Math.max(0, input.now - input.unhealthySince);
  if (staleForMs < (input.graceMs ?? LIVE_DATA_GRACE_MS)) return { stale: false };

  return {
    stale: true,
    reason: input.streamOpen ? "home-assistant" : "runtime",
    staleForMs,
  };
}
