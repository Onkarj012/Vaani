export type InjectionBlockReason = "cancelled" | "target_changed";

export interface InjectionOptions {
  signal?: AbortSignal;
  isTargetValid?: () => boolean;
}

export type InjectionGuard = () => InjectionBlockReason | null;

export function createInjectionGuard(options?: InjectionOptions): InjectionGuard {
  return () => {
    if (options?.signal?.aborted) return "cancelled";
    if (!options?.isTargetValid) return null;
    try {
      return options.isTargetValid() ? null : "target_changed";
    } catch {
      return "target_changed";
    }
  };
}
