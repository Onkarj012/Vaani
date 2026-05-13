import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/renderer/recorder"),
  build: {
    outDir: resolve(".vite/renderer/recorder_window"),
    emptyOutDir: false
  },
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@renderer": resolve("src/renderer")
    }
  }
});
