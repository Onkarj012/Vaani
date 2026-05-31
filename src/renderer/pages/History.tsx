import { useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Copy, RotateCcw, Trash2, Clock, Type, X, Check, AudioLines, Edit3 } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { Card } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export default function History() {
  const { historyItems, updateHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry, copyHistoryEntry } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const groups = ['Today', 'Yesterday', 'This Week', 'Earlier']
  const grouped = groups
    .map((group) => ({
      date: group,
      items: historyItems
        .filter((it) => it.group === group)
        .filter((it) => it.text.toLowerCase().includes(searchQuery.toLowerCase())),
    }))
    .filter((group) => group.items.length > 0)

  const handleSave = () => {
    if (editingId) void updateHistoryEntry(editingId, editText)
    setEditingId(null)
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-4xl space-y-7">
      <motion.div variants={item} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label-meta mb-2 text-[11px] text-accent">✦ Archive</p>
          <h1 className="text-display text-5xl text-ink">History</h1>
          <p className="mt-3 text-muted">Search and manage your past dictations.</p>
        </div>
        <span className="label-meta text-[11px] text-faint">{historyItems.length} total</span>
      </motion.div>

      <motion.div variants={item} className="relative">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search dictations…"
          className="pl-11"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-faint hover:text-ink">
            <X size={15} />
          </button>
        )}
      </motion.div>

      <div className="space-y-8">
        {grouped.length === 0 ? (
          <motion.div variants={item} className="py-20 text-center">
            <Search size={44} className="mx-auto mb-4 text-line" />
            <h3 className="text-display text-xl text-ink">No results found</h3>
            <p className="mt-2 text-sm text-muted">Try adjusting your search query.</p>
          </motion.div>
        ) : (
          grouped.map((group) => (
            <motion.div key={group.date} variants={item}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="label-meta text-[11px] text-muted">{group.date}</h2>
                <div className="h-px flex-1 bg-line" />
              </div>

              <div className="space-y-3">
                {group.items.map((it) => (
                  <Card key={it.id} hover className="p-5">
                    {editingId === it.id ? (
                      <div className="space-y-3">
                        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button variant="accent" size="sm" onClick={handleSave}><Check size={14} />Save</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className={`text-sm leading-relaxed text-ink/85 ${expandedId === it.id ? '' : 'line-clamp-2'}`}>{it.text}</p>
                        {it.text.length > 150 && (
                          <button
                            onClick={() => setExpandedId(expandedId === it.id ? null : it.id)}
                            className="mt-2 text-xs font-semibold text-accent transition-colors hover:text-accent-strong"
                          >
                            {expandedId === it.id ? 'Show less' : 'Show more'}
                          </button>
                        )}

                        <div className="label-meta mt-4 flex items-center gap-3 text-[10px] text-faint">
                          <span className="flex items-center gap-1"><Clock size={11} />{it.time}</span>
                          <span className="flex items-center gap-1"><AudioLines size={11} />{it.duration}</span>
                          <span className="flex items-center gap-1"><Type size={11} />{it.wordCount} words</span>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                          <Button variant="soft" size="sm" onClick={() => copyHistoryEntry(it.text)}><Copy size={13} />Copy</Button>
                          <Button variant="soft" size="sm" onClick={() => reinjectHistoryEntry(it.id)}><RotateCcw size={13} />Re-inject</Button>
                          <Button variant="soft" size="sm" onClick={() => { setEditingId(it.id); setEditText(it.text) }}><Edit3 size={13} />Edit</Button>
                          <button
                            onClick={() => deleteHistoryEntry(it.id)}
                            className="ml-auto rounded-full p-2 text-faint transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  )
}
