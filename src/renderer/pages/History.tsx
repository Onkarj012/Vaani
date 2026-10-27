import { recoveryReadinessMessage } from "@shared/recoveryReadiness";
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Copy, RotateCcw, Trash2, Clock, Type, X, Check, AudioLines, Edit3, FileWarning, RefreshCw, Globe, Play, ShieldAlert } from 'lucide-react'
import { useVaaniUi } from '@renderer/context/vaani-ui'
import { Card } from '@renderer/components/ui/card'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'
import { PageHeader, pageContainer as container, pageItem as item } from '@renderer/components/ui/page-header'
import type { DictationTrace } from '@shared/types'
import { getLanguageLabel } from '@shared/defaults'
import { createRecoveryActionRunner, dedupeRecoveryEntries, deriveRecoveryItem, filterRecoveryItems, matchesRecoverySearch, type RecoveryAction, type RecoveryFilter } from '@renderer/lib/recoveryDerivations'

type TraceLoadState = DictationTrace | null | 'loading'


export default function History() {
  const { historyItems, updateHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry, retryHistoryEntry, copyHistoryEntry, recoveryReadiness, recoveryEntries, reloadHistory, retryRecoveryTranscription, retryRecoveryFormatting, useRawRecoveryTranscript, retryRecoveryInsertion, copyRecoveryEntry, playRecoveryAudio, deleteRecoveryAudio, discardRecoveryEntry } = useVaaniUi()
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [traces, setTraces] = useState<Record<string, TraceLoadState>>({})
  const [recoveryFilter, setRecoveryFilter] = useState<RecoveryFilter>('all')
  const [busyRecoveryIds, setBusyRecoveryIds] = useState<string[]>([])
  const [recoveryActionErrors, setRecoveryActionErrors] = useState<Record<string, string>>({})
  const [recoveryActionRunner] = useState(() => createRecoveryActionRunner(
    (id, busy) => setBusyRecoveryIds((current) => busy ? [...current, id] : current.filter((value) => value !== id)),
    (id, message) => setRecoveryActionErrors((current) => {
      const next = { ...current }
      if (message) next[id] = message
      else delete next[id]
      return next
    }),
  ))

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
    ).filter((item) => matchesRecoverySearch(item, searchQuery)),
    [recoveryEntries, recoveryFilter, searchQuery],
  )

  const runRecoveryAction = async (id: string, action: RecoveryAction) => {
    if (recoveryActionRunner.isBusy(id)) return
    if (action === 'delete-audio' && !window.confirm('Delete the encrypted recovery audio? The transcript will stay in History.')) return
    if (action === 'discard' && !window.confirm('Discard this recovery item and its encrypted audio?')) return
    await recoveryActionRunner.run(id, async () => {
      if (action === 'retry-transcription') return retryRecoveryTranscription(id)
      if (action === 'retry-formatting') return retryRecoveryFormatting(id)
      if (action === 'use-raw-transcript') return useRawRecoveryTranscript(id)
      if (action === 'retry-insertion') return retryRecoveryInsertion(id)
      if (action === 'copy') {
        const copied = await copyRecoveryEntry(id)
        if (copied) await reloadHistory()
        return copied
      }
      if (action === 'play-audio') return playRecoveryAudio(id)
      if (action === 'delete-audio') return deleteRecoveryAudio(id)
      return discardRecoveryEntry(id)
    })
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
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Archive"
        title="History"
        description="Search and manage your past dictations."
        actions={<Tag tone="surface" className="tabular-nums">{historyItems.length} total</Tag>}
      />

      <motion.div variants={item} className="relative">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search dictations…"
          className="h-11 pl-10"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:bg-surface hover:text-ink">
            <X size={14} />
          </button>
        )}
      </motion.div>

      <p role="status" className="flex items-start gap-2.5 rounded-xl bg-surface/70 px-4 py-3 text-[12.5px] leading-relaxed text-muted"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-faint" />{recoveryReadinessMessage(recoveryReadiness)}</p>
      {recoveryEntries.length > 0 && (
        <RecoverySection total={recoveryEntries.length} items={recoveryItems} filter={recoveryFilter} onFilterChange={setRecoveryFilter} busyIds={busyRecoveryIds} errors={recoveryActionErrors} onAction={(id, action) => { void runRecoveryAction(id, action) }} />
      )}

      <div className="space-y-8">
        {grouped.length === 0 ? (
          <motion.div variants={item} className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-card text-faint shadow-soft"><Search size={20} /></div>
            <h3 className="type-display text-[26px] text-ink">{searchQuery ? 'No results found' : 'Nothing here yet'}</h3>
            <p className="mt-1.5 text-[13px] text-muted">{searchQuery ? 'Try adjusting your search query.' : 'Your dictations will appear here.'}</p>
          </motion.div>
        ) : (
          grouped.map((group) => (
            <motion.div key={group.date} variants={item}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="label-meta text-[10.5px] text-faint">{group.date}</h2>
                <div className="h-px flex-1 bg-line" />
                <span className="text-[11px] tabular-nums text-faint">{group.items.length}</span>
              </div>

              <div className="space-y-2.5">
                {group.items.map((it) => (
                  <Card key={it.id} className="group p-5 hover:border-line-strong">
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
                        <p className={`text-[14px] leading-relaxed text-ink/90 ${expandedId === it.id ? '' : 'line-clamp-2'}`}>{it.text}</p>
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

                        <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-faint">
                          <span className="flex items-center gap-1"><Clock size={11} />{it.time}</span>
                          <span className="flex items-center gap-1 tabular-nums"><AudioLines size={11} />{it.duration}</span>
                          <span className="flex items-center gap-1"><Type size={11} />{it.wordCount} words</span>
                          {(it.detectedLanguage || it.language) && (
                            <span className="flex items-center gap-1">
                              <Globe size={11} />{getLanguageLabel(it.detectedLanguage || it.language)}
                            </span>
                          )}
                          {it.app !== 'Unknown' && <span>{it.app}</span>}
                          <Tag tone={it.injectionStatus === 'injected' ? 'success' : 'surface'}>{it.injectionStatus === 'injected' ? 'Inserted' : 'Saved'}</Tag>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3.5">
                          <Button variant="ghost" size="sm" onClick={() => copyHistoryEntry(it.text)}><Copy size={13} />Copy</Button>
                          <Button variant="ghost" size="sm" onClick={() => reinjectHistoryEntry(it.id)}><RotateCcw size={13} />Re-inject</Button>
                          <Button variant="ghost" size="sm" onClick={() => retryHistoryEntry(it.id)}><RefreshCw size={13} />Retry</Button>
                          <Button variant="ghost" size="sm" onClick={() => { setEditingId(it.id); setEditText(it.text) }}><Edit3 size={13} />Edit</Button>
                          {it.traceId && (
                            <Button variant="ghost" size="sm" onClick={() => setExpandedId(expandedId === it.id ? null : it.id)}><AudioLines size={13} />Diagnostics</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => copyBugReport(it.id)}><FileWarning size={13} />Report</Button>
                          <button
                            onClick={() => deleteHistoryEntry(it.id)}
                            aria-label="Delete dictation"
                            className="ml-auto rounded-lg p-2 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"
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
  busyIds,
  errors,
}: {
  total: number;
  items: ReturnType<typeof deriveRecoveryItem>[];
  filter: RecoveryFilter;
  onFilterChange: (filter: RecoveryFilter) => void;
  onAction: (id: string, action: RecoveryAction) => void;
  busyIds: string[];
  errors: Record<string, string>;
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
          <h2 id="recovery-heading" className="type-display text-[28px] text-ink">Recovery</h2>
          <Tag tone="warning" className="tabular-nums">{total}</Tag>
        </div>
        <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-surface p-0.5 sm:ml-auto">
          {filters.map((option) => (
            <button key={option.value} onClick={() => onFilterChange(option.value)} className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition-all ${filter === option.value ? 'bg-card text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? <p className="rounded-xl border border-dashed border-line-strong p-5 text-center text-[13px] text-muted">No recovery items match this filter.</p> : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.entry.id} className="border-l-2 border-l-amber-500/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="warning">{item.status}</Tag>
                    {item.entry.recoveryMode === 'text-only' && <Tag tone="surface">Reduced recovery</Tag>}
                  </div>
                  <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink/90">{item.preview}</p>
                </div>
                <div className="text-right text-[11.5px] text-faint">
                  <div>{item.age}</div>
                  <div className="mt-1">{item.expires}</div>
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-faint">
                <span>{item.entry.audioAvailable ? `Audio available${item.entry.audioDurationSeconds ? ` · ${Math.round(item.entry.audioDurationSeconds)}s` : ''}` : 'Audio unavailable'}</span>
                {item.entry.appName && <span>Target noted: {item.entry.appName}</span>}
                <span>State: {item.entry.state.replaceAll('_', ' ')}</span>
              </div>
              {item.entry.lastError.class !== 'none' && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/[0.05] p-3 text-xs text-red-600 dark:text-red-400"><ShieldAlert size={14} className="mt-0.5 shrink-0" /><span>Last error: {item.entry.lastError.class.replaceAll('_', ' ')}{item.entry.lastError.detail ? ` · ${item.entry.lastError.detail}` : ''}</span></div>
              )}
              {errors[item.entry.id] && <p role="alert" className="mt-3 text-xs text-red-600">{errors[item.entry.id]}</p>}
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3.5">
                {item.actions.map((action) => <RecoveryActionButton key={action} action={action} disabled={busyIds.includes(item.entry.id)} onClick={() => onAction(item.entry.id, action)} />)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.section>
  )
}

function RecoveryActionButton({ action, onClick, disabled }: { action: RecoveryAction; onClick: () => void; disabled: boolean }) {
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
  return <Button variant={action === 'discard' || action === 'delete-audio' ? 'destructive' : 'soft'} size="sm" onClick={onClick} disabled={disabled}><Icon size={13} />{labels[action]}</Button>
}

function Diagnostics({ trace }: { trace: DictationTrace | null | undefined }) {
  if (trace === undefined) {
    return <div className="mt-4 rounded-xl border border-line bg-surface/60 p-3.5 text-xs text-muted">Loading diagnostics…</div>
  }
  if (!trace) {
    return <div className="mt-4 rounded-xl border border-line bg-surface/60 p-3.5 text-xs text-muted">No diagnostics saved for this dictation.</div>
  }
  const raw = trace.rawAudio
  const trimmed = trace.trimmedAudio
  return (
    <div className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface/60 p-4 text-xs text-muted sm:grid-cols-2">
      <Diagnostic label="Outcome" value={trace.outcome} />
      <Diagnostic label="Target" value={trace.targetAppName ?? 'Unknown app'} />
      <Diagnostic label="STT" value={`${trace.sttProvider ?? 'default'}${trace.sttLatencyMs ? ` · ${trace.sttLatencyMs}ms` : ''}`} />
      <Diagnostic label="Reason" value={trace.rejectionReason ?? trace.userMessage ?? 'None'} />
      <Diagnostic label="Quality" value={trace.qualityDecision ? `${trace.qualityDecision.action} · ${trace.qualityDecision.reason}` : 'Not captured'} />
      <Diagnostic label="Raw audio" value={raw ? `${raw.durationSeconds.toFixed(2)}s · peak ${raw.peakAmplitude.toFixed(2)} · clip ${(raw.clippingRatio * 100).toFixed(2)}%` : 'Not captured'} />
      <Diagnostic label="Trimmed audio" value={trimmed ? `${trimmed.durationSeconds.toFixed(2)}s · silence ${(trimmed.silenceRatio * 100).toFixed(0)}%` : 'Not captured'} />
      {trace.rawAudioPath && <div className="truncate font-mono text-[11px] text-faint sm:col-span-2">Audio: {trace.rawAudioPath}</div>}
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
      <div className="truncate text-[12.5px] text-ink/85">{value}</div>
    </div>
  )
}
