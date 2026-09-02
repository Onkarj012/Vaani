import type { RecoveryRestoredNotice } from "@shared/recovery";

export interface RecoveryNoticeState {
  deliveredBatch: string | null;
}

export function consumeRestoredRecoveryNotice(ids: readonly string[], state: RecoveryNoticeState): RecoveryRestoredNotice | null {
  const uniqueIds = [...new Set(ids)].filter((id) => id.length > 0);
  if (uniqueIds.length === 0) return null;
  const batch = [...uniqueIds].sort().join("\u0000");
  if (state.deliveredBatch === batch) return null;
  state.deliveredBatch = batch;
  return { entryIds: uniqueIds, count: uniqueIds.length };
}
