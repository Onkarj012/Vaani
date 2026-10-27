import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Zap, X, Hash, Copy, Check, Terminal, Pencil, Search, Mic } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { IconTile } from '@renderer/components/ui/icon-tile'
import { PageHeader, pageContainer as container, pageItem as item } from '@renderer/components/ui/page-header'
import { editSnippet, normalizeAppProfileIds, normalizeSnippetTrigger } from '@shared/textRuleEdits'

export default function Snippets() {
  const { snippets, addSnippet, removeSnippet, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<string | null>(null)
  const [newTrigger, setNewTrigger] = useState('')
  const [newContent, setNewContent] = useState('')
  const [matchBareTrigger, setMatchBareTrigger] = useState(false)
  const [allApps, setAllApps] = useState(true)
  const [selectedAppProfileIds, setSelectedAppProfileIds] = useState<string[]>([])
  const [saveError, setSaveError] = useState('')
  const [copiedTrigger, setCopiedTrigger] = useState<string | null>(null)

  const filtered = snippets.filter(
    (s) => s.trigger.toLowerCase().includes(searchQuery.toLowerCase()) || s.content.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const editing = editingTrigger === null ? undefined : settings.snippets.find((snippet) => snippet.trigger === editingTrigger)

  const resetForm = () => {
    setNewTrigger(''); setNewContent(''); setMatchBareTrigger(false); setAllApps(true)
    setSelectedAppProfileIds([]); setEditingTrigger(null); setIsAdding(false)
    setSaveError('')
  }

  const beginEdit = (trigger: string) => {
    const snippet = settings.snippets.find((item) => item.trigger === trigger)
    if (!snippet) return
    setNewTrigger(snippet.trigger); setNewContent(snippet.content); setMatchBareTrigger(snippet.matchBareTrigger === true)
    const ids = normalizeAppProfileIds(snippet.appProfileIds)
    setAllApps(ids === undefined); setSelectedAppProfileIds(ids ?? []); setEditingTrigger(trigger); setIsAdding(true)
  }

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

  const handleCopy = (trigger: string, content: string) => {
    void navigator.clipboard.writeText(content)
    setCopiedTrigger(trigger)
    setTimeout(() => setCopiedTrigger(null), 2000)
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Shortcuts"
        title="Snippets"
        description="Slash commands that expand into full text."
        actions={<Button onClick={() => { resetForm(); setIsAdding(true) }}><Plus size={15} />New Snippet</Button>}
      />

      {!settings.snippetsOnboarded && (
        <motion.div variants={item}>
          <Card tone="lav">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <IconTile size="sm"><Zap size={15} /></IconTile>
                <div>
                  <h3 className="type-title text-ink">Snippets tutorial</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">Snippets expand into longer text. Type <code className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink">/email</code> or say &ldquo;snippet email&rdquo; or &ldquo;slash email&rdquo; and Vaani replaces it with your full signature.</p>
                </div>
              </div>
              <button onClick={() => updateSettings({ snippetsOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="accent" size="sm" onClick={() => { void addSnippet({ trigger: 'sig', content: 'Best regards,\n[Your Name]\n[Your Title]\n[Your Company]' }); void updateSettings({ snippetsOnboarded: true }) }}>Add /sig Example</Button>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ snippetsOnboarded: true })}>Skip</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card className="space-y-5 shadow-card">
              <div className="flex items-center justify-between">
                <h3 className="type-title text-ink">{editing ? 'Edit snippet' : 'New snippet'}</h3>
                <button onClick={resetForm} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"><X size={16} /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Trigger</label>
                  <div className="relative"><Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="trigger" className="pl-9 font-mono" /></div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Content</label>
                  <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Text to expand…" rows={3} />
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-line bg-surface/50 p-4">
                <Checkbox
                  checked={matchBareTrigger}
                  onChange={setMatchBareTrigger}
                  description={matchBareTrigger ? 'Bare triggers can collide with ordinary words in speech. Use a distinctive trigger such as “sig” instead of a common word such as “thanks”.' : undefined}
                >
                  Also match the bare trigger in dictated text
                </Checkbox>
                <Checkbox checked={allApps} onChange={setAllApps}>Available in all apps</Checkbox>
                {!allApps && <div className="ml-7 grid gap-2.5 border-l border-line pl-4 sm:grid-cols-2">
                  {(settings.appProfiles ?? []).map((profile) => (
                    <Checkbox
                      key={profile.id}
                      checked={selectedAppProfileIds.includes(profile.id)}
                      onChange={(checked) => setSelectedAppProfileIds((current) => checked ? [...current, profile.id] : current.filter((id) => id !== profile.id))}
                    >
                      {profile.name}
                    </Checkbox>
                  ))}
                  {(settings.appProfiles ?? []).length === 0 && <p className="text-xs text-muted">No app profiles are configured. Add an app profile in Settings first.</p>}
                </div>}
              </div>
              {!allApps && selectedAppProfileIds.length === 0 && <p className="text-xs text-red-600">Select at least one app profile, or choose all apps.</p>}
              {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
              <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button><Button variant="accent" size="sm" onClick={handleSave} disabled={!allApps && selectedAppProfileIds.length === 0}>{editing ? 'Save Changes' : 'Create Snippet'}</Button></div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={item} className="relative">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search snippets…" className="h-11 pl-10" />
      </motion.div>

      <motion.div variants={item} className="grid gap-3 lg:grid-cols-2">
        {filtered.length === 0 ? (
          <div className="py-20 text-center lg:col-span-2">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-card text-faint shadow-soft"><Terminal size={20} /></div>
            <h3 className="type-display text-[26px] text-ink">No snippets found</h3>
            <p className="mt-1.5 text-[13px] text-muted">Create your first snippet to get started.</p>
          </div>
        ) : filtered.map((snippet) => (
          <Card key={snippet.trigger} hover className="group flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <code className="truncate rounded-md border border-accent/15 bg-accent/[0.07] px-2 py-0.5 font-mono text-[12.5px] text-accent">/{snippet.trigger}</code>
              <div className="-mr-1.5 -mt-1 flex items-center gap-0.5">
                <button aria-label={`Copy ${snippet.trigger}`} onClick={() => handleCopy(snippet.trigger, snippet.content)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface hover:text-ink">{copiedTrigger === snippet.trigger ? <Check size={14} className="text-accent" /> : <Copy size={14} />}</button>
                <button aria-label={`Edit ${snippet.trigger}`} onClick={() => beginEdit(snippet.trigger)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface hover:text-ink"><Pencil size={14} /></button>
                <button aria-label={`Delete ${snippet.trigger}`} onClick={() => removeSnippet(snippet.trigger)} className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="mt-3 line-clamp-3 flex-1 whitespace-pre-line text-[13.5px] leading-relaxed text-ink/80">{snippet.content}</p>
            <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11.5px] text-faint">
              <Mic size={11} className="shrink-0" />
              <span className="truncate">say &ldquo;snippet {snippet.trigger}&rdquo; or &ldquo;slash {snippet.trigger}&rdquo;{settings.snippets.find((entry) => entry.trigger === snippet.trigger)?.matchBareTrigger && ' · bare trigger enabled'}</span>
            </p>
          </Card>
        ))}
      </motion.div>
    </motion.div>
  )
}
