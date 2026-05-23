import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Trash2,
  X,
  Type,
  Replace,
  ScrollText,
  Wand2,
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

export default function Dictionary() {
  const { userDictionary, addDictionaryWord, removeDictionaryWord, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newTrigger, setNewTrigger] = useState('')
  const [newReplacement, setNewReplacement] = useState('')
  const [demoTrigger, setDemoTrigger] = useState('')
  const [demoReplacement, setDemoReplacement] = useState('')

  const filteredRules = userDictionary.filter(
    (rule) =>
      rule.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.replacement.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAdd = () => {
    if (!newTrigger.trim()) return
    void addDictionaryWord({
      word: newTrigger.toLowerCase().trim(),
      replacement: newReplacement.trim(),
    })
    setNewTrigger('')
    setNewReplacement('')
    setIsAdding(false)
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
            DICTIONARY
          </h1>
          <p className="text-vaani-gray-500 dark:text-vaani-gray-400">
            Custom word replacements for your transcriptions.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsAdding(true)}
          className="flex items-center justify-center gap-2 bg-vaani-black dark:bg-white text-white dark:text-vaani-black px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-vaani-gray-800 dark:hover:bg-vaani-gray-200 transition-colors"
        >
          <Plus size={16} />
          New Rule
        </motion.button>
      </motion.div>

      {!settings.dictionaryOnboarded && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-vaani-purple/5 dark:bg-vaani-purple/10 border border-vaani-purple/20 dark:border-vaani-purple/30 rounded-2xl p-6"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-vaani-black dark:text-white mb-1">Dictionary Tutorial</h3>
              <p className="text-sm text-vaani-gray-600 dark:text-vaani-gray-400 leading-relaxed">
                Dictionary rules replace trigger words in your transcriptions. For example, if Whisper often transcribes &quot;gonna&quot; but you prefer &quot;going to&quot;, add a rule.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ dictionaryOnboarded: true })}
              className="text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 hover:text-vaani-black dark:hover:text-white transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 mb-1">Trigger</label>
              <input
                type="text"
                value={demoTrigger}
                onChange={(e) => setDemoTrigger(e.target.value)}
                placeholder="e.g. gonna"
                className="w-full px-3 py-2 bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 mb-1">Replacement</label>
              <input
                type="text"
                value={demoReplacement}
                onChange={(e) => setDemoReplacement(e.target.value)}
                placeholder="e.g. going to"
                className="w-full px-3 py-2 bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (!demoTrigger.trim()) return;
                void addDictionaryWord({
                  word: demoTrigger.trim().toLowerCase(),
                  replacement: demoReplacement.trim(),
                });
                setDemoTrigger('');
                setDemoReplacement('');
                void updateSettings({ dictionaryOnboarded: true });
              }}
              className="px-4 py-2 bg-vaani-pink text-white rounded-full text-sm font-semibold hover:bg-vaani-pink/90 transition-colors"
            >
              Add Example Rule
            </motion.button>
            <button
              onClick={() => updateSettings({ dictionaryOnboarded: true })}
              className="px-4 py-2 text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 hover:text-vaani-black dark:hover:text-white transition-colors"
            >
              Skip
            </button>
          </div>
        </motion.div>
      )}

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
                <h3 className="text-lg font-bold text-vaani-black dark:text-white">New Rule</h3>
                <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800 rounded-lg transition-colors">
                  <X size={16} className="text-vaani-gray-500" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Trigger Word</label>
                  <div className="relative">
                    <Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vaani-gray-400" />
                    <input
                      type="text"
                      value={newTrigger}
                      onChange={(e) => setNewTrigger(e.target.value)}
                      placeholder="e.g. gonna"
                      className="w-full pl-9 pr-4 py-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Replacement</label>
                  <div className="relative">
                    <Replace size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vaani-gray-400" />
                    <input
                      type="text"
                      value={newReplacement}
                      onChange={(e) => setNewReplacement(e.target.value)}
                      placeholder="e.g. going to"
                      className="w-full pl-9 pr-4 py-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                    />
                  </div>
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
                  Create Rule
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants}>
        <div className="relative">
          <input
            type="text"
            placeholder="Search rules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-4 pr-4 py-3 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm border border-vaani-gray-200 dark:border-vaani-gray-800 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
          />
        </div>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 overflow-hidden"
      >
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-vaani-gray-200 dark:border-vaani-gray-800 text-xs font-bold text-vaani-gray-500 dark:text-vaani-gray-400 uppercase tracking-wider">
          <div className="col-span-3 sm:col-span-2">Trigger</div>
          <div className="col-span-5 sm:col-span-6">Replacement</div>
          <div className="col-span-2 sm:col-span-2 text-right">Category</div>
          <div className="col-span-2 sm:col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-vaani-gray-200 dark:divide-vaani-gray-800">
          {filteredRules.length === 0 ? (
            <div className="text-center py-16">
              <ScrollText size={48} className="mx-auto text-vaani-gray-300 dark:text-vaani-gray-700 mb-4" />
              <h3 className="text-lg font-semibold text-vaani-black dark:text-white mb-2">No rules found</h3>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Add your first dictionary rule.</p>
            </div>
          ) : (
            filteredRules.map((rule, index) => (
              <motion.div
                key={rule.word}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-vaani-gray-50 dark:hover:bg-vaani-gray-800/50 transition-colors group"
              >
                <div className="col-span-3 sm:col-span-2">
                  <code className="bg-vaani-pink/10 dark:bg-vaani-pink/20 text-vaani-pink px-2 py-1 rounded-lg text-sm font-mono font-semibold">
                    {rule.word}
                  </code>
                </div>
                <div className="col-span-5 sm:col-span-6">
                  <span className="text-sm text-vaani-gray-700 dark:text-vaani-gray-300">
                    {rule.replacement || <span className="text-vaani-gray-400 dark:text-vaani-gray-500 italic">(remove word)</span>}
                  </span>
                </div>
                <div className="col-span-2 sm:col-span-2 text-right">
                  <span className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400 bg-vaani-gray-100 dark:bg-vaani-gray-800 px-2 py-0.5 rounded-full capitalize">
                    {rule.category}
                  </span>
                </div>
                <div className="col-span-2 sm:col-span-2 text-right">
                  <button
                    onClick={() => removeDictionaryWord(rule.word)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={14} className="text-vaani-gray-400 dark:text-vaani-gray-500 hover:text-red-500" />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="bg-vaani-purple/5 dark:bg-vaani-purple/10 border border-vaani-purple/20 dark:border-vaani-purple/30 rounded-2xl p-5"
      >
        <div className="flex items-start gap-3">
          <Wand2 size={18} className="text-vaani-purple mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-vaani-black dark:text-white mb-1">What is Dictionary?</div>
            <p className="text-sm text-vaani-gray-600 dark:text-vaani-gray-400 leading-relaxed">
              Add custom words that Whisper may not recognize, like technical terms, brand names, or words specific to your profession. For example, add &quot;GitHub&quot;, &quot;Vercel&quot;, or industry jargon so Vaani transcribes them correctly based on context.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
