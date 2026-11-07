import { Mic, ShieldCheck } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Tag } from "@renderer/components/ui/tag";
import { Group } from "./SettingsRows";
import type { SectionComponentProps } from "./SettingsRows";

// Renders the microphone and accessibility permissions.
export default function PermissionsSection({
  context: c,
}: SectionComponentProps) {
  return (
    <>
      <Group title="macOS permissions">
        {(["microphone", "accessibility"] as const).map((permission) => {
          const granted = c.permissions[permission] === "granted";
          const title =
            permission === "microphone" ? "Microphone" : "Accessibility";
          const detail =
            permission === "microphone"
              ? "Vaani needs microphone access to hear your dictation. Audio is processed by your chosen provider."
              : "Vaani needs Accessibility access to insert text into the active app.";
          const Icon = permission === "microphone" ? Mic : ShieldCheck;
          return (
            <div
              data-setting-row
              key={permission}
              className={`my-2 flex flex-wrap items-center gap-3 rounded-[18px] bg-surface p-3 ${granted ? "" : "border border-peach"}`}
            >
              <span
                className={`grid size-[34px] place-items-center rounded-[11px] ${granted ? "bg-mint text-[#2c6b1b]" : "bg-peach text-[#a2462c]"}`}
              >
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <b className="text-[13px]">{title}</b>
                <p className="text-[11.5px] text-muted">{detail}</p>
              </div>
              <Tag tone={granted ? "mint" : "peach"}>
                <span
                  className={`mr-1 inline-block size-1.5 rounded-full ${granted ? "bg-[#3fbf7f]" : "bg-[#e69a84]"}`}
                />
                {granted ? "Granted" : "Not granted"}
              </Tag>
              <Button
                size="sm"
                variant="ghost"
                disabled={c.permissionsBusy === permission}
                onClick={() => void c.permissionAction(permission)}
              >
                {granted ? "Open" : "Grant access"}
              </Button>
            </div>
          );
        })}
      </Group>
      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        Vaani checks these again each time you come back to it. Turning one off
        in System Settings takes effect right away.
      </p>
    </>
  );
}
