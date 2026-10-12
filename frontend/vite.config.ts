import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The stack runs in Docker on a bind mount, where inotify events from the
    // Windows side are unreliable — without polling the dev server keeps serving
    // modules it never saw change (edits look like they "didn't take").
    watch: {
      usePolling: true,
      // 1s: polling is required on this Windows bind mount (see above), but
      // the dev server stats the whole tree on every tick — 300ms kept the
      // web container at ~60% CPU on a 4-thread host and starved the E2E
      // suite's Chrome. 1s still picks up saves well within human patience.
      interval: 1000,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
