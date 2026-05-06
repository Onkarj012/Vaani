import { app } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { InjectionTarget } from "./index";
import { nativeBridge } from "../nativeBridge";

const exec = promisify(execFile);

function internalBundleIds(): Set<string> {
  const ids = new Set<string>(["com.claudevaani.app"]);
  if (!app.isPackaged) {
    ids.add("com.github.electron");
  }
  return ids;
}

function internalAppNames(): Set<string> {
  const names = new Set<string>(["claude vaani"]);
  const appName = app.getName()?.trim().toLowerCase();
  if (appName) {
    names.add(appName);
  }
  if (!app.isPackaged) {
    names.add("electron");
  }
  return names;
}

export function isExternalTarget(target?: InjectionTarget): boolean {
  if (!target) return false;
  const bundleId = target.appBundleId?.trim().toLowerCase() ?? "";
  const appName = target.appName?.trim().toLowerCase() ?? "";
  if (!bundleId && !appName) return false;
  return !internalBundleIds().has(bundleId) && !internalAppNames().has(appName);
}

export function buildActivateTargetScript(target?: InjectionTarget): string | null {
  if (!isExternalTarget(target)) return null;
  const bundleId = target?.appBundleId?.trim();
  const name = target?.appName?.trim();

  const lines: string[] = [];
  if (bundleId) {
    lines.push(`tell application id "${escapeAS(bundleId)}" to activate`);
  } else if (name) {
    lines.push(`tell application "${escapeAS(name)}" to activate`);
  }

  if (name) {
    lines.push('tell application "System Events"');
    lines.push(`if exists process "${escapeAS(name)}" then set frontmost of process "${escapeAS(name)}" to true`);
    lines.push("end tell");
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export function isTargetFrontmost(target?: InjectionTarget): boolean {
  if (!isExternalTarget(target)) {
    return false;
  }

  const current = nativeBridge.getFrontmostApplication?.();
  const currentBundleId = current?.bundleId?.trim().toLowerCase() ?? "";
  const currentName = current?.name?.trim().toLowerCase() ?? "";
  const targetBundleId = target?.appBundleId?.trim().toLowerCase() ?? "";
  const targetName = target?.appName?.trim().toLowerCase() ?? "";

  if (targetBundleId && currentBundleId) {
    return targetBundleId === currentBundleId;
  }

  if (targetName && currentName) {
    return targetName === currentName;
  }

  return false;
}

export async function activateTargetApp(target?: InjectionTarget): Promise<boolean> {
  if (isTargetFrontmost(target)) {
    return false;
  }

  const script = buildActivateTargetScript(target);
  if (!script) return false;
  try {
    await exec("osascript", ["-e", script]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch {
    return false;
  }
}

function escapeAS(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
