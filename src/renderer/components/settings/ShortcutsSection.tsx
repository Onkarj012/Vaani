import { Button } from "@renderer/components/ui/button";
import {
  HotkeyCapture,
  formatHotkeyLabel,
} from "@renderer/components/HotkeyCapture";
import { Kbd } from "@renderer/components/ui/Kbd";
import { Group, Row, type SectionComponentProps } from "./SettingsRows";

// Renders dictation and paste shortcut controls.
export default function ShortcutsSection({
  context: c,
}: SectionComponentProps) {
  const mode = c.settings.dictationMode;
  const dictateDescription =
    mode === "push-to-talk"
      ? "Hold to record, release to send."
      : mode === "toggle-double"
        ? "Hold to talk. Double-press to go hands-free."
        : "Press once to start, again to stop.";

  return (
    <Group title="Shortcuts">
      <Row title="Dictate" description={dictateDescription}>
        <div className="flex flex-wrap items-center gap-2">
          {c.hotkeyEditing === "primary" ? (
            <>
              <HotkeyCapture
                value={c.settings.primaryHotkey}
                onChange={(value) => {
                  void c.updateSettings({ primaryHotkey: value });
                  c.setHotkeyEditing(null);
                }}
              />
              <span className="text-[11px] text-muted">
                Press the new shortcut… Esc cancels
              </span>
            </>
          ) : (
            <>
              <Kbd>{formatHotkeyLabel(c.settings.primaryHotkey)}</Kbd>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => c.setHotkeyEditing("primary")}
              >
                Change
              </Button>
            </>
          )}
        </div>
      </Row>
      <p className="-mt-2 pb-3 text-[11px] text-muted">
        Fn key detection is hardware-dependent. Test after changing.
      </p>
      <Row
        title="Paste latest"
        description="Insert the most recent dictation again."
      >
        <div className="flex flex-wrap items-center gap-2">
          {c.hotkeyEditing === "paste" ? (
            <>
              <HotkeyCapture
                value={c.settings.pasteLatestHotkey}
                onChange={(value) => {
                  void c.updateSettings({ pasteLatestHotkey: value });
                  c.setHotkeyEditing(null);
                }}
              />
              <span className="text-[11px] text-muted">
                Press the new shortcut… Esc cancels
              </span>
            </>
          ) : (
            <>
              <Kbd>{formatHotkeyLabel(c.settings.pasteLatestHotkey)}</Kbd>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => c.setHotkeyEditing("paste")}
              >
                Change
              </Button>
            </>
          )}
        </div>
      </Row>
      <Row
        title="Cancel dictation"
        description="While recording, throws the clip away. Nothing is typed."
      >
        <Kbd>esc</Kbd>
      </Row>
    </Group>
  );
}
