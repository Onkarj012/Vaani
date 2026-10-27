import { motion } from 'framer-motion'
import { useMemo } from 'react'
import type { DictationEntry } from '@shared/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts'
import { Zap, Type, RefreshCw, Clock, TrendingUp, BarChart3, Monitor, Calendar } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { Card } from '@renderer/components/ui/card'
import { Tag } from '@renderer/components/ui/tag'
import { PageHeader, pageContainer as container, pageItem as item } from '@renderer/components/ui/page-header'

// Categorical slots in fixed order, stepped per mode (validated palette). "Other" stays neutral.
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']
const OTHER_COLOR = '#9b9aa1'

function useChartTheme() {
  const { mode } = useColorMode()
  const { settings } = useVaaniUi()
  const dark = mode === 'dark'
  return {
    accent: /^#[0-9a-fA-F]{6}$/.test(settings.accentColor) ? settings.accentColor : '#7c3aed',
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(24,22,30,0.06)',
    axis: dark ? '#6d6c75' : '#9b9aa1',
    cursor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(24,22,30,0.04)',
    surface: dark ? '#16161a' : '#ffffff',
  }
}

const axisProps = { fontSize: 11, tickLine: false, axisLine: false } as const

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color?: string; payload?: { color?: string }; name: string; value: number }>; label?: string | number }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-line bg-card/95 px-3.5 py-2.5 shadow-pop backdrop-blur-xl">
        {label !== undefined && <p className="mb-1 text-xs font-medium text-muted">{label}</p>}
        {payload.map((p, i) => (
          <p key={i} className="flex items-center gap-2 text-[13px] text-ink">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.payload?.color ?? p.color }} />
            <span className="text-muted">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{p.value.toLocaleString()}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

function computeAppUsageData(entries: DictationEntry[], series: string[]) {
  const appCounts = new Map<string, number>()
  for (const entry of entries) {
    const app = entry.appName?.trim() || 'Unknown'
    appCounts.set(app, (appCounts.get(app) ?? 0) + 1)
  }
  const sorted = Array.from(appCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, series.length)
  const total = sorted.reduce((sum, [, count]) => sum + count, 0)
  const otherCount = entries.length - total
  const data = sorted.map(([app, count], index) => ({ name: app, value: count, color: series[index] }))
  if (otherCount > 0) data.push({ name: 'Other', value: otherCount, color: OTHER_COLOR })
  return data
}

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

function ChartCard({ title, subtitle, icon: Icon, children, className }: { title: string; subtitle: string; icon: typeof Zap; children: React.ReactNode; className?: string }) {
  return (
    <Card className="h-full">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="type-title text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
        </div>
        <Icon size={15} className="text-faint" />
      </div>
      <div className={className ?? 'h-60'}>{children}</div>
    </Card>
  )
}

export default function Insights() {
  const { stats, weeklyActivity, historyEntries } = useVaaniUi()
  const theme = useChartTheme()

  const statsCards = [
    { label: 'Total Words', value: stats.totalWords.toLocaleString(), change: `${stats.wordsToday.toLocaleString()} today`, icon: Type },
    { label: 'Total Sessions', value: stats.totalSessions.toLocaleString(), change: `${stats.sessionsToday} today`, icon: Zap },
    { label: 'Current Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, change: 'Keep it going', icon: RefreshCw },
    { label: 'Accuracy', value: `${stats.accuracy}%`, change: 'Estimated', icon: Clock },
  ]

  const appUsageData = useMemo(() => computeAppUsageData(historyEntries, theme.series), [historyEntries, theme.series])
  const appUsageTotal = appUsageData.reduce((sum, d) => sum + d.value, 0)
  const hourlyData = useMemo(() => computeHourlyData(historyEntries), [historyEntries])
  const recentActivityData = useMemo(() => (
    historyEntries.slice(0, 20).map((entry, i) => ({
      index: i + 1,
      words: entry.cleanedText.split(/\s+/).filter(Boolean).length,
    }))
  ), [historyEntries])

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Insights"
        description="Deep dive into your dictation patterns and productivity."
        actions={<Tag tone="surface">Last 30 days</Tag>}
      />

      <motion.div variants={item} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((stat) => (
          <Card key={stat.label} hover className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-muted">{stat.label}</span>
              <stat.icon size={15} className="text-faint" />
            </div>
            <div className="type-figure mt-4 text-[32px] text-ink">{stat.value}</div>
            <div className="mt-2 flex items-center gap-1 text-xs text-faint"><TrendingUp size={12} className="text-accent" />{stat.change}</div>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div variants={item}>
          <ChartCard title="Words per day" subtitle="Total words dictated each day" icon={BarChart3}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyActivity} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="day" stroke={theme.axis} {...axisProps} />
                <YAxis stroke={theme.axis} {...axisProps} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: theme.cursor }} />
                <Bar dataKey="words" fill={theme.accent} radius={[4, 4, 0, 0]} maxBarSize={28} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="App usage" subtitle="Where your dictations were injected" icon={Monitor}>
            {appUsageData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted">No dictations yet</div>
            ) : (
              <div className="flex h-full items-center gap-6">
                <div className="relative h-full min-w-0 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      {/* No entry animation: audio-level updates re-render this page often enough to restart it mid-draw. */}
                      <Pie isAnimationActive={false} data={appUsageData} cx="50%" cy="50%" innerRadius="62%" outerRadius="88%" paddingAngle={0} dataKey="value" stroke={theme.surface} strokeWidth={2}>
                        {appUsageData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="type-figure text-[24px] text-ink">{appUsageTotal.toLocaleString()}</span>
                    <span className="mt-1 text-[11px] text-faint">sessions</span>
                  </div>
                </div>
                <ul className="w-40 shrink-0 space-y-1.5">
                  {appUsageData.map((entry) => (
                    <li key={entry.name} className="flex items-center gap-2 text-[12.5px]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="min-w-0 flex-1 truncate text-ink/85">{entry.name}</span>
                      <span className="tabular-nums text-faint">{entry.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="Peak hours" subtitle="When you dictate the most" icon={Clock}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="hour" stroke={theme.axis} {...axisProps} interval={3} />
                <YAxis stroke={theme.axis} {...axisProps} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: theme.cursor }} />
                <Bar dataKey="words" fill={theme.accent} radius={[4, 4, 0, 0]} maxBarSize={14} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="Activity trend" subtitle="Words over the last 7 days" icon={TrendingUp}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyActivity} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="wordsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.accent} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="day" stroke={theme.axis} {...axisProps} />
                <YAxis stroke={theme.axis} {...axisProps} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: theme.axis, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="words" stroke={theme.accent} strokeWidth={2} fill="url(#wordsGradient)" name="Words" activeDot={{ r: 5, stroke: theme.surface, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <ChartCard title="Recent activity" subtitle={`Words in your last ${Math.min(historyEntries.length, 20)} dictations`} icon={Calendar} className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentActivityData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="index" stroke={theme.axis} {...axisProps} />
              <YAxis stroke={theme.axis} {...axisProps} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: theme.axis, strokeDasharray: '3 3' }} labelFormatter={(value) => `Dictation ${value}`} />
              <Line type="monotone" dataKey="words" stroke={theme.accent} strokeWidth={2} dot={{ r: 4, fill: theme.accent, stroke: theme.surface, strokeWidth: 2 }} activeDot={{ r: 6, stroke: theme.surface, strokeWidth: 2 }} name="Words" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </motion.div>
    </motion.div>
  )
}
