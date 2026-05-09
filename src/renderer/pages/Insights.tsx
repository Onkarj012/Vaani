import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import {
  Zap,
  Type,
  RefreshCw,
  Clock,
  TrendingUp,
  BarChart3,
  Calendar,
  Monitor,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-semibold text-vaani-black dark:text-white mb-1">{label}</p>
        {payload.map((p, i) => (
          <p key={i} className="text-sm text-vaani-gray-600 dark:text-vaani-gray-300">
            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: p.color }} />
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    )
  }
  return null
}

export default function Insights() {
  const { stats, weeklyActivity, historyEntries } = useVaaniUi()

  const statsCards = [
    {
      label: 'Total Words',
      value: stats.totalWords.toLocaleString(),
      change: `${stats.wordsToday.toLocaleString()} today`,
      icon: Type,
      color: 'bg-vaani-lime',
    },
    {
      label: 'Total Sessions',
      value: stats.totalSessions.toLocaleString(),
      change: `${stats.sessionsToday} today`,
      icon: Zap,
      color: 'bg-vaani-pink',
    },
    {
      label: 'Current Streak',
      value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`,
      change: 'Keep it going',
      icon: RefreshCw,
      color: 'bg-vaani-cyan',
    },
    {
      label: 'Accuracy',
      value: `${stats.accuracy}%`,
      change: 'Estimated',
      icon: Clock,
      color: 'bg-vaani-orange',
    },
  ]

  const appUsageData = [
    { name: 'VS Code', value: 35, color: '#FF006E' },
    { name: 'Notion', value: 25, color: '#ADFF02' },
    { name: 'Slack', value: 15, color: '#00F5FF' },
    { name: 'Chrome', value: 12, color: '#FFE600' },
    { name: 'Other', value: 13, color: '#9D4EDD' },
  ]

  const hourlyData = [
    { hour: '6AM', words: 120 },
    { hour: '8AM', words: 450 },
    { hour: '10AM', words: 890 },
    { hour: '12PM', words: 720 },
    { hour: '2PM', words: 950 },
    { hour: '4PM', words: 680 },
    { hour: '6PM', words: 340 },
    { hour: '8PM', words: 180 },
  ]

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-7xl mx-auto space-y-8"
    >
      <motion.div variants={itemVariants} className="flex items-end justify-between">
        <div>
          <h1 className="text-display text-4xl sm:text-5xl text-vaani-black dark:text-white mb-2">
            INSIGHTS
          </h1>
          <p className="text-vaani-gray-500 dark:text-vaani-gray-400">
            Deep dive into your dictation patterns and productivity.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
          <Calendar size={14} />
          <span>Last 30 days</span>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            whileHover={{ y: -4, scale: 1.02 }}
            className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800 hover:shadow-lg dark:hover:shadow-vaani-pink/10 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-10 h-10 ${stat.color} rounded-xl flex items-center justify-center`}>
                <stat.icon size={18} className="text-vaani-black" />
              </div>
              <TrendingUp size={16} className="text-vaani-lime" />
            </div>
            <div className="text-2xl font-bold text-vaani-black dark:text-white mb-1">{stat.value}</div>
            <div className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400 mb-1">{stat.label}</div>
            <div className="text-xs text-vaani-gray-400 dark:text-vaani-gray-500">{stat.change}</div>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div
          variants={itemVariants}
          className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1 flex items-center gap-2">
                <BarChart3 size={18} className="text-vaani-lime" />
                Words Per Day
              </h2>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
                Total words dictated each day
              </p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyActivity}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" opacity={0.5} />
                <XAxis dataKey="day" stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="words" fill="#ADFF02" radius={[6, 6, 0, 0]} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1 flex items-center gap-2">
                <Monitor size={18} className="text-vaani-cyan" />
                App Usage
              </h2>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
                Where your dictations were injected
              </p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={appUsageData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {appUsageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="middle"
                  align="right"
                  layout="vertical"
                  iconType="circle"
                  iconSize={10}
                  formatter={(value: string) => (
                    <span className="text-sm text-vaani-gray-600 dark:text-vaani-gray-300">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1 flex items-center gap-2">
                <Clock size={18} className="text-vaani-orange" />
                Peak Hours
              </h2>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
                When you dictate the most
              </p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" opacity={0.5} />
                <XAxis dataKey="hour" stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="words" fill="#FF6B35" radius={[6, 6, 0, 0]} name="Words" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1 flex items-center gap-2">
                <TrendingUp size={18} className="text-vaani-lime" />
                Activity Trend
              </h2>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
                Words over the last 7 days
              </p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyActivity}>
                <defs>
                  <linearGradient id="wordsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF006E" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#FF006E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" opacity={0.5} />
                <XAxis dataKey="day" stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="words"
                  stroke="#FF006E"
                  strokeWidth={3}
                  fill="url(#wordsGradient)"
                  name="Words"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      <motion.div
        variants={itemVariants}
        className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1 flex items-center gap-2">
              <Calendar size={18} className="text-vaani-pink" />
              Recent Activity
            </h2>
            <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
              Your last {Math.min(historyEntries.length, 20)} dictations
            </p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={historyEntries.slice(0, 20).map((entry, i) => ({
                index: i + 1,
                words: entry.cleanedText.split(/\s+/).filter(Boolean).length,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" opacity={0.5} />
              <XAxis dataKey="index" stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#A3A3A3" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="words"
                stroke="#ADFF02"
                strokeWidth={3}
                dot={{ fill: '#ADFF02', r: 4 }}
                activeDot={{ r: 6 }}
                name="Words"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </motion.div>
  )
}
