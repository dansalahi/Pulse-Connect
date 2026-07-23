/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  clearScreen: false,

  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        overlay: "src/overlay.html",
        debug: "src/debug.html",
      },
    },
  },

  server: {
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
}));
