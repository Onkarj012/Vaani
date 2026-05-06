import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@main": resolve("src/main")
    }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: "main.js" }
    }
  }
});
