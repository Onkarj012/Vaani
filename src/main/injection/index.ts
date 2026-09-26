import type { InjectionResult, SelectionRange, Settings } from "@shared/types";
import { AccessibilityTextInjector } from "./accessibility";
import { ClipboardTextInjector } from "./clipboard";
import { createInjectionGuard, type InjectionOptions } from "./guard";
import {
  isClipboardOnlyTarget,
  shouldPreferClipboardInjection,
  type InjectionTargetLike
} from "./policy";

export interface InjectionTarget extends InjectionTargetLike {
  selection?: SelectionRange | null;
  activationSucceeded?: boolean;  // Track if app activation succeeded (affects caret restoration)
}

export type { InjectionOptions } from "./guard";

export class TextInjector {
  private readonly ax = new AccessibilityTextInjector();
  private readonly clip = new ClipboardTextInjector();

  constructor(private readonly settingsProvider: () => Settings) {}

  async inject(text: string, target?: InjectionTarget, options?: InjectionOptions): Promise<InjectionResult> {
    const guard = createInjectionGuard(options);
    const blocked = guard();
    if (blocked) return { success: false, reason: blocked };

    const { injectionMode } = this.settingsProvider();

    if (injectionMode === "ax") {
      return this.ax.inject(text, target, guard);
    }

    if (injectionMode === "clipboard") {
      return this.clip.inject(text, target, guard);
    }

    if (shouldPreferClipboardInjection(text, target)) {
      const clipboardResult = await this.clip.inject(text, target, guard);
      if (clipboardResult.success || isFinalFailure(clipboardResult) || isClipboardOnlyTarget(target)) {
        return clipboardResult;
      }

      const axResult = await this.ax.inject(text, target, guard);
      return axResult.success || isFinalFailure(axResult) ? axResult : clipboardResult;
    }

    const axResult = await this.ax.inject(text, target, guard);
    if (axResult.success || isFinalFailure(axResult)) {
      return axResult;
    }

    const clipboardResult = await this.clip.inject(text, target, guard);
    if (clipboardResult.success || isFinalFailure(clipboardResult)) {
      return clipboardResult;
    }

    return axResult.reason === "no_editable_target" ? axResult : clipboardResult;
  }
}

// Cancellation, a changed target, or an uncertain dispatch must never fall
// through to another strategy: that is how text lands twice or in the wrong app.
export function isFinalFailure(result: InjectionResult): boolean {
  return !result.success
    && (result.reason === "cancelled" || result.reason === "target_changed" || result.reason === "outcome_uncertain");
}
