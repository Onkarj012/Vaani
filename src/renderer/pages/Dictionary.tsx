import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, X, Type, Replace, ScrollText, Wand2, Pencil, Search, ArrowRight } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { IconTile } from '@renderer/components/ui/icon-tile'
import { PageHeader, pageContainer as container, pageItem as item } from '@renderer/components/ui/page-header'
import { editCorrection } from '@shared/textRuleEdits'

export default function Dictionary() {
  const { userDictionary, addDictionaryWord, removeDictionaryWord, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [editingWord, setEditingWord] = useState<string | null>(null)
  const [newTrigger, setNewTrigger] = useState('')
  const [newReplacement, setNewReplacement] = useState('')
  const [newEnabled, setNewEnabled] = useState(true)
  const [newWholeWord, setNewWholeWord] = useState(true)
  const [newCaseSensitive, setNewCaseSensitive] = useState(false)
  const [newFuzzy, setNewFuzzy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [demoTrigger, setDemoTrigger] = useState('')
  const [demoReplacement, setDemoReplacement] = useState('')

  const filtered = userDictionary.filter(
    (rule) => rule.word.toLowerCase().includes(searchQuery.toLowerCase()) || rule.replacement.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const editing = editingWord === null ? undefined : settings.customCorrections.find((rule) => rule.spoken === editingWord)

  const resetForm = () => {
    setNewTrigger(''); setNewReplacement(''); setNewEnabled(true); setNewWholeWord(true)
    setNewCaseSensitive(false); setNewFuzzy(false); setEditingWord(null); setIsAdding(false)
    setSaveError('')
  }

  const beginEdit = (word: string) => {
    const rule = settings.customCorrections.find((item) => item.spoken === word)
    if (!rule) return
    setNewTrigger(rule.spoken); setNewReplacement(rule.written); setNewEnabled(rule.enabled !== false)
    setNewWholeWord(rule.wholeWord !== false); setNewCaseSensitive(rule.caseSensitive === true)
    setNewFuzzy(rule.fuzzy === true); setEditingWord(word); setIsAdding(true)
  }

  const handleSave = () => {
    const word = newTrigger.trim().replace(/\s+/g, ' ')
    if (!word) return
    const conflict = settings.customCorrections.some((rule) => rule.spoken.toLocaleLowerCase() === word.toLocaleLowerCase()
      && rule.spoken.toLocaleLowerCase() !== editingWord?.toLocaleLowerCase())
    if (conflict) { setSaveError('A rule with this trigger already exists.'); return }
    const replacement = newReplacement.trim().replace(/\s+/g, ' ') || (editingWord === null ? word : '')
    const options = { enabled: newEnabled, wholeWord: newWholeWord, caseSensitive: newCaseSensitive, fuzzy: newFuzzy }
    if (editingWord !== null) {
      void updateSettings({ customCorrections: editCorrection(settings.customCorrections, editingWord, { spoken: word, written: replacement, ...options }) })
    } else {
      void updateSettings({ customCorrections: [...settings.customCorrections, { spoken: word, written: replacement, source: 'manual', ...options }] })
    }
    resetForm()
  }

  const closeForm = () => resetForm()

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Vocabulary"
        title="Dictionary"
        description="Custom word replacements for your transcriptions."
        actions={<Button onClick={() => { resetForm(); setIsAdding(true) }}><Plus size={15} />New Rule</Button>}
      />

      {!settings.dictionaryOnboarded && (
        <motion.div variants={item}>
          <Card tone="lav">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <IconTile size="sm"><Wand2 size={15} /></IconTile>
                <div>
                  <h3 className="type-title text-ink">Dictionary tutorial</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">Dictionary rules replace trigger words in your transcriptions. If Whisper transcribes &quot;gonna&quot; but you prefer &quot;going to&quot;, add a rule.</p>
                </div>
              </div>
              <button onClick={() => updateSettings({ dictionaryOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-muted">Trigger</label><Input value={demoTrigger} onChange={(e) => setDemoTrigger(e.target.value)} placeholder="e.g. gonna" /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted">Replacement</label><Input value={demoReplacement} onChange={(e) => setDemoReplacement(e.target.value)} placeholder="e.g. going to" /></div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="accent" size="sm" onClick={() => { if (!demoTrigger.trim()) return; void addDictionaryWord({ word: demoTrigger.trim().toLowerCase(), replacement: demoReplacement.trim() }); setDemoTrigger(''); setDemoReplacement(''); void updateSettings({ dictionaryOnboarded: true }) }}>Add Example Rule</Button>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ dictionaryOnboarded: true })}>Skip</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card className="space-y-5 shadow-card">
              <div className="flex items-center justify-between">
                <h3 className="type-title text-ink">{editing ? 'Edit rule' : 'New rule'}</h3>
                <button onClick={closeForm} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"><X size={16} /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Trigger word</label>
                  <div className="relative"><Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="e.g. gonna" className="pl-9" /></div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Replacement</label>
                  <div className="relative"><Replace size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={newReplacement} onChange={(e) => setNewReplacement(e.target.value)} placeholder="e.g. going to" className="pl-9" /></div>
                </div>
              </div>
              <div className="grid gap-3 rounded-xl border border-line bg-surface/50 p-4 sm:grid-cols-2">
                <Checkbox checked={newEnabled} onChange={setNewEnabled}>Enabled</Checkbox>
                <Checkbox checked={newWholeWord} onChange={setNewWholeWord}>Whole-word matching</Checkbox>
                <Checkbox checked={newCaseSensitive} onChange={setNewCaseSensitive}>Case-sensitive</Checkbox>
                <Checkbox checked={newFuzzy} onChange={setNewFuzzy}>Allow fuzzy matching</Checkbox>
              </div>
              <p className="text-xs text-muted">Fuzzy matching can correct close spoken matches. Whole-word matching avoids changing part of a longer word.</p>
              {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
              <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={closeForm}>Cancel</Button><Button variant="accent" size="sm" onClick={handleSave}>{editing ? 'Save Changes' : 'Create Rule'}</Button></div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={item} className="relative">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search rules…" className="h-11 pl-10" />
      </motion.div>

      <motion.div variants={item}>
        <Card className="overflow-hidden p-0">
          <div className="label-meta grid grid-cols-12 gap-4 border-b border-line bg-surface/50 px-5 py-3 text-[9.5px] text-faint"><div className="col-span-3">Trigger</div><div className="col-span-5">Replacement</div><div className="col-span-2">Category</div><div className="col-span-2 text-right">Actions</div></div>
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-card text-faint shadow-soft"><ScrollText size={20} /></div>
              <h3 className="type-display text-[26px] text-ink">No rules found</h3>
              <p className="mt-1.5 text-[13px] text-muted">Add your first dictionary rule.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">{filtered.map((rule) => {
              const fullRule = settings.customCorrections.find((item) => item.spoken === rule.word)
              const disabled = fullRule?.enabled === false
              return (
                <div key={rule.word} className={`group grid grid-cols-12 items-center gap-4 px-5 py-3 transition-colors hover:bg-surface/60 ${disabled ? 'opacity-60' : ''}`}>
                  <div className="col-span-3 flex min-w-0 items-center gap-2">
                    <code className="truncate rounded-md border border-accent/15 bg-accent/[0.07] px-2 py-0.5 font-mono text-[12.5px] text-accent">{rule.word}</code>
                    {disabled && <Tag tone="surface">Disabled</Tag>}
                  </div>
                  <div className="col-span-5 flex min-w-0 items-center gap-2 text-[13.5px] text-ink/90">
                    <ArrowRight size={13} className="shrink-0 text-faint" />
                    <span className="truncate">{rule.replacement || <span className="italic text-faint">(remove word)</span>}</span>
                  </div>
                  <div className="col-span-2"><Tag tone="surface">{rule.category}</Tag></div>
                  <div className="col-span-2 flex justify-end gap-0.5">
                    <button aria-label={`Edit ${rule.word}`} onClick={() => beginEdit(rule.word)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-card hover:text-ink"><Pencil size={14} /></button>
                    <button aria-label={`Delete ${rule.word}`} onClick={() => removeDictionaryWord(rule.word)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}</div>
          )}
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <div className="flex items-start gap-3 rounded-xl bg-surface/70 px-4 py-3.5">
          <Wand2 size={15} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <div className="mb-0.5 text-[13px] font-semibold text-ink">What is Dictionary?</div>
            <p className="text-[13px] leading-relaxed text-muted">Add custom words Whisper may not recognize — technical terms, brand names, or jargon specific to your work — so Vaani transcribes them correctly.</p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
