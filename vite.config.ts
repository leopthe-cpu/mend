// Build setup (decision 62). The same plugins the Lovable template wrapped,
// configured directly so Mend depends on no hosted builder:
//   Tailwind → tsconfig paths → TanStack Start → Nitro (server output) → React.
// Nitro builds a plain Node server (`npm start` runs .output/server/index.mjs
// on $PORT), which is what Railway runs. NITRO_PRESET still overrides it if a
// different host is ever needed (e.g. NITRO_PRESET=cloudflare-module).
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Dev server on all interfaces (IPv4 and IPv6 where available), port 8080.
  server: { host: true, port: 8080 },
  // Lightning CSS (a Vite dependency) handles the oklch colours and nesting
  // in src/styles.css, as before.
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // One copy of React and React Query, even if a dependency brings its own.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // src/server.ts wraps the app's server entry (error page, security headers).
      server: { entry: "server" },
      // Never let browser code import server-only modules.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    nitro({ preset: process.env["NITRO_PRESET"] || "node-server" }),
    viteReact(),
  ],
});
