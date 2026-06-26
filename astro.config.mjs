// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // Fully-local, single-user app with no auth: Astro's default cross-origin
  // form-post check rejects multipart uploads and programmatic API calls
  // (e.g. file uploads, DELETE), so disable it.
  security: {
    checkOrigin: false,
  },
  server: {
    port: 4322,
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ["bun:sqlite"],
    },
  },
});
