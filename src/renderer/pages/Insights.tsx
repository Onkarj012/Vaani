import { motion } from 'framer-motion'
import { useMemo } from 'react'
import type { DictationEntry } from '@shared/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Zap, Type, RefreshCw, Clock, TrendingUp, BarChart3, Monitor, Calendar } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@/components/ui/card'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.07 } } }
const item = { hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

// Meelo data series — pastel-forward, readable on light + dark
const SERIES = ['#7575c8', '#5bb5d8', '#8cc152', '#f0a07a', '#e6c34d', '#d97fc1', '#b0b0b0']
const GRID = 'rgba(136,136,136,0.18)'
const AXIS = '#9a9a9a'
const CURSOR = 'rgba(136,136,136,0.12)'

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

function computeAppUsageData(entries: DictationEntry[]) {
  const appCounts = new Map<string, number>()
  for (const entry of entries) {
    const app = entry.appName?.trim() || 'Unknown'
    appCounts.set(app, (appCounts.get(app) ?? 0) + 1)
  }
  const sorted = Array.from(appCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const total = sorted.reduce((sum, [, count]) => sum + count, 0)
  const otherCount = entries.length - total
  const data = sorted.map(([app, count], index) => ({ name: app, value: count, color: SERIES[index % SERIES.length] }))
  if (otherCount > 0) data.push({ name: 'Other', value: otherCount, color: SERIES[data.length % SERIES.length] })
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

function ChartCard({ title, subtitle, icon: Icon, accent, children }: { title: string; subtitle: string; icon: typeof Zap; accent: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-6">
        <h2 className="flex items-center gap-2 text-display text-lg text-ink"><Icon size={17} style={{ color: accent }} />{title}</h2>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <div className="h-64">{children}</div>
    </Card>
  )
}

export default function Insights() {
  const { stats, weeklyActivity, historyEntries } = useVaaniUi()

  const statsCards = [
    { label: 'Total Words', value: stats.totalWords.toLocaleString(), change: `${stats.wordsToday.toLocaleString()} today`, icon: Type, iconBg: 'bg-chip-mint text-[#5a8a2a]' },
    { label: 'Total Sessions', value: stats.totalSessions.toLocaleString(), change: `${stats.sessionsToday} today`, icon: Zap, iconBg: 'bg-chip-lav text-accent-strong' },
    { label: 'Current Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, change: 'Keep it going', icon: RefreshCw, iconBg: 'bg-chip-peach text-[#c4684f]' },
    { label: 'Accuracy', value: `${stats.accuracy}%`, change: 'Estimated', icon: Clock, iconBg: 'bg-chip-sky text-[#2c7fb8]' },
  ]

  const appUsageData = useMemo(() => computeAppUsageData(historyEntries), [historyEntries])
  const hourlyData = useMemo(() => computeHourlyData(historyEntries), [historyEntries])

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-8">
      <motion.div variants={item} className="flex items-end justify-between">
        <div>
          <p className="label-meta mb-2 text-[11px] text-accent">✦ Analytics</p>
          <h1 className="text-display text-5xl text-ink">Insights</h1>
          <p className="mt-3 text-muted">Deep dive into your dictation patterns and productivity.</p>
        </div>
        <span className="label-meta hidden text-[11px] text-faint sm:block">Last 30 days</span>
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((stat) => (
          <Card key={stat.label} hover className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className={`flex h-11 w-11 items-center justify-center rounded-full ${stat.iconBg}`}><stat.icon size={18} /></div>
              <TrendingUp size={16} className="text-[#5a8a2a]" />
            </div>
            <div className="text-display text-3xl text-ink">{stat.value}</div>
            <div className="mt-1 text-sm text-muted">{stat.label}</div>
            <div className="label-meta mt-1 text-[10px] text-faint">{stat.change}</div>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={item}>
          <ChartCard title="Words per day" subtitle="Total words dictated each day" icon={BarChart3} accent="#8cc152">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyActivity}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: CURSOR }} />
                <Bar dataKey="words" fill="#7575c8" radius={[6, 6, 0, 0]} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="App usage" subtitle="Where your dictations were injected" icon={Monitor} accent="#f0a07a">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={appUsageData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" stroke="none">
                  {appUsageData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" iconSize={10}
                  formatter={(value: string) => <span className="text-sm text-muted">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="Peak hours" subtitle="When you dictate the most" icon={Clock} accent="#5bb5d8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: CURSOR }} />
                <Bar dataKey="words" fill="#5bb5d8" radius={[6, 6, 0, 0]} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>

        <motion.div variants={item}>
          <ChartCard title="Activity trend" subtitle="Words over the last 7 days" icon={TrendingUp} accent="#7575c8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyActivity}>
                <defs>
                  <linearGradient id="wordsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7575c8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#7575c8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="words" stroke="#7575c8" strokeWidth={3} fill="url(#wordsGradient)" name="Words" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card>
          <div className="mb-6">
            <h2 className="flex items-center gap-2 text-display text-lg text-ink"><Calendar size={17} className="text-accent" />Recent activity</h2>
            <p className="mt-1 text-sm text-muted">Your last {Math.min(historyEntries.length, 20)} dictations</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyEntries.slice(0, 20).map((entry, i) => ({ index: i + 1, words: entry.cleanedText.split(/\s+/).filter(Boolean).length }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="index" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="words" stroke="#7575c8" strokeWidth={3} dot={{ fill: '#7575c8', r: 4 }} activeDot={{ r: 6 }} name="Words" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
