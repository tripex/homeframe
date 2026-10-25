import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  // The hosted demo lives under /homeframe/ on GitHub Pages; everything else
  // is served from the root by Homeframe Runtime or Vite.
  base: process.env.HOMEFRAME_BASE ?? "/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 4173,
  },
});
