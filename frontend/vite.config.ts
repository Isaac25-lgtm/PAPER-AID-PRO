/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Stamps every build with what it was built from and for: build-info.json in the output holds the commit, the Vite
 * mode and the public settings compiled into the bundle. deploy/frontend_preflight.py checks it, and the bundle
 * itself, against the release target before anything is published (audit SF09).
 */
function buildInfo(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  let commit = process.env.PAPERAID_BUILD_COMMIT ?? "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "unknown";
    }
  }
  return {
    name: "paperaid-build-info",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: JSON.stringify(
          {
            commit,
            mode,
            apiBaseUrl: env.VITE_API_BASE_URL ?? "",
            firebaseProjectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
            firebaseAuthDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
          },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), buildInfo(mode)],
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
}));
