import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { PermissionStatus } from "@shared/types";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import { formatHotkeyLabel } from "@renderer/components/HotkeyCapture";
import PageHeader from "@renderer/components/ui/PageHeader";
import { Card } from "@renderer/components/ui/card";
import { IconButton, Button } from "@renderer/components/ui/button";
import { Kbd, KbdGroup } from "@renderer/components/ui/Kbd";
import AppIcon from "@renderer/components/ui/AppIcon";
import MiniCapsule from "@renderer/components/ui/MiniCapsule";
import VaaniMark from "@renderer/components/ui/VaaniMark";
import { useSettingsPanel } from "@renderer/context/settings-panel";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import { useDictateTip } from "@renderer/hooks/useDictateTip";
import { deriveHomeStats } from "@renderer/lib/homeStats";
import { countWords } from "@renderer/lib/historyDerivations";
import { buildProof, summarizeProof } from "@renderer/lib/proofMarks";
import { proofSummaryText } from "@renderer/lib/listRows";

const APP_COLORS = [
  "#e3e3ff",
  "#ddeeff",
  "#e4f7cf",
  "#fbe1f6",
  "#ffe9e3",
  "#fff2bd",
];

// Draws a compact line chart for the two-week word count.
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * 84},${30 - (value / max) * 26}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 84 34"
      aria-label="Words per day over the last 14 days"
      role="img"
      className="absolute right-4 top-4 h-[34px] w-[84px] text-[#1d1d1d]/80"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Shows the main Home dashboard and the setup actions that still apply.
export default function Dashboard() {
  const {
    historyEntries,
    historyItems,
    copyHistoryEntry,
    deleteHistoryEntry,
    settings,
    updateSettings,
  } = useVaaniUi();
  const settingsPanel = useSettingsPanel();
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: "unknown",
    accessibility: "unknown",
  });
  const [busyPermission, setBusyPermission] = useState<
    keyof PermissionStatus | null
  >(null);
  const tip = useDictateTip(historyEntries.length);
  const recentItems = useMemo(() => {
    const options = {
      fillers: [...settings.fillerWords, ...settings.extraFillerWords],
      corrections: settings.customCorrections,
    };
    return historyItems.slice(0, 4).map((item) => {
      const entry = historyEntries.find((candidate) => candidate.id === item.id);
      const changes = entry ? proofSummaryText(summarizeProof(buildProof(entry.rawText, entry.cleanedText, options))) : "";
      return { ...item, changes };
    });
  }, [historyItems, historyEntries, settings.fillerWords, settings.extraFillerWords, settings.customCorrections]);
  const now = new Date();
  const stats = useMemo(
    () => deriveHomeStats(historyEntries, now),
    [historyEntries],
  );
  const today = historyEntries.filter((entry) => {
    const date = new Date(entry.timestamp);
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  });
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const hasEarlierHistory = historyEntries.some(
    (entry) => new Date(entry.timestamp).getTime() < startOfToday,
  );
  const appUsage = useMemo(() => {
    const apps = new Map<string, { bundleId: string | null; words: number }>();
    today.forEach((entry) => {
      const name = entry.appName?.trim() || "Unknown";
      const current = apps.get(name) ?? {
        bundleId: entry.appBundleId,
        words: 0,
      };
      current.words += countWords(entry.cleanedText);
      apps.set(name, current);
    });
    return [...apps.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.words - a.words);
  }, [today]);

  useEffect(() => {
    // Loads the current macOS permission states and listens for updates.
    const refresh = () => {
      void window.vaani.getPermissionStatus().then(setPermissions);
    };
    refresh();
    const unsubscribe =
      window.vaani.onPermissionStatusChanged?.(setPermissions);
    return () => unsubscribe?.();
  }, []);

  // Requests permission or opens the matching macOS settings pane.
  async function grantPermission(
    permission: keyof PermissionStatus,
  ): Promise<void> {
    if (busyPermission) return;
    setBusyPermission(permission);
    try {
      const current = permissions[permission];
      const next =
        current === "not-determined" ||
        (permission === "accessibility" && current === "denied")
          ? permission === "microphone"
            ? await window.vaani.requestMicrophonePermission()
            : await window.vaani.requestAccessibilityPermission()
          : current;
      setPermissions((value) => ({ ...value, [permission]: next }));
      if (next !== "granted")
        await window.vaani.openPermissionSettings(permission);
    } finally {
      setBusyPermission(null);
    }
  }

  const provider = KNOWN_PROVIDERS.find(
    (item) =>
      item.id === settings.transcriptionProvider &&
      (item.type === "stt" || item.type === "local-stt"),
  );
  const providerReady =
    provider?.requiresApiKey === false ||
    settings.providerApiKeys.some(
      (key) =>
        key.providerId === settings.transcriptionProvider &&
        key.hasKey === true,
    );
  const setup = [
    { label: "Microphone access", done: permissions.microphone === "granted" },
    {
      label: "Accessibility access",
      done: permissions.accessibility === "granted",
    },
    { label: "Transcription provider key", done: providerReady },
    { label: "Launch at login", done: settings.launchAtLogin },
  ];
  const setupDone = setup.filter((item) => item.done).length;
  const missingPermissions = (
    Object.keys(permissions) as Array<keyof PermissionStatus>
  ).filter((key) => permissions[key] !== "granted");
  const showSetup =
    !settings.setupChecklistDismissed && setupDone < setup.length;
  const hasSideCards = showSetup || missingPermissions.length > 0;
  const hour = now.getHours();
  const greeting =
    historyEntries.length === 0
      ? "Welcome to Vaani."
      : hour < 12
        ? "Good morning."
        : hour < 18
          ? "Good afternoon."
          : "Good evening.";
  const dateLabel = `${now.toLocaleDateString("en-GB", { weekday: "long" })}, ${now.getDate()} ${now.toLocaleDateString("en-GB", { month: "long" })}`;
  const hotkey = formatHotkeyLabel(settings.primaryHotkey);
  const pasteHotkey = formatHotkeyLabel(settings.pasteLatestHotkey);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow={dateLabel}
        title={greeting}
        subtitle={`Hold ${hotkey} anywhere to dictate. Vaani types where your cursor is.`}
      />

      <div className="mb-[14px] grid grid-cols-2 gap-[14px] @min-[821px]/main:grid-cols-4">
        <StatCard
          tone="butter"
          label="Words today"
          value={stats.wordsToday.toLocaleString()}
          sub={hasEarlierHistory ? "" : "Your first day"}
          spark={stats.days.map((day) => day.words)}
        />
        <StatCard
          tone="mint"
          label="Dictations today"
          value={String(stats.sessionsToday)}
          sub={`${stats.insertedToday} inserted, ${stats.savedToday} saved`}
        />
        <StatCard
          tone="sky"
          label="Time saved"
          value={`${stats.timeSavedMinutes}`}
          unit="min"
          sub="vs typing at 45 wpm"
        />
        <StatCard
          tone="blush"
          label="Speaking pace"
          value={`${stats.speakingPace}`}
          unit="wpm"
          sub={`${stats.streak}-day streak`}
        />
      </div>

      <div className="grid grid-cols-12 gap-[14px]">
        {tip.visible && (
          <HowToCard
            hotkey={hotkey}
            pasteHotkey={pasteHotkey}
            mode={settings.dictationMode}
            remaining={tip.remaining}
            tipMode={tip.mode}
            onHide={() => tip.setVisible(false)}
          />
        )}
        <div
          className={`col-span-12 grid min-w-0 gap-[14px] ${hasSideCards ? "@min-[861px]/main:col-span-8" : "@min-[861px]/main:col-span-12"}`}
        >
          <RecentCard
            entries={recentItems}
            copy={copyHistoryEntry}
            remove={deleteHistoryEntry}
          />
          <WhereCard apps={appUsage} words={stats.wordsToday} />
        </div>
        {hasSideCards && (
          <div className="col-span-12 grid content-start gap-[14px] @min-[861px]/main:col-span-4 @min-[861px]/main:grid-cols-1 @max-[860px]/main:grid-cols-2">
            {showSetup && (
              <SetupCard
                items={setup}
                done={setupDone}
                onLaunch={() => {
                  void updateSettings({ launchAtLogin: true });
                }}
                onGrant={(permission) => {
                  void grantPermission(permission);
                }}
                onProvider={() => settingsPanel.open("api")}
              />
            )}
            {missingPermissions.length > 0 && (
              <PermissionsCard
                missing={missingPermissions}
                status={permissions}
                busy={busyPermission}
                onGrant={grantPermission}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Renders a pastel statistic tile with an optional sparkline.
function StatCard({
  tone,
  label,
  value,
  unit,
  sub,
  spark,
}: {
  tone: "butter" | "mint" | "sky" | "blush";
  label: string;
  value: string;
  unit?: string;
  sub: string;
  spark?: number[];
}) {
  return (
    <Card
      tone={tone}
      bordered={false}
      className="relative flex min-h-[134px] flex-col overflow-hidden p-5 text-[#1d1d1d]"
    >
      <span className="label-meta text-[10px] text-[#1d1d1d]/70">{label}</span>
      {spark && <Sparkline values={spark} />}
      <div className="mt-auto font-display text-[46px] font-extrabold leading-none tracking-[-.04em]">
        {value}
        {unit && (
          <small className="ml-1 text-[18px] tracking-tight">{unit}</small>
        )}
      </div>
      <div className="mt-1.5 min-h-[18px] truncate text-xs text-[#1d1d1d]/65">
        {sub}
      </div>
    </Card>
  );
}

// Shows the first-use dictation instructions and settings-aware hotkeys.
function HowToCard({
  hotkey,
  pasteHotkey,
  mode,
  remaining,
  tipMode,
  onHide,
}: {
  hotkey: string;
  pasteHotkey: string;
  mode: string;
  remaining: number;
  tipMode: string;
  onHide: () => void;
}) {
  return (
    <Card
      tone="lav"
      bordered={false}
      className="relative col-span-12 grid overflow-hidden p-6 text-[#1d1d1d] @min-[721px]/main:grid-cols-2 @min-[721px]/main:gap-x-10"
    >
      <VaaniMark
        size={265}
        className="pointer-events-none absolute -bottom-24 left-[40%] text-[#1d1d1d]/[.06]"
      />
      <div>
        <div className="label-meta text-[10px] text-[#1d1d1d]/65">
          How to dictate
        </div>
        <h2 className="mt-3 font-display text-[44px] font-extrabold leading-[.98] tracking-[-.035em]">
          Hold <Kbd className="align-[.12em]">{hotkey}</Kbd>,<br />
          speak, let go.
        </h2>
      </div>
      <div className="relative mt-5 @min-[721px]/main:mt-0">
        <p className="max-w-[430px] text-[13.5px] leading-relaxed text-[#1d1d1d]/75">
          Vaani types cleaned-up text wherever your cursor is.{" "}
          {mode === "toggle-double" && (
            <>
              Double-press <Kbd>{hotkey}</Kbd> for hands-free.{" "}
            </>
          )}
          Press{" "}
          <KbdGroup>
            <Kbd>{pasteHotkey}</Kbd>
          </KbdGroup>{" "}
          to paste your latest dictation.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <MiniCapsule state="rec" />
          <span className="text-[11px] text-muted">
            This capsule sits at the bottom of your screen
          </span>
        </div>
      </div>
      <div className="relative col-span-full mt-5 flex flex-wrap items-center gap-3 border-t border-dashed border-[#1d1d1d]/20 pt-4">
        {tipMode === "auto" && (
          <span
            className="flex gap-1"
            aria-label={`${5 - remaining} of 5 dictations`}
            role="img"
          >
            {[1, 2, 3, 4, 5].map((pip) => (
              <i
                key={pip}
                className={`h-1.5 w-[18px] rounded-full ${pip <= 5 - remaining ? "bg-[#1d1d1d]" : "bg-[#1d1d1d]/15"}`}
              />
            ))}
          </span>
        )}
        <span className="text-xs text-[#1d1d1d]/70">
          {tipMode === "auto"
            ? `Shows for your first 5 dictations, then hides. ${remaining} left.`
            : "You turned this card back on in Settings › Appearance."}
        </span>
        <Button
          size="sm"
          variant="default"
          className="ml-auto"
          onClick={onHide}
        >
          Got it, hide this
        </Button>
      </div>
    </Card>
  );
}

// Lists the latest dictations with the existing copy and delete actions.
function RecentCard({
  entries,
  copy,
  remove,
}: {
  entries: Array<{
    id: string;
    text: string;
    time: string;
    app: string;
    wordCount: number;
    changes: string;
  }>;
  copy: (text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="font-display text-[22px] font-bold text-ink">
          Recent dictations
        </h2>
        <Link
          className="text-xs font-semibold text-accent hover:underline"
          to="/app/history"
        >
          Open History →
        </Link>
      </div>
      {entries.length ? (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="group grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-2 py-3 hover:bg-surface"
          >
            <AppIcon name={entry.app} size={32} />
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm leading-relaxed text-ink">
                {entry.text.split("\n")[0]}
              </p>
              <div className="mt-1 text-xs text-muted">
                {entry.app} · {entry.time} · {entry.wordCount} words
                {entry.changes && <span className="text-accent"> · ✎ {entry.changes}</span>}
              </div>
            </div>
            <div className="flex opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
              <IconButton
                title="Copy dictation"
                aria-label="Copy dictation"
                onClick={() => {
                  void copy(entry.text);
                }}
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                title="Delete dictation"
                aria-label="Delete dictation"
                className="hover:bg-red-500/10 hover:text-red-600"
                onClick={() => {
                  void remove(entry.id);
                }}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          </div>
        ))
      ) : (
        <p className="px-3 py-7 text-sm text-muted">
          Your recent dictations will show up here.
        </p>
      )}
    </Card>
  );
}

// Shows the share of today's words dictated in each app.
function WhereCard({
  apps,
  words,
}: {
  apps: Array<{ name: string; bundleId: string | null; words: number }>;
  words: number;
}) {
  const total = apps.reduce((sum, app) => sum + app.words, 0);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[22px] font-bold text-ink">
          Where you dictate
        </h2>
        <span className="label-meta text-[10px] text-muted">
          Today · {words.toLocaleString()} words
        </span>
      </div>
      {apps.length ? (
        <>
          <div className="my-4 flex h-3 gap-[3px] overflow-hidden rounded-full">
            {apps.map((app, index) => (
              <i
                key={app.name}
                style={{
                  flex: app.words,
                  backgroundColor: APP_COLORS[index % APP_COLORS.length],
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 @min-[641px]/main:grid-cols-3">
            {apps.map((app) => (
              <div key={app.name} className="flex min-w-0 items-center gap-2.5">
                <AppIcon name={app.name} bundleId={app.bundleId} size={30} />
                <div className="min-w-0">
                  <b className="block truncate text-[13px] text-ink">
                    {app.name}
                  </b>
                  <small className="text-xs text-muted">
                    {Math.round((app.words / Math.max(total, 1)) * 100)}% ·{" "}
                    {app.words} words
                  </small>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">No dictations today yet.</p>
      )}
    </Card>
  );
}

// Lists setup steps and keeps each action tied to existing settings.
function SetupCard({
  items,
  done,
  onLaunch,
  onGrant,
  onProvider,
}: {
  items: Array<{ label: string; done: boolean }>;
  done: number;
  onLaunch: () => void;
  onGrant: (permission: keyof PermissionStatus) => void;
  onProvider: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold text-ink">Setup</h2>
        <span className="label-meta text-[10px] text-muted">
          {done} of {items.length}
        </span>
      </div>
      <div className="my-3 grid grid-cols-4 gap-1">
        {items.map((item) => (
          <i
            key={item.label}
            className={`h-1.5 rounded-full ${item.done ? "bg-accent" : "bg-surface"}`}
          />
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-h-10 items-center gap-2.5 text-[13px]"
        >
          <span
            className={`grid size-[18px] shrink-0 place-items-center rounded-full ${item.done ? "bg-mint text-green-800" : "border border-dashed border-faint"}`}
          >
            {item.done && <Check size={11} />}
          </span>
          <span
            className={`min-w-0 truncate ${item.done ? "text-muted" : "text-ink"}`}
          >
            {item.label}
          </span>
          {!item.done &&
            (item.label === "Launch at login" ? (
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                onClick={onLaunch}
              >
                Turn on
              </Button>
            ) : item.label === "Transcription provider key" ? (
              <Button size="sm" className="ml-auto" onClick={onProvider}>
                Add key
              </Button>
            ) : (
              <Button
                size="sm"
                className="ml-auto"
                onClick={() =>
                  onGrant(
                    item.label.startsWith("Microphone")
                      ? "microphone"
                      : "accessibility",
                  )
                }
              >
                Grant
              </Button>
            ))}
        </div>
      ))}
    </Card>
  );
}

// Shows only permissions that macOS has not granted yet.
function PermissionsCard({
  missing,
  status,
  busy,
  onGrant,
}: {
  missing: Array<keyof PermissionStatus>;
  status: PermissionStatus;
  busy: keyof PermissionStatus | null;
  onGrant: (permission: keyof PermissionStatus) => Promise<void>;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-2 font-display text-xl font-bold text-ink">
        Permissions
      </h2>
      {missing.map((permission) => (
        <div key={permission} className="flex items-center gap-3 py-2">
          <span className="grid size-7 place-items-center rounded-[9px] bg-peach text-[#a2462c]">
            {permission === "microphone" ? (
              <Mic size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-[13px] font-semibold text-ink">
              {permission === "microphone" ? "Microphone" : "Accessibility"}
            </b>
            <small className="text-xs text-muted">
              {status[permission] === "denied"
                ? "Access is off"
                : "Access is needed"}
            </small>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void onGrant(permission);
            }}
            disabled={busy === permission}
          >
            Grant
          </Button>
        </div>
      ))}
    </Card>
  );
}
