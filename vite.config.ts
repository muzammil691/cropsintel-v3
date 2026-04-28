import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site at https://muzammil691.github.io/cropsintel-v3/
  // base must match that path so /assets/*.js resolve correctly.
  // When custom domain (cropsintel.com) is wired up, change this to "/".
  base: "/cropsintel-v3/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
