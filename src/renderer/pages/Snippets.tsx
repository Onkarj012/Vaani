import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Terminal, Copy, Check, Search } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'
import { Toggle } from '@renderer/components/ui/toggle'
import { editSnippet, normalizeAppProfileIds, normalizeSnippetTrigger } from '@shared/textRuleEdits'
import type { AppProfile, Snippet } from '@shared/types'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

// Names of the apps a snippet is limited to, or "All apps" when it has no limit.
function scopeLabel(snippet: Snippet, profiles: AppProfile[]): string {
  const ids = normalizeAppProfileIds(snippet.appProfileIds)
  if (ids === undefined) return 'All apps'
  const names = profiles.filter((profile) => ids.includes(profile.id)).map((profile) => profile.name)
  return names.length > 0 ? names.join(', ') : `${ids.length} ${ids.length === 1 ? 'app' : 'apps'}`
}

export default function Snippets() {
  const { addSnippet, removeSnippet, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingTrigger, setEditingTrigger] = useState<string | null>(null)
  const [newTrigger, setNewTrigger] = useState('')
  const [newContent, setNewContent] = useState('')
  const [matchBareTrigger, setMatchBareTrigger] = useState(false)
  const [allApps, setAllApps] = useState(true)
  const [selectedAppProfileIds, setSelectedAppProfileIds] = useState<string[]>([])
  const [saveError, setSaveError] = useState('')
  const [copiedTrigger, setCopiedTrigger] = useState<string | null>(null)

  const profiles = settings.appProfiles ?? []
  const query = searchQuery.toLowerCase()
  const filtered = settings.snippets.filter(
    (s) => s.trigger.toLowerCase().includes(query) || s.content.toLowerCase().includes(query)
  )
  const editing = editingTrigger === null ? undefined : settings.snippets.find((snippet) => snippet.trigger === editingTrigger)
  const count = settings.snippets.length

  // Clears the editor back to a new, empty snippet.
  const resetForm = () => {
    setNewTrigger(''); setNewContent(''); setMatchBareTrigger(false); setAllApps(true)
    setSelectedAppProfileIds([]); setEditingTrigger(null)
    setSaveError('')
  }

  // Fills the editor with one existing snippet.
  const beginEdit = (trigger: string) => {
    const snippet = settings.snippets.find((item) => item.trigger === trigger)
    if (!snippet) return
    setNewTrigger(snippet.trigger); setNewContent(snippet.content); setMatchBareTrigger(snippet.matchBareTrigger === true)
    const ids = normalizeAppProfileIds(snippet.appProfileIds)
    setAllApps(ids === undefined); setSelectedAppProfileIds(ids ?? []); setEditingTrigger(trigger)
  }

  // Saves the editor as a new snippet or as a change to the one being edited.
  const handleSave = () => {
    const trigger = normalizeSnippetTrigger(newTrigger)
    const content = newContent.trim()
    if (!trigger || !content) return
    const conflict = settings.snippets.some((snippet) => snippet.trigger.toLocaleLowerCase() === trigger.toLocaleLowerCase()
      && snippet.trigger.toLocaleLowerCase() !== editingTrigger?.toLocaleLowerCase())
    if (conflict) { setSaveError('A snippet with this trigger already exists.'); return }
    const scope = allApps ? undefined : normalizeAppProfileIds(selectedAppProfileIds)
    const edit = { trigger, content, matchBareTrigger, appProfileIds: scope }
    if (editingTrigger !== null) {
      void updateSettings({ snippets: editSnippet(settings.snippets, editingTrigger, edit) })
    } else {
      const snippet = { trigger, content, matchBareTrigger, ...(scope === undefined ? {} : { appProfileIds: scope }) }
      void updateSettings({ snippets: [...settings.snippets, snippet] })
    }
    resetForm()
  }

  // Deletes the open snippet and clears the editor.
  const handleDelete = () => {
    if (!editing) return
    void removeSnippet(editing.trigger)
    resetForm()
  }

  // Copies a snippet's saved text and shows a check mark for two seconds.
  const handleCopy = (trigger: string, content: string) => {
    void navigator.clipboard.writeText(content)
    setCopiedTrigger(trigger)
    setTimeout(() => setCopiedTrigger(null), 2000)
  }

  // Adds or removes one app profile from the snippet's scope.
  const toggleProfile = (id: string) => {
    setSelectedAppProfileIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  const spokenTrigger = normalizeSnippetTrigger(newTrigger) || 'trigger'

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-6">
      <motion.div variants={item} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label-meta text-[10px] text-faint">{count} {count === 1 ? 'snippet' : 'snippets'}</p>
          <h1 className="text-display text-[56px] text-ink">Snippets</h1>
          <p className="mt-3 max-w-[460px] text-sm text-muted">Say “slash” and a trigger. Vaani pastes the full text.</p>
        </div>
        <Button onClick={resetForm}><Plus size={15} />New snippet</Button>
      </motion.div>

      {!settings.snippetsOnboarded && (
        <motion.div variants={item}><Card tone="butter" bordered={false}>
          <div className="mb-4 flex items-start justify-between gap-4"><div><h3 className="text-display text-lg text-ink">Snippets tutorial</h3><p className="mt-1 text-sm leading-relaxed text-muted">Snippets expand into longer text. Type <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-xs">/email</code> or say &ldquo;snippet email&rdquo; or &ldquo;slash email&rdquo; and Vaani replaces it with your full signature.</p></div><button onClick={() => updateSettings({ snippetsOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button></div>
          <div className="flex items-center gap-3"><Button variant="accent" size="sm" onClick={() => { void addSnippet({ trigger: 'sig', content: 'Best regards,\n[Your Name]\n[Your Title]\n[Your Company]' }); void updateSettings({ snippetsOnboarded: true }) }}>Add /sig Example</Button><Button variant="ghost" size="sm" onClick={() => updateSettings({ snippetsOnboarded: true })}>Skip</Button></div>
        </Card></motion.div>
      )}

      <motion.div variants={item} className="relative">
        <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search snippets…"
          className="h-10 max-w-[340px] rounded-full border-transparent bg-surface py-0 pl-10 pr-4 focus:border-accent focus:bg-surface"
        />
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-[1fr_400px] items-start gap-4">
        <Card className="p-2">
          {filtered.length === 0 ? (
            <div className="py-20 text-center">
              <Terminal size={44} className="mx-auto mb-4 text-line" />
              <h3 className="text-display text-xl text-ink">No snippets found</h3>
              <p className="mt-2 text-sm text-muted">Create your first snippet to get started.</p>
            </div>
          ) : filtered.map((snippet) => {
            const selected = snippet.trigger === editingTrigger
            const scope = scopeLabel(snippet, profiles)
            return (
              <button
                key={snippet.trigger}
                type="button"
                onClick={() => beginEdit(snippet.trigger)}
                className={`grid w-full grid-cols-[118px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[18px] px-4 py-3.5 text-left transition-colors ${selected ? 'bg-chip-blush pastel-scope' : 'hover:bg-surface'}`}
              >
                <span className="text-display truncate text-[23px]"><span className="text-accent">/</span>{snippet.trigger}</span>
                <span className={`truncate text-[13px] ${selected ? 'pastel-scope/60' : 'text-muted'}`}>{snippet.content.replace(/\n/g, ' · ')}</span>
                <span className="flex flex-col items-end gap-1.5">
                  <Tag tone={scope === 'All apps' ? 'mint' : 'sky'}>{scope}</Tag>
                  {snippet.matchBareTrigger && <span className="label-meta text-[10px] text-faint">bare</span>}
                </span>
              </button>
            )
          })}
        </Card>

        <Card className="sticky top-0 p-5">
          <div className="label-meta text-[10px] text-faint">{editing ? 'Editing' : 'New snippet'}</div>

          <div className="mt-4">
            <span className="label-meta mb-1.5 block text-[10px] text-faint">Trigger</span>
            <div className="flex h-11 items-center rounded-[14px] bg-surface px-3.5 font-mono text-[15px] font-semibold">
              <span className="mr-0.5 text-accent">/</span>
              <input
                aria-label="Trigger"
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                placeholder="trigger"
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
              />
            </div>
          </div>

          <div className="mt-4">
            <span className="label-meta mb-1.5 block text-[10px] text-faint">Expands to</span>
            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Text to expand…"
              rows={4}
              className="rounded-[14px] border-transparent bg-surface font-mono text-[13px] leading-[1.55] focus:border-accent focus:bg-surface"
            />
          </div>

          <label className="mt-4 flex items-start gap-3">
            <Toggle checked={matchBareTrigger} onChange={setMatchBareTrigger} aria-label="Also match the bare trigger in dictated text" />
            <span className="min-w-0 text-[13px]">
              <span className="block font-semibold">Also match the bare trigger in dictated text</span>
              {matchBareTrigger && <span className="mt-1 block text-xs leading-relaxed text-muted">Bare triggers can collide with ordinary words in speech. Use a distinctive trigger such as “sig” instead of a common word such as “thanks”.</span>}
            </span>
          </label>

          <label className="mt-3 flex items-center gap-3 text-[13px] font-semibold">
            <Toggle checked={allApps} onChange={setAllApps} aria-label="Available in all apps" />
            Available in all apps
          </label>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {profiles.map((profile) => {
              const on = selectedAppProfileIds.includes(profile.id)
              return (
                <button
                  key={profile.id}
                  type="button"
                  disabled={allApps}
                  aria-pressed={on}
                  onClick={() => toggleProfile(profile.id)}
                  className={`h-[30px] rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-40 ${on ? 'border-accent bg-accent/15' : 'border-line'}`}
                >
                  {profile.name}
                </button>
              )
            })}
            {!allApps && profiles.length === 0 && <p className="text-xs text-muted">No app profiles are configured. Add an app profile in Settings first.</p>}
          </div>
          {!allApps && selectedAppProfileIds.length === 0 && <p className="mt-3 text-xs text-red-600">Select at least one app profile, or choose all apps.</p>}

          <div className="mt-4 rounded-2xl bg-[#121214] p-3.5 text-[12.5px] leading-normal text-white/85">
            <div className="label-meta text-[10px] text-white/40">Say “slash {spokenTrigger}” →</div>
            <p className="mt-2 whitespace-pre-line">{newContent.trim() || '…'}</p>
          </div>

          {saveError && <p role="alert" className="mt-3 text-xs text-red-600">{saveError}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={!allApps && selectedAppProfileIds.length === 0}>{editing ? 'Save Changes' : 'Create Snippet'}</Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            {editing && (
              <>
                <Button variant="ghost" size="sm" onClick={() => handleCopy(editing.trigger, editing.content)} aria-label={`Copy ${editing.trigger}`}>
                  {copiedTrigger === editing.trigger ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
                </Button>
                <Button variant="destructive" size="sm" className="ml-auto" onClick={handleDelete}><Trash2 size={14} />Delete</Button>
              </>
            )}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
