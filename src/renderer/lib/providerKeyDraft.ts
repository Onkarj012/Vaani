/** A blank redacted renderer value means "leave the saved credential alone". */
export function shouldSaveProviderKeyOnBlur(value: string): boolean {
  return value.trim().length > 0;
}

export type ProviderKeyExit = "blur" | "cancel";
export type ProviderKeyDraftDecision = "preserve" | "save";

export function decideProviderKeyDraft(value: string, exit: ProviderKeyExit): ProviderKeyDraftDecision {
  return exit === "cancel" || !shouldSaveProviderKeyOnBlur(value) ? "preserve" : "save";
}
