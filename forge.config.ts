import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { PublisherGithub } from "@electron-forge/publisher-github";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const config: ForgeConfig = {
  hooks: {
    postMake: async (_forgeConfig, makeResults) => {
      execFileSync(process.execPath, [join(__dirname, "scripts", "generate-latest-mac-yml.js")], {
        stdio: "inherit"
      });

      const makeRoot = join(__dirname, "out", "make");
      const latestMacYml = findLatestMacYml(makeRoot);
      if (!latestMacYml) return makeResults;

      for (const result of makeResults) {
        const hasMacZip = result.artifacts.some((artifact) =>
          artifact.endsWith(".zip") && dirname(artifact) === dirname(latestMacYml)
        );
        if (hasMacZip && !result.artifacts.includes(latestMacYml)) {
          result.artifacts.push(latestMacYml);
        }
      }

      return makeResults;
    }
  },
  packagerConfig: {
    asar: true,
    appBundleId: "com.onkarj012.vaani",
    appCategoryType: "public.app-category.productivity",
    icon: "assets/icon",
    name: "Vaani",
    executableName: "Vaani",
    appCopyright: "© 2026 Onkarj012",
    darwinDarkModeSupport: true,
    extendInfo: {
      NSMicrophoneUsageDescription: "Vaani uses the microphone to record your speech for dictation.",
    },
    // Copy native module to the packaged app
    extraResource: [
      join(__dirname, "build", "Release", "vaani_native.node"),
      join(__dirname, "assets", "iconset", "trayTemplate.png"),
      join(__dirname, "assets", "iconset", "trayTemplate@2x.png"),
    ],
    osxSign: {
      identity: process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? "Developer ID Application"
        : "-",
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: () => ({
        entitlements: "entitlements.plist",
        hardenedRuntime: true
      })
    },
    osxNotarize: process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID ? {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    } : undefined
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({
      format: "ULFO"
    })
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: "Onkarj012", name: "Vaani" },
      prerelease: false,
      draft: true
    })
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" },
        { entry: "src/preload/overlay.ts", config: "vite.overlay-preload.config.ts", target: "preload" },
        { entry: "src/preload/recorder.ts", config: "vite.recorder-preload.config.ts", target: "preload" }
      ],
      renderer: [
        { name: "main_window", config: "vite.renderer.config.ts" },
        { name: "overlay_window", config: "vite.overlay.config.ts" },
        { name: "recorder_window", config: "vite.recorder.config.ts" }
      ]
    })
  ]
};

export default config;

function findLatestMacYml(makeRoot: string): string | null {
  const candidates = walkFiles(makeRoot)
    .filter((file) => file.endsWith("latest-mac.yml"))
    .sort((left, right) => {
      return statSync(right).mtimeMs - statSync(left).mtimeMs;
    });
  return candidates[0] ?? null;
}

function walkFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...walkFiles(fullPath));
    } else {
      entries.push(fullPath);
    }
  }
  return entries;
}
