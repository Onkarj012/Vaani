import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, X, Type, Replace, ScrollText, Wand2 } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export default function Dictionary() {
  const { userDictionary, addDictionaryWord, removeDictionaryWord, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newTrigger, setNewTrigger] = useState('')
  const [newReplacement, setNewReplacement] = useState('')
  const [demoTrigger, setDemoTrigger] = useState('')
  const [demoReplacement, setDemoReplacement] = useState('')

  const filtered = userDictionary.filter(
    (rule) => rule.word.toLowerCase().includes(searchQuery.toLowerCase()) || rule.replacement.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAdd = () => {
    if (!newTrigger.trim()) return
    void addDictionaryWord({ word: newTrigger.toLowerCase().trim(), replacement: newReplacement.trim() })
    setNewTrigger(''); setNewReplacement(''); setIsAdding(false)
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-4xl space-y-7">
      <motion.div variants={item} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label-meta mb-2 text-[11px] text-accent">✦ Vocabulary</p>
          <h1 className="text-display text-5xl text-ink">Dictionary</h1>
          <p className="mt-3 text-muted">Custom word replacements for your transcriptions.</p>
        </div>
        <Button onClick={() => setIsAdding(true)}><Plus size={16} />New Rule</Button>
      </motion.div>

      {!settings.dictionaryOnboarded && (
        <motion.div variants={item}>
          <Card tone="lav" bordered={false}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-display text-lg text-ink">Dictionary tutorial</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Dictionary rules replace trigger words in your transcriptions. If Whisper transcribes &quot;gonna&quot; but you prefer &quot;going to&quot;, add a rule.
                </p>
              </div>
              <button onClick={() => updateSettings({ dictionaryOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Trigger</label>
                <Input value={demoTrigger} onChange={(e) => setDemoTrigger(e.target.value)} placeholder="e.g. gonna" className="bg-bg" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Replacement</label>
                <Input value={demoReplacement} onChange={(e) => setDemoReplacement(e.target.value)} placeholder="e.g. going to" className="bg-bg" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  if (!demoTrigger.trim()) return
                  void addDictionaryWord({ word: demoTrigger.trim().toLowerCase(), replacement: demoReplacement.trim() })
                  setDemoTrigger(''); setDemoReplacement('')
                  void updateSettings({ dictionaryOnboarded: true })
                }}
              >
                Add Example Rule
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ dictionaryOnboarded: true })}>Skip</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-display text-lg text-ink">New rule</h3>
                <button onClick={() => setIsAdding(false)} className="rounded-full p-2 text-muted hover:bg-surface"><X size={16} /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">Trigger word</label>
                  <div className="relative">
                    <Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="e.g. gonna" className="pl-9" />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">Replacement</label>
                  <div className="relative">
                    <Replace size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <Input value={newReplacement} onChange={(e) => setNewReplacement(e.target.value)} placeholder="e.g. going to" className="pl-9" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                <Button variant="accent" size="sm" onClick={handleAdd}>Create Rule</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={item}>
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search rules…" />
      </motion.div>

      <motion.div variants={item}>
        <Card className="overflow-hidden p-0">
          <div className="label-meta grid grid-cols-12 gap-4 border-b border-line px-5 py-4 text-[10px] text-faint">
            <div className="col-span-3">Trigger</div>
            <div className="col-span-6">Replacement</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-1 text-right">·</div>
          </div>
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <ScrollText size={44} className="mx-auto mb-4 text-line" />
              <h3 className="text-display text-xl text-ink">No rules found</h3>
              <p className="mt-2 text-sm text-muted">Add your first dictionary rule.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {filtered.map((rule) => (
                <div key={rule.word} className="group grid grid-cols-12 items-center gap-4 px-5 py-4 transition-colors hover:bg-surface">
                  <div className="col-span-3">
                    <code className="rounded-lg bg-chip-lav px-2 py-1 font-mono text-sm font-semibold text-accent-strong">{rule.word}</code>
                  </div>
                  <div className="col-span-6 text-sm text-ink/85">
                    {rule.replacement || <span className="italic text-faint">(remove word)</span>}
                  </div>
                  <div className="col-span-2"><Tag tone="surface">{rule.category}</Tag></div>
                  <div className="col-span-1 text-right">
                    <button onClick={() => removeDictionaryWord(rule.word)} className="rounded-full p-2 text-faint opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card tone="sky" bordered={false} className="p-5">
          <div className="flex items-start gap-3">
            <Wand2 size={18} className="mt-0.5 shrink-0 text-[#2c7fb8]" />
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">What is Dictionary?</div>
              <p className="text-sm leading-relaxed text-muted">
                Add custom words Whisper may not recognize — technical terms, brand names, or jargon specific to your work — so Vaani transcribes them correctly.
              </p>
            </div>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
