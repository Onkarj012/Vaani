import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Trash2,
  Zap,
  X,
  Hash,
  Copy,
  Check,
  Terminal,
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

export default function Snippets() {
  const { snippets, addSnippet, removeSnippet } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newTrigger, setNewTrigger] = useState('')
  const [newContent, setNewContent] = useState('')
  const [copiedTrigger, setCopiedTrigger] = useState<string | null>(null)

  const filteredSnippets = snippets.filter((snippet) => {
    const matchesSearch =
      snippet.trigger.toLowerCase().includes(searchQuery.toLowerCase()) ||
      snippet.content.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const handleAdd = () => {
    if (!newTrigger.trim() || !newContent.trim()) return
    void addSnippet({
      trigger: newTrigger.startsWith('/') ? newTrigger.slice(1) : newTrigger,
      content: newContent,
    })
    setNewTrigger('')
    setNewContent('')
    setIsAdding(false)
  }

  const handleCopy = (trigger: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedTrigger(trigger)
    setTimeout(() => setCopiedTrigger(null), 2000)
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
            SNIPPETS
          </h1>
          <p className="text-vaani-gray-500 dark:text-vaani-gray-400">
            Slash commands that expand into full text.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsAdding(true)}
          className="flex items-center justify-center gap-2 bg-vaani-black dark:bg-white text-white dark:text-vaani-black px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-vaani-gray-800 dark:hover:bg-vaani-gray-200 transition-colors"
        >
          <Plus size={16} />
          New Snippet
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-vaani-black dark:text-white">New Snippet</h3>
                <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800 rounded-lg transition-colors">
                  <X size={16} className="text-vaani-gray-500" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Trigger</label>
                  <div className="relative">
                    <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vaani-gray-400" />
                    <input
                      type="text"
                      value={newTrigger}
                      onChange={(e) => setNewTrigger(e.target.value)}
                      placeholder="/trigger"
                      className="w-full pl-9 pr-4 py-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Content</label>
                  <textarea
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="Text to expand..."
                    rows={3}
                    className="w-full px-4 py-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all resize-none text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsAdding(false)} className="px-4 py-2 text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 hover:text-vaani-black dark:hover:text-white transition-colors">
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleAdd}
                  className="px-5 py-2 bg-vaani-pink text-white rounded-full text-sm font-semibold hover:bg-vaani-pink/90 transition-colors"
                >
                  Create Snippet
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search snippets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-4 pr-4 py-3 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm border border-vaani-gray-200 dark:border-vaani-gray-800 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
          />
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        {filteredSnippets.length === 0 ? (
          <div className="text-center py-20">
            <Terminal size={48} className="mx-auto text-vaani-gray-300 dark:text-vaani-gray-700 mb-4" />
            <h3 className="text-lg font-semibold text-vaani-black dark:text-white mb-2">No snippets found</h3>
            <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Create your first snippet to get started.</p>
          </div>
        ) : (
          filteredSnippets.map((snippet, index) => (
            <motion.div
              key={snippet.trigger}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 p-5 hover:shadow-md dark:hover:shadow-vaani-pink/5 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <code className="bg-vaani-gray-100 dark:bg-vaani-gray-800 px-2 py-1 rounded-lg text-sm font-mono font-semibold text-vaani-pink">
                      /{snippet.trigger}
                    </code>
                    <span className="flex items-center gap-1 text-xs text-vaani-gray-400 dark:text-vaani-gray-500">
                      <Zap size={10} />
                      Snippet
                    </span>
                  </div>
                  <p className="text-sm text-vaani-gray-600 dark:text-vaani-gray-400 leading-relaxed line-clamp-2">
                    {snippet.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(snippet.trigger, snippet.content)}
                    className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800 rounded-lg transition-colors"
                  >
                    {copiedTrigger === snippet.trigger ? (
                      <Check size={14} className="text-vaani-lime" />
                    ) : (
                      <Copy size={14} className="text-vaani-gray-500 dark:text-vaani-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={() => removeSnippet(snippet.trigger)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} className="text-vaani-gray-500 dark:text-vaani-gray-400 hover:text-red-500" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="bg-vaani-lime/5 dark:bg-vaani-lime/10 border border-vaani-lime/20 dark:border-vaani-lime/30 rounded-2xl p-5"
      >
        <div className="flex items-start gap-3">
          <Zap size={18} className="text-vaani-lime mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-vaani-black dark:text-white mb-1">What are Snippets?</div>
            <p className="text-sm text-vaani-gray-600 dark:text-vaani-gray-400 leading-relaxed">
              Create slash-commands that expand into longer text. Perfect for repetitive content like email signatures, addresses, phone numbers, or boilerplate text you often dictate.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
