/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "module";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

export default defineConfig(async () => ({
  // @tailwindcss/vite replaces the PostCSS pipeline — no postcss.config needed
  plugins: [tailwindcss(), react()],

  define: {
    __BUILD_DATE__: JSON.stringify(
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    ),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  clearScreen: false,
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
