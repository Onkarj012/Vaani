import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Pencil, Plus, ScrollText, Search, Trash2, Wand2, X } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'
import { Toggle } from '@renderer/components/ui/toggle'
import { editCorrection } from '@shared/textRuleEdits'
import type { CustomCorrection } from '@shared/types'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

type RuleFilter = 'all' | 'manual' | 'auto' | 'off'
const FILTERS: ReadonlyArray<readonly [RuleFilter, string]> = [['all', 'All'], ['manual', 'Manual'], ['auto', 'Auto-suggested'], ['off', 'Disabled']]
// Columns: spoken and written, matching flags, source, hits, on switch, actions.
const ROW_GRID = 'grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.35fr)_84px_80px_46px_64px] items-center gap-3.5 px-3.5'
const FIELD = 'h-11 rounded-[14px] border-transparent bg-white px-3.5 py-0 text-[15px] pastel-scope focus:border-transparent focus:bg-white focus:ring-2 focus:ring-accent'

// Auto-suggested rules come from the cleanup review. Everything else is manual.
function isAuto(rule: CustomCorrection): boolean {
  return rule.source === 'auto-suggested'
}

// A rule is on unless it was switched off.
function isOn(rule: CustomCorrection): boolean {
  return rule.enabled !== false
}

// Keeps rules that match the search text and the segmented filter.
function filterRules(rules: CustomCorrection[], query: string, filter: RuleFilter): CustomCorrection[] {
  const needle = query.toLowerCase()
  return rules.filter((rule) => {
    const matchesQuery = rule.spoken.toLowerCase().includes(needle) || rule.written.toLowerCase().includes(needle)
    const matchesFilter = filter === 'all'
      || (filter === 'manual' && !isAuto(rule))
      || (filter === 'auto' && isAuto(rule))
      || (filter === 'off' && !isOn(rule))
    return matchesQuery && matchesFilter
  })
}

// Sum of hit counts, or null when no rule has recorded a hit yet.
function totalHits(rules: CustomCorrection[]): number | null {
  const counted = rules.flatMap((rule) => (rule.hitCount === undefined ? [] : [rule.hitCount]))
  return counted.length === 0 ? null : counted.reduce((sum, hits) => sum + hits, 0)
}

// Pill for one matching option, filled ink when that option is on.
function Flag({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${on ? 'border-transparent bg-ink text-bg' : 'border-line text-faint'}`}>
      {children}
    </span>
  )
}

// Switch with its label beside it. Clicking the label also flips the switch.
function OptionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium">
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
      {label}
    </label>
  )
}

// Pill group where one segment is active.
function Segmented<T extends string>({ options, value, onChange }: { options: ReadonlyArray<readonly [T, string]>; value: T; onChange: (next: T) => void }) {
  return (
    <div className="flex shrink-0 rounded-full bg-surface p-[3px]">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`h-8 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-semibold transition-colors ${value === id ? 'bg-card text-ink shadow-sm dark:bg-[#34343b]' : 'text-muted hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Dictionary() {
  const { addDictionaryWord, removeDictionaryWord, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<RuleFilter>('all')
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

  const rules = settings.customCorrections
  const visible = filterRules(rules, searchQuery, filter)
  const editing = editingWord === null ? undefined : rules.find((rule) => rule.spoken === editingWord)
  const hits = totalHits(rules)
  const maxHits = Math.max(1, ...rules.map((rule) => rule.hitCount ?? 0))

  // Clears the editor and closes it.
  const resetForm = () => {
    setNewTrigger(''); setNewReplacement(''); setNewEnabled(true); setNewWholeWord(true)
    setNewCaseSensitive(false); setNewFuzzy(false); setEditingWord(null); setIsAdding(false)
    setSaveError('')
  }

  // Fills the editor with one existing rule.
  const beginEdit = (word: string) => {
    const rule = rules.find((item) => item.spoken === word)
    if (!rule) return
    setNewTrigger(rule.spoken); setNewReplacement(rule.written); setNewEnabled(isOn(rule))
    setNewWholeWord(rule.wholeWord !== false); setNewCaseSensitive(rule.caseSensitive === true)
    setNewFuzzy(rule.fuzzy === true); setEditingWord(word); setIsAdding(true)
  }

  // Saves the editor as a new rule or as a change to the one being edited.
  const handleSave = () => {
    const word = newTrigger.trim().replace(/\s+/g, ' ')
    if (!word) return
    const conflict = rules.some((rule) => rule.spoken.toLocaleLowerCase() === word.toLocaleLowerCase()
      && rule.spoken.toLocaleLowerCase() !== editingWord?.toLocaleLowerCase())
    if (conflict) { setSaveError('A rule with this trigger already exists.'); return }
    const replacement = newReplacement.trim().replace(/\s+/g, ' ') || (editingWord === null ? word : '')
    const options = { enabled: newEnabled, wholeWord: newWholeWord, caseSensitive: newCaseSensitive, fuzzy: newFuzzy }
    if (editingWord !== null) {
      void updateSettings({ customCorrections: editCorrection(rules, editingWord, { spoken: word, written: replacement, ...options }) })
    } else {
      void updateSettings({ customCorrections: [...rules, { spoken: word, written: replacement, source: 'manual', ...options }] })
    }
    resetForm()
  }

  // Turns one rule on or off through the same save path as the editor.
  const toggleRule = (rule: CustomCorrection) => {
    void updateSettings({ customCorrections: editCorrection(rules, rule.spoken, { spoken: rule.spoken, written: rule.written, enabled: !isOn(rule) }) })
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-6">
      <motion.div variants={item} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label-meta text-[10px] text-faint">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}{hits === null ? '' : ` · ${hits} ${hits === 1 ? 'fix' : 'fixes'}`}
          </p>
          <h1 className="text-display text-[56px] text-ink">Dictionary</h1>
          <p className="mt-3 max-w-[460px] text-sm text-muted">Words Vaani should always write your way. Rules run after cleanup.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsAdding(true) }}><Plus size={15} />New rule</Button>
      </motion.div>

      {!settings.dictionaryOnboarded && (
        <motion.div variants={item}>
          <Card tone="lav" bordered={false}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-display text-lg text-ink">Dictionary tutorial</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">Dictionary rules replace trigger words in your transcriptions. If Whisper transcribes &quot;gonna&quot; but you prefer &quot;going to&quot;, add a rule.</p>
              </div>
              <button onClick={() => updateSettings({ dictionaryOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-muted">Trigger</label><Input value={demoTrigger} onChange={(e) => setDemoTrigger(e.target.value)} placeholder="e.g. gonna" className="bg-bg" /></div>
              <div><label className="mb-1 block text-xs font-medium text-muted">Replacement</label><Input value={demoReplacement} onChange={(e) => setDemoReplacement(e.target.value)} placeholder="e.g. going to" className="bg-bg" /></div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="accent" size="sm" onClick={() => { if (!demoTrigger.trim()) return; void addDictionaryWord({ word: demoTrigger.trim().toLowerCase(), replacement: demoReplacement.trim() }); setDemoTrigger(''); setDemoReplacement(''); void updateSettings({ dictionaryOnboarded: true }) }}>Add Example Rule</Button>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ dictionaryOnboarded: true })}>Skip</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="space-y-4 rounded-[22px] bg-chip-lav p-5 pastel-scope">
              <div className="flex items-center justify-between">
                <span className="label-meta text-[10px] pastel-scope/55">{editing ? 'Edit rule' : 'New rule'}</span>
                <button onClick={resetForm} aria-label="Close" className="rounded-full p-1.5 pastel-scope/60 hover:bg-white/50"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-[1fr_30px_1fr] items-end gap-3">
                <label className="block">
                  <span className="label-meta mb-1.5 block text-[10px] pastel-scope/55">When I say</span>
                  <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="e.g. gonna" className={FIELD} />
                </label>
                <ArrowRight size={18} className="mb-3.5 justify-self-center" />
                <label className="block">
                  <span className="label-meta mb-1.5 block text-[10px] pastel-scope/55">Write</span>
                  <Input value={newReplacement} onChange={(e) => setNewReplacement(e.target.value)} placeholder="e.g. going to" className={FIELD} />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-[18px] gap-y-2">
                <OptionToggle label="Enabled" checked={newEnabled} onChange={setNewEnabled} />
                <OptionToggle label="Whole word" checked={newWholeWord} onChange={setNewWholeWord} />
                <OptionToggle label="Case-sensitive" checked={newCaseSensitive} onChange={setNewCaseSensitive} />
                <OptionToggle label="Fuzzy match" checked={newFuzzy} onChange={setNewFuzzy} />
              </div>
              <p className="text-xs leading-relaxed pastel-scope/60">Fuzzy matching can correct close spoken matches. Whole-word matching avoids changing part of a longer word.</p>
              {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>{editing ? 'Save Changes' : 'Create Rule'}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={item} className="flex items-center gap-3">
        <div className="relative max-w-[340px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search rules…"
            className="h-10 rounded-full border-transparent bg-surface py-0 pl-10 pr-4 focus:border-accent focus:bg-surface"
          />
        </div>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      </motion.div>

      <motion.div variants={item}>
        <Card className="p-2">
          <div className={`${ROW_GRID} label-meta h-[38px] text-[10px] text-faint`}>
            <span>Spoken → written</span><span>Matching</span><span>Source</span><span>Hits</span><span>On</span><span />
          </div>
          {visible.length === 0 ? (
            <div className="py-16 text-center">
              <ScrollText size={44} className="mx-auto mb-4 text-line" />
              <h3 className="text-display text-xl text-ink">No rules found</h3>
              <p className="mt-2 text-sm text-muted">Add your first dictionary rule.</p>
            </div>
          ) : visible.map((rule) => (
            <div key={rule.spoken} className={`${ROW_GRID} min-h-[62px] rounded-2xl py-2 transition-colors hover:bg-surface ${isOn(rule) ? '' : 'opacity-[0.45]'}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <code className="shrink-0 whitespace-nowrap rounded-[9px] bg-surface px-2.5 py-1.5 font-mono text-[13px] text-muted">{rule.spoken}</code>
                <ArrowRight size={15} className="shrink-0 text-faint" />
                <span className="text-display truncate text-[21px] text-ink">{rule.written || <span className="italic text-faint">(remove word)</span>}</span>
              </div>
              <div className="flex gap-1">
                <Flag on={rule.wholeWord !== false}>Whole word</Flag>
                <Flag on={rule.caseSensitive === true}>Aa</Flag>
                <Flag on={rule.fuzzy === true}>Fuzzy</Flag>
              </div>
              <div><Tag tone={isAuto(rule) ? 'butter' : 'sky'}>{isAuto(rule) ? 'Auto' : 'Manual'}</Tag></div>
              {rule.hitCount === undefined ? (
                <span className="text-faint">—</span>
              ) : (
                <span className="flex items-center gap-2 font-mono text-xs text-ink">
                  <i className="block h-[5px] rounded-full bg-accent" style={{ width: Math.max(4, (rule.hitCount / maxHits) * 48) }} />
                  {rule.hitCount}
                </span>
              )}
              <Toggle checked={isOn(rule)} onChange={() => toggleRule(rule)} aria-label={`Enable ${rule.spoken}`} />
              <div className="flex justify-end gap-0.5">
                <button aria-label={`Edit ${rule.spoken}`} onClick={() => beginEdit(rule.spoken)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"><Pencil size={14} /></button>
                <button aria-label={`Delete ${rule.spoken}`} onClick={() => void removeDictionaryWord(rule.spoken)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card tone="sky" bordered={false} className="p-5">
          <div className="flex items-start gap-3">
            <Wand2 size={18} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">What is Dictionary?</div>
              <p className="text-sm leading-relaxed text-muted">Add custom words Whisper may not recognize — technical terms, brand names, or jargon specific to your work — so Vaani transcribes them correctly.</p>
            </div>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
