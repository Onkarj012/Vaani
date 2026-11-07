import {
  Database,
  Globe,
  Keyboard,
  Mic,
  Monitor,
  Palette,
  Plug,
  ShieldCheck,
  Type,
} from "lucide-react";
import type { SettingsSectionId } from "@renderer/context/settings-panel";

export const settingsSections: {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof Monitor;
}[] = [
  {
    id: "general",
    label: "General",
    description: "Startup, the Dock and updates.",
    icon: Monitor,
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "What Vaani needs from macOS, and why.",
    icon: ShieldCheck,
  },
  {
    id: "api",
    label: "API and providers",
    description: "Keys, local models and which model does what.",
    icon: Plug,
  },
  {
    id: "language",
    label: "Language",
    description: "What you speak, per app, and how it gets cleaned up.",
    icon: Globe,
  },
  {
    id: "dictation",
    label: "Dictation",
    description: "How recording starts and stops, and how audio is captured.",
    icon: Mic,
  },
  {
    id: "hotkey",
    label: "Shortcuts",
    description: "Keys that work in every app.",
    icon: Keyboard,
  },
  {
    id: "injection",
    label: "Insertion",
    description: "How text lands where your cursor is.",
    icon: Type,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, accent colour and Home cards.",
    icon: Palette,
  },
  {
    id: "data",
    label: "Data",
    description: "Export, clear or reset what Vaani stores.",
    icon: Database,
  },
];
