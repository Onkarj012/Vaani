import { motion } from 'framer-motion'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, Cell } from 'recharts'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import type { DictationEntry } from '@shared/types'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.07 } } }
const item = { hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

const ACCENT = 'var(--color-accent)'
const ACCENT_SOFT = 'color-mix(in srgb, var(--color-accent) 30%, var(--color-surface))'
const PEAK_LAV = 'var(--color-chip-lav)'
const AXIS_TICK = { fontFamily: 'Fragment Mono, monospace', fontSize: 11, fill: 'var(--color-faint)' }
const BADGE_TONES = ['bg-chip-lav', 'bg-chip-sky', 'bg-chip-mint', 'bg-chip-blush', 'bg-chip-peach', 'bg-chip-butter', 'bg-surface']

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-2xl border border-line bg-bg px-4 py-3 shadow-card">
        <p className="mb-1 text-sm font-semibold text-ink">{label}</p>
        {payload.map((p, i) => (
          <p key={i} className="text-sm text-muted">
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    )
  }
  return null
}

// Words per app, largest first, with the rest grouped as "Other".
function computeAppUsageData(entries: DictationEntry[]) {
  const appCounts = new Map<string, number>()
  for (const entry of entries) {
    const app = entry.appName?.trim() || 'Unknown'
    appCounts.set(app, (appCounts.get(app) ?? 0) + 1)
  }
  const sorted = Array.from(appCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const total = sorted.reduce((sum, [, count]) => sum + count, 0)
  const otherCount = entries.length - total
  const data = sorted.map(([app, count]) => ({ name: app, value: count }))
  if (otherCount > 0) data.push({ name: 'Other', value: otherCount })
  return data
}

// Words per clock hour, labelled 12AM to 11PM.
function computeHourlyData(entries: DictationEntry[]) {
  const hourCounts = new Map<number, number>()
  for (const entry of entries) {
    const hour = new Date(entry.timestamp).getHours()
    const words = entry.cleanedText.split(/\s+/).filter(Boolean).length
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + words)
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const period = hour < 12 ? 'AM' : 'PM'
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    return { hour: `${displayHour}${period}`, words: hourCounts.get(hour) ?? 0 }
  })
}

// Card with a title, a muted subtitle, and an optional label on the right.
function ChartCard({ title, subtitle, meta, children }: { title: string; subtitle: string; meta?: string; children: ReactNode }) {
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-display text-[20px] text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        {meta && <span className="label-meta shrink-0 pt-1 text-[10px] text-faint">{meta}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

export default function Insights() {
  const { stats, weeklyActivity, historyEntries } = useVaaniUi()

  const tiles = [
    { label: 'Words', value: stats.totalWords.toLocaleString(), note: `${stats.wordsToday.toLocaleString()} today`, tone: 'bg-chip-butter' },
    { label: 'Sessions', value: stats.totalSessions.toLocaleString(), note: `${stats.sessionsToday} today`, tone: 'bg-chip-mint' },
    { label: 'Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, note: 'Keep it going', tone: 'bg-chip-sky' },
    { label: 'Accuracy', value: `${stats.accuracy}%`, note: 'Estimated', tone: 'bg-chip-blush' },
  ]

  const appUsage = useMemo(() => computeAppUsageData(historyEntries), [historyEntries])
  const appTotal = appUsage.reduce((sum, app) => sum + app.value, 0)
  const hourlyData = useMemo(() => computeHourlyData(historyEntries), [historyEntries])
  const peakWords = Math.max(0, ...hourlyData.map((row) => row.words))
  const busiest = hourlyData.find((row) => row.words === peakWords)
  const weeklyAverage = Math.round(weeklyActivity.reduce((sum, day) => sum + day.words, 0) / weeklyActivity.length)
  const recentActivityData = useMemo(() => (
    historyEntries.slice(0, 20).map((entry, i) => ({
      index: i + 1,
      words: entry.cleanedText.split(/\s+/).filter(Boolean).length,
    }))
  ), [historyEntries])

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-6">
      <motion.div variants={item}>
        <p className="label-meta text-[10px] text-faint">All time</p>
        <h1 className="text-display text-[56px] text-ink">Insights</h1>
        <p className="mt-3 max-w-[460px] text-sm text-muted">How much you talk, where, and when.</p>
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={`flex min-h-[128px] flex-col rounded-card p-5 pastel-scope ${tile.tone}`}>
            <span className="label-meta text-[10px] pastel-scope/55">{tile.label}</span>
            <span className="text-display mt-auto text-[42px]">{tile.value}</span>
            <span className="mt-1.5 text-xs pastel-scope/60">{tile.note}</span>
          </div>
        ))}
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 lg:col-span-8">
          <ChartCard title="Words per day" subtitle="Total words dictated each day" meta={`Avg ${weeklyAverage.toLocaleString()}`}>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyActivity}>
                  <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-surface)' }} />
                  <Bar dataKey="words" name="Words" radius={[4, 4, 0, 0]}>
                    {weeklyActivity.map((day, i) => (
                      <Cell key={day.day} fill={i === weeklyActivity.length - 1 ? ACCENT : ACCENT_SOFT} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="col-span-12 lg:col-span-4">
          <ChartCard title="Peak hours" subtitle="When you dictate the most" meta={busiest && peakWords > 0 ? `Busiest ${busiest.hour}` : undefined}>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData} margin={{ left: 14, right: 14 }}>
                  <XAxis dataKey="hour" interval={5} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-surface)' }} />
                  <Bar dataKey="words" name="Words" radius={[3, 3, 0, 0]}>
                    {hourlyData.map((row) => (
                      <Cell key={row.hour} fill={peakWords > 0 && row.words >= peakWords * 0.8 ? ACCENT : PEAK_LAV} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="App usage" subtitle="Where your dictations were injected">
            {appUsage.length === 0 ? (
              <p className="text-sm text-muted">No dictations yet.</p>
            ) : (
              <div className="space-y-2">
                {appUsage.map((app, index) => {
                  const share = Math.round((app.value / appTotal) * 100)
                  return (
                    <div key={app.name} className="grid grid-cols-[26px_88px_minmax(0,1fr)_40px] items-center gap-2.5 py-1 text-[13px] font-medium">
                      <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[11px] font-bold pastel-scope ${BADGE_TONES[index % BADGE_TONES.length] ?? ''}`}>
                        {app.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate">{app.name}</span>
                      <span className="block h-2 overflow-hidden rounded-full bg-surface">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                      </span>
                      <span className="text-right font-mono text-[11px] text-muted">{share}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </ChartCard>
        </div>

        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="Activity trend" subtitle="Words over the last 7 days">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyActivity}>
                  <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="words" name="Words" stroke={ACCENT} strokeWidth={2.2} fill={ACCENT} fillOpacity={0.12} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="col-span-12">
          <ChartCard title="Recent activity" subtitle={`Your last ${Math.min(historyEntries.length, 20)} dictations`}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recentActivityData}>
                  <XAxis dataKey="index" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="words" name="Words" stroke={ACCENT} strokeWidth={2.2} dot={{ fill: ACCENT, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      </motion.div>
    </motion.div>
  )
}
