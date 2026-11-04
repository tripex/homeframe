import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs by default, so the same build works at the root of a
  // standalone runtime and under Home Assistant's ingress prefix
  // (/api/hassio_ingress/<token>/). The hosted demo sets /homeframe/.
  base: process.env.HOMEFRAME_BASE ?? "./",
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
