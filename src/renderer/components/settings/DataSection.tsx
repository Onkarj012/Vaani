import { Download, RefreshCw, Trash2 } from "lucide-react";
import { DataAction, Group, type SectionComponentProps } from "./SettingsRows";

// Renders history counts and existing data actions.
export default function DataSection({ context: c }: SectionComponentProps) {
  const oldestTimestamp = c.historyEntries.reduce<number | null>(
    (oldest, entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return oldest === null || timestamp < oldest ? timestamp : oldest;
    },
    null,
  );
  const oldestEntry =
    oldestTimestamp === null
      ? "None yet"
      : new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(oldestTimestamp));

  return (
    <>
      <div
        data-setting-row
        className="grid grid-cols-2 gap-2 py-3 @max-[600px]/pane:grid-cols-1"
      >
        <div className="rounded-[16px] bg-surface p-3">
          <span className="text-[11px] text-muted">Dictations stored</span>
          <b className="mt-1 block text-[14px]">{c.historyEntries.length}</b>
        </div>
        <div className="rounded-[16px] bg-surface p-3">
          <span className="text-[11px] text-muted">Oldest entry</span>
          <b className="mt-1 block text-[14px]">{oldestEntry}</b>
        </div>
      </div>
      <Group title="Your data">
        <div className="grid gap-2">
          <DataAction
            icon={<Download size={15} />}
            title="Export history"
            description="JSON with settings and dictations."
            actionLabel="Export…"
            onClick={c.exportHistory}
          />
          <DataAction
            icon={<Trash2 size={15} />}
            title="Clear history"
            description="Deletes every dictation."
            actionLabel="Clear"
            onClick={() => void c.clearHistory()}
          />
          <DataAction
            icon={<RefreshCw size={15} />}
            title="Reset all settings"
            description="Restores default settings and clears saved API key values. History stays."
            actionLabel="Reset"
            onClick={() => void c.resetSettings()}
          />
        </div>
      </Group>
    </>
  );
}
