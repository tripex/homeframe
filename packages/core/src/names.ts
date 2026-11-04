/**
 * Display-name clean-up shared by discovery and the dashboard.
 *
 * Home Assistant builds a friendly name from the device name plus the entity
 * name. Some integrations set an entity name that already contains the device
 * name (or a leading space), which yields names such as "L50 Ultra  L50 Ultra".
 * These helpers only remove what is clearly redundant; anything else is left
 * exactly as the user or integration named it.
 */

/** Collapse runs of whitespace and trim. */
function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Tidy a friendly name: collapse whitespace and an exact repeated phrase
 * ("L50 Ultra L50 Ultra" -> "L50 Ultra", "Kitchen Kitchen light" ->
 * "Kitchen light"). Repetition is compared case-insensitively on whole words.
 */
export function tidyName(value: string): string {
  const words = squash(value).split(" ");
  // Try the longest repeated prefix first: "A B A B C" -> "A B C".
  for (let size = Math.floor(words.length / 2); size >= 1; size -= 1) {
    const head = words.slice(0, size).join(" ").toLowerCase();
    const next = words.slice(size, size * 2).join(" ").toLowerCase();
    if (head === next) return [...words.slice(0, size), ...words.slice(size * 2)].join(" ");
  }
  return words.join(" ");
}

/**
 * Stream-variant suffixes camera integrations append to the device name
 * (UniFi Protect: "High resolution channel"; Reolink: "Fluent"/"Clear"…).
 * The device name alone is the better card title.
 */
const CAMERA_STREAM_SUFFIX =
  /\s+(?:(?:high|medium|low)[\s_-]*resolution(?:\s+channel)?|(?:main|sub)[\s_-]*stream|fluent|clear|insecure)$/i;

/** Title for a camera card: tidy and without a stream-variant suffix. */
export function cameraTitle(value: string): string {
  const tidy = tidyName(value);
  const stripped = tidy.replace(CAMERA_STREAM_SUFFIX, "").trim();
  return stripped || tidy;
}
