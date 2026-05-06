import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@main": resolve("src/main"),
      "@renderer": resolve("src/renderer"),
      "@preload": resolve("src/preload")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["Vaani_Electron/**", "build/**", ".vite/**", "node_modules/**"],
    globals: true,
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["tests/__mocks__/setup.ts"]
  }
});
