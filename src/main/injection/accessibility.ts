import type { InjectionFailureReason, InjectionResult } from "@shared/types";
import { nativeBridge } from "../nativeBridge";
import type { InjectionTarget } from "./index";
import { activateTargetApp, isExternalTarget } from "./target";

export class AccessibilityTextInjector {
  isTrusted(): boolean {
    return nativeBridge.isAccessibilityTrusted?.() ?? false;
  }

  async inject(text: string, target?: InjectionTarget): Promise<InjectionResult> {
    if (!this.isTrusted()) {
      return { success: false, reason: "permission_missing" };
    }

    try {
      let activationSucceeded = false;
      
      if (isExternalTarget(target)) {
        activationSucceeded = await activateTargetApp(target);
        if (activationSucceeded) {
          await delay(280);
        }
      }

      // CRITICAL: Re-read selection immediately before injection if activation succeeded
      // This ensures we have fresh caret position, not stale data from session start
      let freshSelection = target?.selection;
      if (activationSucceeded && nativeBridge.getFocusedSelection) {
        try {
          const currentSelection = nativeBridge.getFocusedSelection();
          if (currentSelection && Number.isFinite(currentSelection.location)) {
            // Only use fresh selection if it seems valid (not at position 0 when we expected elsewhere)
            const oldLocation = target?.selection?.location ?? 0;
            const newLocation = currentSelection.location;
            
            // If selection moved significantly or original was invalid, use fresh
            if (Math.abs(newLocation - oldLocation) > 10 || oldLocation === 0) {
              freshSelection = currentSelection;
            }
          }
        } catch (e) {
          // Could not re-read selection, proceed with original
        }
      }

      // If activation failed or selection is untrustworthy (0,0 in a non-empty field), suggest fallback
      const isSuspectSelection = freshSelection && freshSelection.location === 0 && freshSelection.length === 0;
      if (!activationSucceeded && isSuspectSelection) {
        return { success: false, reason: "activation_failed" };
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

      const result = nativeBridge.injectText?.(text);
      if (!result) {
        return { success: false, reason: "insertion_failed" };
      }

      if (typeof result === "boolean") {
        if (result) {
          return { success: true, method: "ax" };
        }
        return { success: false, reason: "insertion_failed" };
      }

      if (result.success) {
        return { success: true, method: "ax" };
      }

      return { success: false, reason: normalizeFailureReason(result.reason) };
    } catch (_error) {
      return { success: false, reason: "insertion_failed" };
    }
  }
}

function normalizeFailureReason(reason: string | undefined): InjectionFailureReason {
  if (reason === "permission_missing" || reason === "no_editable_target") {
    return reason;
  }
  return "insertion_failed";
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
