/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in the hosted demo build: no runtime, sample home, sky switcher. */
  readonly VITE_HOMEFRAME_DEMO?: string;
  readonly VITE_HA_URL?: string;
  readonly VITE_HA_TOKEN?: string;
}
