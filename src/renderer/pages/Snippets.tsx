import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Zap, X, Hash, Copy, Check, Terminal } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export default function Snippets() {
  const { snippets, addSnippet, removeSnippet, settings, updateSettings } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newTrigger, setNewTrigger] = useState('')
  const [newContent, setNewContent] = useState('')
  const [copiedTrigger, setCopiedTrigger] = useState<string | null>(null)

  const filtered = snippets.filter(
    (s) => s.trigger.toLowerCase().includes(searchQuery.toLowerCase()) || s.content.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAdd = () => {
    if (!newTrigger.trim() || !newContent.trim()) return
    void addSnippet({ trigger: newTrigger.startsWith('/') ? newTrigger.slice(1) : newTrigger, content: newContent })
    setNewTrigger(''); setNewContent(''); setIsAdding(false)
  }

  const handleCopy = (trigger: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedTrigger(trigger)
    setTimeout(() => setCopiedTrigger(null), 2000)
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-7">
      <motion.div variants={item} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label-meta mb-2 text-[11px] text-accent">✦ Shortcuts</p>
          <h1 className="text-display text-5xl text-ink">Snippets</h1>
          <p className="mt-3 text-muted">Slash commands that expand into full text.</p>
        </div>
        <Button onClick={() => setIsAdding(true)}><Plus size={16} />New Snippet</Button>
      </motion.div>

      {!settings.snippetsOnboarded && (
        <motion.div variants={item}>
          <Card tone="butter" bordered={false}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-display text-lg text-ink">Snippets tutorial</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Snippets are slash commands that expand into longer text. Type{' '}
                  <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-xs">/email</code> and Vaani replaces it with your full signature.
                </p>
              </div>
              <button onClick={() => updateSettings({ snippetsOnboarded: true })} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Dismiss</button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  void addSnippet({ trigger: 'sig', content: 'Best regards,\n[Your Name]\n[Your Title]\n[Your Company]' })
                  void updateSettings({ snippetsOnboarded: true })
                }}
              >
                Add /sig Example
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ snippetsOnboarded: true })}>Skip</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-display text-lg text-ink">New snippet</h3>
                <button onClick={() => setIsAdding(false)} className="rounded-full p-2 text-muted hover:bg-surface"><X size={16} /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">Trigger</label>
                  <div className="relative">
                    <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="/trigger" className="pl-9" />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">Content</label>
                  <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Text to expand…" rows={2} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                <Button variant="accent" size="sm" onClick={handleAdd}>Create Snippet</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={item}>
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search snippets…" />
      </motion.div>

      <motion.div variants={item} className="space-y-3">
        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <Terminal size={44} className="mx-auto mb-4 text-line" />
            <h3 className="text-display text-xl text-ink">No snippets found</h3>
            <p className="mt-2 text-sm text-muted">Create your first snippet to get started.</p>
          </div>
        ) : (
          filtered.map((snippet) => (
            <Card key={snippet.trigger} hover className="group p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <code className="rounded-lg bg-accent/10 px-2 py-1 font-mono text-sm font-semibold text-accent">/{snippet.trigger}</code>
                    <span className="label-meta flex items-center gap-1 text-[10px] text-faint"><Zap size={10} />Snippet</span>
                  </div>
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted">{snippet.content}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => handleCopy(snippet.trigger, snippet.content)} className="rounded-lg p-2 text-muted transition-colors hover:bg-surface">
                    {copiedTrigger === snippet.trigger ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
                  </button>
                  <button onClick={() => removeSnippet(snippet.trigger)} className="rounded-lg p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          ))
        )}
      </motion.div>
    </motion.div>
  )
}
