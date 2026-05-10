import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared")
    }
  },
  build: {
    rollupOptions: {
      output: { entryFileNames: "recorder-preload.js" }
    }
  }
});
