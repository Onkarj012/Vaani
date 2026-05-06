import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { PublisherGithub } from "@electron-forge/publisher-github";
import { join } from "node:path";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.claudevaani.app",
    appCategoryType: "public.app-category.productivity",
    icon: "assets/icon",
    name: "Vaani",
    executableName: "Vaani",
    appCopyright: "© 2025 Anthropic",
    darwinDarkModeSupport: true,
    // Copy native module to the packaged app
    extraResource: [
      join(__dirname, "build", "Release", "vaani_native.node")
    ],
    // Code signing configuration - uncomment and fill in when ready
    // osxSign: {
    //   identity: 'Developer ID Application: YOUR_NAME (TEAM_ID)',
    //   hardenedRuntime: true,
    //   gatekeeperAssess: false,
    //   entitlements: 'entitlements.plist',
    //   entitlementsInherit: 'entitlements.plist'
    // },
    // osxNotarize: {
    //   tool: 'notarytool',
    //   appleId: process.env.APPLE_ID || '',
    //   appleIdPassword: process.env.APPLE_PASSWORD || '',
    //   teamId: process.env.APPLE_TEAM_ID || ''
    // }
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
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" }
      ],
      renderer: [
        { name: "main_window", config: "vite.renderer.config.ts" }
      ]
    })
  ]
};

export default config;
