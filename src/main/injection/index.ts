import type { InjectionResult, SelectionRange, Settings } from "@shared/types";
import { AccessibilityTextInjector } from "./accessibility";
import { ClipboardTextInjector } from "./clipboard";
import {
  isClipboardOnlyTarget,
  shouldPreferClipboardInjection,
  type InjectionTargetLike
} from "./policy";

export interface InjectionTarget extends InjectionTargetLike {
  selection?: SelectionRange | null;
  activationSucceeded?: boolean;  // Track if app activation succeeded (affects caret restoration)
}

export class TextInjector {
  private readonly ax = new AccessibilityTextInjector();
  private readonly clip = new ClipboardTextInjector();

  constructor(private readonly settingsProvider: () => Settings) {}

  async inject(text: string, target?: InjectionTarget): Promise<InjectionResult> {
    const { injectionMode } = this.settingsProvider();

    if (injectionMode === "ax") {
      return this.ax.inject(text, target);
    }

    if (injectionMode === "clipboard") {
      return this.clip.inject(text, target);
    }

    if (shouldPreferClipboardInjection(text, target)) {
      const clipboardResult = await this.clip.inject(text, target);
      if (clipboardResult.success || isClipboardOnlyTarget(target)) {
        return clipboardResult;
      }

      const axResult = await this.ax.inject(text, target);
      return axResult.success ? axResult : clipboardResult;
    }

    const axResult = await this.ax.inject(text, target);
    if (axResult.success) {
      return axResult;
    }

    const clipboardResult = await this.clip.inject(text, target);
    if (clipboardResult.success) {
      return clipboardResult;
    }

    return axResult.reason === "no_editable_target" ? axResult : clipboardResult;
  }
}
