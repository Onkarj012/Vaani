import type { InjectionResult } from "@shared/types";
import { nativeBridge } from "../nativeBridge";
import type { InjectionTarget } from "./index";
import { activateTargetApp, isExternalTarget } from "./target";
import type { InjectionGuard } from "./guard";
import { moveCaretAfterInsertion, readFocusedSelection } from "./caret";

export class AccessibilityTextInjector {
  isTrusted(): boolean {
    return nativeBridge.isAccessibilityTrusted?.() ?? false;
  }

  async inject(text: string, target?: InjectionTarget, guard: InjectionGuard = () => null, onDispatch?: () => void): Promise<InjectionResult> {
    if (!this.isTrusted()) {
      return { success: false, reason: "permission_missing" };
    }
    const blockedAtStart = guard();
    if (blockedAtStart) return { success: false, reason: blockedAtStart };

    let invoked = false;
    try {
      if (isExternalTarget(target) && await activateTargetApp(target)) {
        await delay(280);
      }

      // Use paste-fallback for multiline text — AX setValue flattens formatting
      if (text.includes("\n") || text.includes("\r")) {
        return { success: false, reason: "insertion_failed" };
      }

      // Protect existing multiline content in the field — clipboard paste
      // preserves structure while AX would destroy it.
      if (nativeBridge.getFocusedValue) {
        const existingValue = nativeBridge.getFocusedValue();
        if (existingValue && (existingValue.includes("\n") || existingValue.includes("\r"))) {
          return { success: false, reason: "insertion_failed" };
        }
      }

      const blocked = guard();
      if (blocked) return { success: false, reason: blocked };

      if (!nativeBridge.injectText) {
        return { success: false, reason: "insertion_failed" };
      }
      const insertionStart = readFocusedSelection()?.location ?? target?.selection?.location;
      invoked = true;
      const result = nativeBridge.injectText(text);
      // Native reports these before any write, so the field is untouched and fallback may run.
      if (result.reason === "no_editable_target") return { success: false, reason: "no_editable_target" };
      if (result.reason === "permission_missing") return { success: false, reason: "permission_missing" };

      onDispatch?.();
      if (guard()) return { success: false, reason: "outcome_uncertain" };
      if (result.success) {
        moveCaretAfterInsertion(text, insertionStart);
        return { success: true, method: "ax" };
      }
      return { success: false, reason: "outcome_uncertain" };
    } catch (_error) {
      if (!invoked) return { success: false, reason: "insertion_failed" };
      onDispatch?.();
      return { success: false, reason: "outcome_uncertain" };
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
