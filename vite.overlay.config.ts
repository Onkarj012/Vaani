import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/renderer/overlay"),
  cacheDir: resolve("node_modules/.vite-overlay"),
  build: {
    outDir: resolve(".vite/renderer/overlay_window"),
    emptyOutDir: false
  },
  resolve: {
    alias: {
      "@": resolve("src/renderer"),
      "@shared": resolve("src/shared"),
      "@renderer": resolve("src/renderer")
    }
  },
  plugins: [react(), tailwindcss()]
});
