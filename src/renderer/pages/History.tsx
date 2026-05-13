import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Search,
  Copy,
  RotateCcw,
  Trash2,
  Calendar,
  Clock,
  Type,
  Filter,
  ChevronDown,
  X,
  Check,
  AudioLines,
  Edit3,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
}

export default function History() {
  const { historyItems, updateHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry, copyHistoryEntry } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const groups = ['Today', 'Yesterday', 'This Week', 'Earlier']
  const grouped = groups.map((group) => ({
    date: group,
    items: historyItems
      .filter((item) => item.group === group)
      .filter((item) => item.text.toLowerCase().includes(searchQuery.toLowerCase())),
  })).filter((group) => group.items.length > 0)

  const handleEdit = (id: string, text: string) => {
    setEditingId(id)
    setEditText(text)
  }

  const handleSave = () => {
    if (editingId) {
      void updateHistoryEntry(editingId, editText)
    }
    setEditingId(null)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-5xl mx-auto space-y-6"
    >
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-4xl sm:text-5xl text-vaani-black dark:text-white mb-2">
            HISTORY
          </h1>
          <p className="text-vaani-gray-500 dark:text-vaani-gray-400">
            Search and manage your past dictations.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
          <AudioLines size={14} />
          <span>{historyItems.length} total dictations</span>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-vaani-gray-400" />
          <input
            type="text"
            placeholder="Search dictations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm border border-vaani-gray-200 dark:border-vaani-gray-800 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2">
              <X size={14} className="text-vaani-gray-400 hover:text-vaani-black dark:hover:text-white" />
            </button>
          )}
        </div>
        <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm border border-vaani-gray-200 dark:border-vaani-gray-800 rounded-xl text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-700 transition-colors">
          <Filter size={14} />
          Filter
          <ChevronDown size={14} />
        </button>
      </motion.div>

      <div className="space-y-8">
        {grouped.length === 0 ? (
          <motion.div variants={itemVariants} className="text-center py-20">
            <Search size={48} className="mx-auto text-vaani-gray-300 dark:text-vaani-gray-700 mb-4" />
            <h3 className="text-lg font-semibold text-vaani-black dark:text-white mb-2">No results found</h3>
            <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Try adjusting your search query.</p>
          </motion.div>
        ) : (
          grouped.map((group) => (
            <motion.div key={group.date} variants={itemVariants}>
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={14} className="text-vaani-gray-400" />
                <h2 className="text-sm font-bold text-vaani-gray-500 dark:text-vaani-gray-400 uppercase tracking-wider">
                  {group.date}
                </h2>
                <div className="flex-1 h-px bg-vaani-gray-200 dark:bg-vaani-gray-800" />
              </div>

              <div className="space-y-3">
                {group.items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 overflow-hidden hover:shadow-md dark:hover:shadow-vaani-pink/5 transition-all"
                  >
                    <div className="p-5">
                      {editingId === item.id ? (
                        <div className="space-y-3">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink resize-none text-vaani-black dark:text-white"
                            rows={3}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-vaani-gray-500 dark:text-vaani-gray-400 hover:text-vaani-black dark:hover:text-white transition-colors">
                              Cancel
                            </button>
                            <button
                              onClick={handleSave}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-vaani-pink text-white rounded-lg text-sm font-medium hover:bg-vaani-pink/90 transition-colors"
                            >
                              <Check size={14} />
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className={`text-sm text-vaani-gray-700 dark:text-vaani-gray-300 leading-relaxed mb-3 ${expandedId === item.id ? '' : 'line-clamp-2'}`}>
                            {item.text}
                          </p>
                          {item.text.length > 150 && (
                            <button
                              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                              className="text-xs font-medium text-vaani-pink hover:text-vaani-black dark:hover:text-white transition-colors mb-3"
                            >
                              {expandedId === item.id ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </>
                      )}

                      {editingId !== item.id && (
                        <>
                          <div className="flex items-center gap-4 text-xs text-vaani-gray-400 dark:text-vaani-gray-500 mb-4">
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {item.time}
                            </span>
                            <span className="flex items-center gap-1">
                              <AudioLines size={12} />
                              {item.duration}
                            </span>
                            <span className="flex items-center gap-1">
                              <Type size={12} />
                              {item.wordCount} words
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copyHistoryEntry(item.text)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-vaani-gray-100 dark:bg-vaani-gray-800 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-lg text-xs font-medium text-vaani-gray-600 dark:text-vaani-gray-300 transition-colors"
                            >
                              <Copy size={12} />
                              Copy
                            </button>
                            <button
                              onClick={() => reinjectHistoryEntry(item.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-vaani-gray-100 dark:bg-vaani-gray-800 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-lg text-xs font-medium text-vaani-gray-600 dark:text-vaani-gray-300 transition-colors"
                            >
                              <RotateCcw size={12} />
                              Re-inject
                            </button>
                            <button
                              onClick={() => handleEdit(item.id, item.text)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-vaani-gray-100 dark:bg-vaani-gray-800 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-lg text-xs font-medium text-vaani-gray-600 dark:text-vaani-gray-300 transition-colors"
                            >
                              <Edit3 size={12} />
                              Edit
                            </button>
                            <button
                              onClick={() => deleteHistoryEntry(item.id)}
                              className="ml-auto p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors group"
                            >
                              <Trash2 size={14} className="text-vaani-gray-400 dark:text-vaani-gray-500 group-hover:text-red-500 transition-colors" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  )
}
