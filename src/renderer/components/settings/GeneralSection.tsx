import { RefreshCw } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Tag } from "@renderer/components/ui/tag";
import { Toggle } from "@renderer/components/ui/toggle";
import { Group, Row, type SectionComponentProps } from "./SettingsRows";

// Renders startup, account and update settings.
export default function GeneralSection({ context: c }: SectionComponentProps) {
  const status = c.updateStatus;
  const message =
    status.status === "checking"
      ? "Checking for updates…"
      : status.status === "available"
        ? status.message
        : status.status === "downloading"
          ? status.message || "Downloading update…"
          : status.status === "ready"
            ? "An update is ready to install."
            : status.status === "error"
              ? status.message
              : status.available === false
                ? "Vaani is up to date."
                : "Check for the latest version.";

  return (
    <>
      <Group title="Account">
        <div
          data-setting-row
          className="flex items-center gap-4 border-b border-line py-4"
        >
          <div className="min-w-0 flex-1">
            <b className="text-[14px]">Sync across Macs</b>{" "}
            <Tag tone="lav">Coming soon</Tag>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">
              Sync stays off until you can sign in. It will include your
              dictionary, snippets and settings. History and recordings will not
              sync.
            </p>
          </div>
          <button
            type="button"
            disabled
            aria-label="Sign in, coming soon"
            className="h-9 rounded-full border border-line px-4 text-[13px] font-semibold text-muted"
          >
            Sign in
          </button>
        </div>
        <Row
          title="Launch at login"
          description="Start Vaani when you log in to your Mac."
        >
          <Toggle
            checked={c.settings.launchAtLogin}
            onChange={(value) =>
              void c.updateSettings({ launchAtLogin: value })
            }
          />
        </Row>
        <Row
          title="Show in Dock"
          description="Off keeps Vaani in the menu bar only."
        >
          <Toggle
            checked={c.settings.showInDock}
            onChange={(value) => void c.updateSettings({ showInDock: value })}
          />
        </Row>
      </Group>
      <Group title="Updates">
        <div
          data-setting-row
          className={`my-2 flex flex-wrap items-center gap-4 rounded-[18px] p-4 ${status.status === "ready" ? "bg-accent/10" : "bg-surface"}`}
        >
          <div className="min-w-0 flex-1">
            <span className="label-meta text-[10px] text-faint">
              VAANI FOR MAC
            </span>
            <b className="text-display mt-1 block text-[23px]">
              {c.version || "—"}
            </b>
            <p className="text-[12px] text-muted">{message}</p>
          </div>
          {status.status === "ready" ? (
            <Button
              size="sm"
              variant="accent"
              onClick={() => void c.restartAndInstall()}
            >
              Restart to update
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void c.checkForUpdates()}
              disabled={
                status.status === "checking" || status.status === "downloading"
              }
            >
              <RefreshCw
                size={14}
                className={status.status === "checking" ? "animate-spin" : ""}
              />{" "}
              Check now
            </Button>
          )}
        </div>
      </Group>
    </>
  );
}
