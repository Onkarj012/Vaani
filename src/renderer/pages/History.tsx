import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Copy, RotateCcw, Trash2, Clock, Type, X, Check, AudioLines, Edit3, FileWarning, RefreshCw, Globe, Play, ShieldAlert } from 'lucide-react'
import { useVaaniUi } from '@renderer/context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import type { DictationTrace } from '@shared/types'
import { getLanguageLabel } from '@shared/defaults'
import { dedupeRecoveryEntries, deriveRecoveryItem, filterRecoveryItems, type RecoveryAction, type RecoveryFilter } from '@renderer/lib/recoveryDerivations'

type TraceLoadState = DictationTrace | null | 'loading'

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export default function History() {
  const { historyItems, updateHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry, retryHistoryEntry, copyHistoryEntry, recoveryEntries, reloadHistory, retryRecoveryTranscription, retryRecoveryFormatting, useRawRecoveryTranscript, retryRecoveryInsertion, copyRecoveryEntry, playRecoveryAudio, deleteRecoveryAudio, discardRecoveryEntry } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [traces, setTraces] = useState<Record<string, TraceLoadState>>({})
  const [recoveryFilter, setRecoveryFilter] = useState<RecoveryFilter>('all')

  const groups = ['Today', 'Yesterday', 'This Week', 'Earlier']
  const grouped = groups
    .map((group) => ({
      date: group,
      items: historyItems
        .filter((it) => it.group === group)
        .filter((it) => it.text.toLowerCase().includes(searchQuery.toLowerCase())),
    }))
    .filter((group) => group.items.length > 0)
  const recoveryItems = useMemo(
    () => filterRecoveryItems(
      dedupeRecoveryEntries(recoveryEntries).map((entry) => deriveRecoveryItem(entry)),
      recoveryFilter,
    ).filter((item) => item.preview.toLowerCase().includes(searchQuery.toLowerCase())),
    [recoveryEntries, recoveryFilter, searchQuery],
  )

  const runRecoveryAction = async (id: string, action: RecoveryAction) => {
    if (action === 'delete-audio' && !window.confirm('Delete the encrypted recovery audio? The transcript will stay in History.')) return
    if (action === 'discard' && !window.confirm('Discard this recovery item and its encrypted audio?')) return
    if (action === 'retry-transcription') await retryRecoveryTranscription(id)
    if (action === 'retry-formatting') await retryRecoveryFormatting(id)
    if (action === 'use-raw-transcript') await useRawRecoveryTranscript(id)
    if (action === 'retry-insertion') await retryRecoveryInsertion(id)
    if (action === 'copy') { await copyRecoveryEntry(id); await reloadHistory() }
    if (action === 'play-audio') await playRecoveryAudio(id)
    if (action === 'delete-audio') await deleteRecoveryAudio(id)
    if (action === 'discard') await discardRecoveryEntry(id)
  }

  const handleSave = () => {
    if (editingId) void updateHistoryEntry(editingId, editText)
    setEditingId(null)
  }

  useEffect(() => {
    const item = historyItems.find((candidate) => candidate.id === expandedId)
    if (!item?.traceId || traces[item.traceId] !== undefined) return
    const traceId = item.traceId
    setTraces((current) => ({ ...current, [traceId]: 'loading' }))
    void window.vaani.getDictationTrace(traceId)
      .then((trace) => {
        setTraces((current) => ({ ...current, [traceId]: trace ?? null }))
      })
      .catch(() => {
        setTraces((current) => ({ ...current, [traceId]: null }))
      })
  }, [expandedId, historyItems, traces])

  const copyBugReport = async (entryId: string) => {
    const report = await window.vaani.exportBugReport(entryId)
    await window.vaani.copyText(JSON.stringify(report, null, 2))
  }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-7">
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

      {recoveryEntries.length > 0 && (
        <RecoverySection total={recoveryEntries.length} items={recoveryItems} filter={recoveryFilter} onFilterChange={setRecoveryFilter} onAction={(id, action) => { void runRecoveryAction(id, action) }} />
      )}

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
                        {expandedId === it.id && it.traceId && (
                          <Diagnostics trace={resolvedTrace(traces[it.traceId])} />
                        )}

                        <div className="label-meta mt-4 flex items-center gap-3 text-[10px] text-faint">
                          <span className="flex items-center gap-1"><Clock size={11} />{it.time}</span>
                          <span className="flex items-center gap-1"><AudioLines size={11} />{it.duration}</span>
                          <span className="flex items-center gap-1"><Type size={11} />{it.wordCount} words</span>
                          {(it.detectedLanguage || it.language) && (
                            <span className="flex items-center gap-1">
                              <Globe size={11} />{getLanguageLabel(it.detectedLanguage || it.language)}
                            </span>
                          )}
                          <span>{it.injectionStatus === 'injected' ? 'Inserted' : 'Saved'}</span>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <Button variant="soft" size="sm" onClick={() => copyHistoryEntry(it.text)}><Copy size={13} />Copy</Button>
                          <Button variant="soft" size="sm" onClick={() => reinjectHistoryEntry(it.id)}><RotateCcw size={13} />Re-inject</Button>
                          <Button variant="soft" size="sm" onClick={() => retryHistoryEntry(it.id)}><RefreshCw size={13} />Retry</Button>
                          <Button variant="soft" size="sm" onClick={() => { setEditingId(it.id); setEditText(it.text) }}><Edit3 size={13} />Edit</Button>
                          {it.traceId && (
                            <Button variant="soft" size="sm" onClick={() => setExpandedId(expandedId === it.id ? null : it.id)}><AudioLines size={13} />Diagnostics</Button>
                          )}
                          <Button variant="soft" size="sm" onClick={() => copyBugReport(it.id)}><FileWarning size={13} />Report</Button>
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

function RecoverySection({
  total,
  items,
  filter,
  onFilterChange,
  onAction,
}: {
  total: number;
  items: ReturnType<typeof deriveRecoveryItem>[];
  filter: RecoveryFilter;
  onFilterChange: (filter: RecoveryFilter) => void;
  onAction: (id: string, action: RecoveryAction) => void;
}) {
  const filters: Array<{ value: RecoveryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'needs-transcription', label: 'Transcription' },
    { value: 'needs-formatting', label: 'Formatting' },
    { value: 'ready-to-insert', label: 'Ready to insert' },
    { value: 'text-only', label: 'Text only' },
  ]
  return (
    <motion.section variants={item} aria-labelledby="recovery-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <h2 id="recovery-heading" className="text-display text-2xl text-ink">Recovery</h2>
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">{total}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {filters.map((option) => (
            <button key={option.value} onClick={() => onFilterChange(option.value)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === option.value ? 'bg-ink text-bg' : 'bg-surface text-muted hover:bg-line hover:text-ink'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? <p className="rounded-2xl border border-line p-5 text-sm text-muted">No recovery items match this filter.</p> : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.entry.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{item.status}</span>
                    {item.entry.recoveryMode === 'text-only' && <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted">Reduced recovery</span>}
                  </div>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink/85">{item.preview}</p>
                </div>
                <div className="label-meta text-right text-[10px] text-faint">
                  <div>{item.age}</div>
                  <div className="mt-1">{item.expires}</div>
                </div>
              </div>
              <div className="label-meta mt-4 flex flex-wrap items-center gap-3 text-[10px] text-faint">
                <span>{item.entry.audioAvailable ? `Audio available${item.entry.audioDurationSeconds ? ` · ${Math.round(item.entry.audioDurationSeconds)}s` : ''}` : 'Audio unavailable'}</span>
                {item.entry.appName && <span>Target noted: {item.entry.appName}</span>}
                <span>State: {item.entry.state.replaceAll('_', ' ')}</span>
              </div>
              {item.entry.lastError.class !== 'none' && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/5 p-3 text-xs text-red-600"><ShieldAlert size={14} className="mt-0.5 shrink-0" /><span>Last error: {item.entry.lastError.class.replaceAll('_', ' ')}{item.entry.lastError.detail ? ` · ${item.entry.lastError.detail}` : ''}</span></div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {item.actions.map((action) => <RecoveryActionButton key={action} action={action} onClick={() => onAction(item.entry.id, action)} />)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.section>
  )
}

function RecoveryActionButton({ action, onClick }: { action: RecoveryAction; onClick: () => void }) {
  const labels: Record<RecoveryAction, string> = {
    'retry-transcription': 'Retry transcription',
    'retry-formatting': 'Retry formatting',
    'use-raw-transcript': 'Use raw transcript',
    'retry-insertion': 'Retry insertion',
    copy: 'Copy',
    'play-audio': 'Play audio',
    'delete-audio': 'Delete audio',
    discard: 'Discard',
  }
  const Icon = action === 'copy' ? Copy : action === 'play-audio' ? Play : action === 'discard' || action === 'delete-audio' ? Trash2 : action.startsWith('retry') ? RefreshCw : RotateCcw
  return <Button variant={action === 'discard' || action === 'delete-audio' ? 'destructive' : 'soft'} size="sm" onClick={onClick}><Icon size={13} />{labels[action]}</Button>
}

function Diagnostics({ trace }: { trace: DictationTrace | null | undefined }) {
  if (trace === undefined) {
    return <div className="mt-4 rounded-md border border-line bg-bg/60 p-3 text-xs text-muted">Loading diagnostics…</div>
  }
  if (!trace) {
    return <div className="mt-4 rounded-md border border-line bg-bg/60 p-3 text-xs text-muted">No diagnostics saved for this dictation.</div>
  }
  const raw = trace.rawAudio
  const trimmed = trace.trimmedAudio
  return (
    <div className="mt-4 grid gap-3 rounded-md border border-line bg-bg/60 p-3 text-xs text-muted sm:grid-cols-2">
      <Diagnostic label="Outcome" value={trace.outcome} />
      <Diagnostic label="Target" value={trace.targetAppName ?? 'Unknown app'} />
      <Diagnostic label="STT" value={`${trace.sttProvider ?? 'default'}${trace.sttLatencyMs ? ` · ${trace.sttLatencyMs}ms` : ''}`} />
      <Diagnostic label="Reason" value={trace.rejectionReason ?? trace.userMessage ?? 'None'} />
      <Diagnostic label="Quality" value={trace.qualityDecision ? `${trace.qualityDecision.action} · ${trace.qualityDecision.reason}` : 'Not captured'} />
      <Diagnostic label="Raw audio" value={raw ? `${raw.durationSeconds.toFixed(2)}s · peak ${raw.peakAmplitude.toFixed(2)} · clip ${(raw.clippingRatio * 100).toFixed(2)}%` : 'Not captured'} />
      <Diagnostic label="Trimmed audio" value={trimmed ? `${trimmed.durationSeconds.toFixed(2)}s · silence ${(trimmed.silenceRatio * 100).toFixed(0)}%` : 'Not captured'} />
      {trace.rawAudioPath && <div className="sm:col-span-2 truncate text-faint">Audio: {trace.rawAudioPath}</div>}
    </div>
  )
}

function resolvedTrace(trace: TraceLoadState | undefined): DictationTrace | null | undefined {
  return trace === 'loading' ? undefined : trace
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-meta mb-1 text-[9px] text-faint">{label}</div>
      <div className="truncate text-ink/80">{value}</div>
    </div>
  )
}
