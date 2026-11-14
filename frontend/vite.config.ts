/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // In development the API runs locally; in production Firebase Hosting rewrites /api/** to Cloud Run.
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    target: "es2022",
    chunkSizeWarningLimit: 900,
    // Fonts are always emitted as files: the Content-Security-Policy allows fonts from this site only (no data: URLs).
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false, globals: true },
});
