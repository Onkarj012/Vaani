import { useMemo, useState } from "react";
import PageHeader from "@renderer/components/ui/PageHeader";
import { Card } from "@renderer/components/ui/card";
import { Segmented } from "@renderer/components/ui/Segmented";
import AppIcon from "@renderer/components/ui/AppIcon";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import { countWords } from "@renderer/lib/historyDerivations";
import {
  deriveAppUsage,
  derivePeakHours,
  deriveRollingAverage,
  deriveWordsPerDay,
} from "@renderer/lib/homeStats";
import type { DictationEntry } from "@shared/types";

type Range = 7 | 30 | 90;
const RANGE_OPTIONS = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

// Returns the start of the local calendar day containing a date.
function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Returns the greatest run of consecutive active days in the selected range.
function bestStreak(entries: DictationEntry[], now: Date): number {
  const active = new Set(
    entries.map((entry) => {
      const date = dayStart(new Date(entry.timestamp));
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }),
  );
  let best = 0;
  let current = 0;
  for (let offset = 89; offset >= 0; offset -= 1) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - offset,
    );
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (active.has(key)) {
      current += 1;
      best = Math.max(best, current);
    } else current = 0;
  }
  return best;
}

// Selects dictations inside the requested rolling range.
function filterRange(
  entries: DictationEntry[],
  range: Range,
  now: Date,
): DictationEntry[] {
  const start = dayStart(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - range + 1),
  ).getTime();
  return entries.filter(
    (entry) =>
      new Date(entry.timestamp).getTime() >= start &&
      new Date(entry.timestamp).getTime() <= now.getTime(),
  );
}

// Shows range totals, app use, peak hours, and daily activity.
export default function Insights() {
  const { historyEntries } = useVaaniUi();
  const [range, setRange] = useState<Range>(30);
  const now = new Date();
  const entries = useMemo(
    () => filterRange(historyEntries, range, now),
    [historyEntries, range],
  );
  const days = useMemo(
    () => deriveWordsPerDay(entries, range, now),
    [entries, range],
  );
  const hours = useMemo(() => derivePeakHours(entries), [entries]);
  const apps = useMemo(() => deriveAppUsage(entries), [entries]);
  const rolling = useMemo(() => deriveRollingAverage(days), [days]);
  const words = entries.reduce(
    (sum, entry) => sum + countWords(entry.cleanedText),
    0,
  );
  const average = entries.length ? Math.round(words / entries.length) : 0;
  const currentStreak = (() => {
    const daysSet = new Set(
      entries.map((entry) =>
        dayStart(new Date(entry.timestamp)).toDateString(),
      ),
    );
    let count = 0;
    for (
      let offset = 0;
      daysSet.has(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - offset,
        ).toDateString(),
      );
      offset += 1
    )
      count += 1;
    return count;
  })();
  const inserted = entries.filter(
    (entry) => entry.injectionStatus === "injected",
  );
  const insertedShare = entries.length
    ? Math.round((inserted.length / entries.length) * 100)
    : null;
  let peak = 0;
  hours.forEach((value, hour) => {
    if (value > (hours[peak] ?? 0)) peak = hour;
  });
  const rangeLabel = range === 7 ? "Last 7 days" : `Last ${range} days`;

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow={rangeLabel}
        title="Insights"
        subtitle="How much you talk, where, and when."
      >
        <Segmented
          value={String(range)}
          options={RANGE_OPTIONS}
          onChange={(value) => setRange(Number(value) as Range)}
        />
      </PageHeader>
      <div className="mb-[14px] grid grid-cols-2 gap-[14px] @min-[821px]/main:grid-cols-4">
        <Kpi
          tone="butter"
          label="Words"
          value={words.toLocaleString()}
          sub={`≈ ${Math.round(words / 45 / 60)} h of typing saved`}
        />
        <Kpi
          tone="mint"
          label="Sessions"
          value={entries.length.toLocaleString()}
          sub={`${average.toLocaleString()} words on average`}
        />
        <Kpi
          tone="sky"
          label="Streak"
          value={`${currentStreak} days`}
          sub={`Best: ${bestStreak(entries, now)} days`}
        />
        <Kpi
          tone="blush"
          label="Inserted"
          value={insertedShare === null ? "None" : `${insertedShare}%`}
          sub="Typed into an app, not just saved"
        />
      </div>
      <div className="grid grid-cols-12 gap-[14px]">
        <Card className="col-span-12 p-5 @min-[861px]/main:col-span-8">
          <div className="flex justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink">
              Words per day
            </h2>
            <span className="label-meta text-[10px] text-muted">
              Avg {Math.round(words / range).toLocaleString()}
            </span>
          </div>
          {entries.length ? (
            <>
              <BarsChart values={days.map((day) => day.words)} />{" "}
              <Axis left={`${range} days ago`} right="Today" />
            </>
          ) : (
            <EmptyChart />
          )}
        </Card>
        <Card className="col-span-12 p-5 @min-[861px]/main:col-span-4">
          <h2 className="font-display text-xl font-bold text-ink">
            Peak hours
          </h2>
          {entries.length ? (
            <>
              <p className="mt-1.5 label-meta text-[10px] text-faint">
                Busiest {formatHour(peak)}
              </p>
              <HourChart values={hours} peak={peak} />
              <div className="mt-2 flex justify-between label-meta text-[10px] text-faint">
                {["12a", "6a", "12p", "6p", "12a"].map((label, index) => (
                  <span key={index}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyChart />
          )}
        </Card>
        <Card className="col-span-12 p-5 @min-[861px]/main:col-span-5">
          <h2 className="mb-2 font-display text-xl font-bold text-ink">
            App usage
          </h2>
          {apps.length ? (
            apps.map((app, index) => (
              <div
                key={app.name}
                className="grid grid-cols-[26px_74px_minmax(0,1fr)_40px] items-center gap-2.5 py-1.5 text-[13px]"
              >
                <AppIcon name={app.name} bundleId={app.bundleId} size={24} />
                <span className="truncate text-ink">{app.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface">
                  <i
                    className="block h-full rounded-full bg-accent"
                    style={{
                      width: `${app.percent}%`,
                      opacity: 1 - index * 0.1,
                    }}
                  />
                </span>
                <code className="text-right font-mono text-[11px] text-muted">
                  {app.percent}%
                </code>
              </div>
            ))
          ) : (
            <EmptyChart />
          )}
        </Card>
        <Card className="col-span-12 p-5 @min-[861px]/main:col-span-7">
          <h2 className="font-display text-xl font-bold text-ink">
            Activity trend
          </h2>
          {entries.length ? (
            <>
              <LineChart values={rolling} />
              <Axis left="7-day average" right="Today" />
            </>
          ) : (
            <EmptyChart />
          )}
        </Card>
      </div>
    </div>
  );
}

// Renders one pastel KPI tile.
function Kpi({
  tone,
  label,
  value,
  sub,
}: {
  tone: "butter" | "mint" | "sky" | "blush";
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card
      tone={tone}
      bordered={false}
      className="flex min-h-[128px] flex-col p-5 text-[#1d1d1d]"
    >
      <span className="label-meta text-[10px] text-[#1d1d1d]/70">{label}</span>
      <div className="mt-auto truncate font-display text-[42px] font-extrabold leading-none tracking-[-.04em]">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-[#1d1d1d]/65">{sub}</div>
    </Card>
  );
}

// Draws the daily word totals as plain SVG bars.
function BarsChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const gap = values.length > 40 ? 2 : 5;
  const width = 600;
  const slot = width / values.length;
  const barWidth = Math.max(1, slot - gap);
  return (
    <svg
      viewBox={`0 0 ${width} 150`}
      preserveAspectRatio="none"
      className="mt-[18px] h-[150px] w-full"
      role="img"
      aria-label="Words dictated per day"
    >
      {values.map((value, index) => {
        const height = value ? Math.max(2, (value / max) * 140) : 0;
        return (
          <rect
            key={index}
            x={index * slot + gap / 2}
            y={150 - height}
            width={barWidth}
            height={height}
            rx="3"
            className={
              index === values.length - 1 ? "fill-accent" : "fill-accent/30"
            }
          />
        );
      })}
    </svg>
  );
}

// Draws hourly word counts as 24 columns.
function HourChart({ values, peak }: { values: number[]; peak: number }) {
  const max = Math.max(...values, 1);
  return (
    <div
      className="mt-4 grid h-[120px] grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-[3px]"
      role="img"
      aria-label="Dictation words by hour"
    >
      {values.map((value, hour) => (
        <i
          key={hour}
          title={`${formatHour(hour)}: ${value} words`}
          className={`min-h-[3px] rounded-[4px] ${hour === peak ? "bg-accent" : "bg-lav dark:bg-accent/50"}`}
          style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Draws a line and shaded area for the rolling average.
function LineChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * 560},${140 - (value / max) * 130}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 560 150"
      preserveAspectRatio="none"
      className="mt-[18px] h-[150px] w-full"
      role="img"
      aria-label="Seven-day rolling average of daily words"
    >
      <polygon points={`0,150 ${points} 560,150`} className="fill-accent/10" />
      <polyline
        points={points}
        fill="none"
        className="stroke-accent"
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Labels the chart's first and last points.
function Axis({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-2 flex justify-between label-meta text-[10px] text-faint">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

// Shows the busiest hour in a short local clock format.
function formatHour(hour: number): string {
  const start = hour % 12 || 12;
  const end = (hour + 1) % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${start}–${end} ${suffix}`;
}

// Explains that there is no chart data in this range.
function EmptyChart() {
  return (
    <div className="mt-4 grid min-h-[150px] place-items-center rounded-2xl bg-surface px-4 text-center text-sm text-muted">
      No dictations in this range yet.
    </div>
  );
}
