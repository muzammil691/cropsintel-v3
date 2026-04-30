import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site at https://muzammil691.github.io/cropsintel-v3/
  // base must match that path so /assets/*.js resolve correctly.
  // When custom domain (cropsintel.com) is wired up, change this to "/".
  base: "/cropsintel-v3/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "CropsIntel",
        short_name: "CropsIntel",
        description: "Almond market intelligence + CRM. Atlas conductor for build.",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        // Absolute paths include the GitHub Pages base so the install works
        // correctly before the cropsintel.com custom domain is live.
        scope: "/cropsintel-v3/",
        start_url: "/cropsintel-v3/atlas",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache static shell files only; API data must always be fresh
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        runtimeCaching: [
          {
            // Atlas Railway API — never serve stale snapshot data
            urlPattern: /^https:\/\/courteous-simplicity-production\.up\.railway\.app\/atlas\//,
            handler: "NetworkOnly",
          },
          {
            // Supabase — auth + RLS queries must always be fresh
            urlPattern: /^https:\/\/.+\.supabase\.co\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
