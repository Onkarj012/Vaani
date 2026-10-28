import { recoveryReadinessMessage } from "@shared/recoveryReadiness";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { Search, Copy, Trash2, X, Check, Edit3, RefreshCw, Play, ShieldAlert, Bug, CornerDownLeft, RotateCcw } from 'lucide-react'
import { useVaaniUi, type HistoryItemView } from '@renderer/context/vaani-ui'
import { Textarea } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Tag } from '@renderer/components/ui/tag'
import { cn } from '@renderer/lib/utils'
import type { DictationEntry, DictationTrace } from '@shared/types'
import { getLanguageLabel } from '@shared/defaults'
import { buildProof, summarizeProof, proofSummaryLine, type ProofSummary, type ProofToken } from '@renderer/lib/proofMarks'
import { createRecoveryActionRunner, dedupeRecoveryEntries, deriveRecoveryItem, filterRecoveryItems, matchesRecoverySearch, type RecoveryAction, type RecoveryFilter, type RecoveryItemView } from '@renderer/lib/recoveryDerivations'

type TraceLoadState = DictationTrace | null | 'loading'
type HistoryFilter = 'all' | 'inserted' | 'saved' | 'recovery'
type DetailTab = 'proof' | 'cleaned' | 'raw'
type ProofOptions = Parameters<typeof buildProof>[2]

interface DictationRow { kind: 'dictation'; key: string; group: string; at: number; item: HistoryItemView; entry: DictationEntry }
interface RecoveryRow { kind: 'recovery'; key: string; group: string; at: number; time: string; item: RecoveryItemView }
type ListRow = DictationRow | RecoveryRow

const stagger = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const rise = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

const FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'inserted', label: 'Inserted' },
  { value: 'saved', label: 'Saved' },
  { value: 'recovery', label: 'Recovery' },
]
const RECOVERY_FILTERS: Array<{ value: RecoveryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs-transcription', label: 'Transcription' },
  { value: 'needs-formatting', label: 'Formatting' },
  { value: 'ready-to-insert', label: 'Ready to insert' },
  { value: 'text-only', label: 'Text only' },
]
const DETAIL_TABS: Array<{ value: DetailTab; label: string; caption: string }> = [
  { value: 'proof', label: 'Proof', caption: 'What Vaani changed' },
  { value: 'cleaned', label: 'Cleaned', caption: 'What was typed' },
  { value: 'raw', label: 'Raw', caption: 'As Whisper heard it' },
]
const RECOVERY_ACTIONS: RecoveryAction[] = ['retry-transcription', 'retry-formatting', 'use-raw-transcript', 'retry-insertion', 'copy', 'play-audio', 'delete-audio', 'discard']
const APP_TONES = ['bg-chip-lav', 'bg-chip-sky', 'bg-chip-mint', 'bg-chip-blush', 'bg-chip-peach', 'bg-chip-butter']

export default function History() {
  const { historyItems, historyEntries, settings, updateHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry, retryHistoryEntry, copyHistoryEntry, recoveryReadiness, recoveryEntries, reloadHistory, retryRecoveryTranscription, retryRecoveryFormatting, useRawRecoveryTranscript, retryRecoveryInsertion, copyRecoveryEntry, playRecoveryAudio, deleteRecoveryAudio, discardRecoveryEntry } = useVaaniUi()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const urlFilter = searchParams.get('filter')
  const [filter, setFilter] = useState<HistoryFilter>(urlFilter === 'recovery' ? 'recovery' : 'all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('proof')
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

  // Keeps the search in ?q so this field and the toolbar search always show the same query.
  const setSearchQuery = (value: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (value) next.set('q', value)
    else next.delete('q')
    return next
  }, { replace: true })

  // Follow ?filter=recovery links when the URL changes.
  useEffect(() => { setFilter(urlFilter === 'recovery' ? 'recovery' : 'all') }, [urlFilter])

  const entryById = useMemo(() => new Map(historyEntries.map((entry) => [entry.id, entry] as const)), [historyEntries])
  const recoveryItems = useMemo(
    () => dedupeRecoveryEntries(recoveryEntries).map((entry) => deriveRecoveryItem(entry)),
    [recoveryEntries],
  )
  const proofOptions = useMemo<ProofOptions>(
    () => ({ fillers: [...settings.fillerWords, ...settings.extraFillerWords], corrections: settings.customCorrections }),
    [settings.fillerWords, settings.extraFillerWords, settings.customCorrections],
  )
  const proofLines = useMemo(
    () => new Map(historyEntries.map((entry) => [entry.id, proofLine(entry, proofOptions)] as const)),
    [historyEntries, proofOptions],
  )
  const rows = useMemo(
    () => buildRows(historyItems, entryById, recoveryItems, filter, recoveryFilter, searchQuery),
    [historyItems, entryById, recoveryItems, filter, recoveryFilter, searchQuery],
  )
  const selected = rows.find((row) => row.key === selectedKey) ?? rows[0] ?? null
  const selectedDictation = selected?.kind === 'dictation' ? selected : null
  const selectedRecovery = selected?.kind === 'recovery' ? selected : null
  const selectedEntry = selectedDictation?.entry ?? null
  const selectedProof = useMemo(
    () => selectedEntry ? buildProof(selectedEntry.rawText, selectedEntry.cleanedText, proofOptions) : [],
    [selectedEntry, proofOptions],
  )
  const selectedSummary = summarizeProof(selectedProof)
  const selectedTraceId = selectedDictation?.item.traceId ?? null

  useEffect(() => {
    if (!selectedTraceId || traces[selectedTraceId] !== undefined) return
    const traceId = selectedTraceId
    setTraces((current) => ({ ...current, [traceId]: 'loading' }))
    void window.vaani.getDictationTrace(traceId)
      .then((trace) => {
        setTraces((current) => ({ ...current, [traceId]: trace ?? null }))
      })
      .catch(() => {
        setTraces((current) => ({ ...current, [traceId]: null }))
      })
  }, [selectedTraceId, traces])

  const insertedCount = historyItems.filter((it) => it.injectionStatus === 'injected').length
  const counts: Record<HistoryFilter, number> = {
    all: historyItems.length + recoveryItems.length,
    inserted: insertedCount,
    saved: historyItems.length - insertedCount,
    recovery: recoveryItems.length,
  }

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

  const copyBugReport = async (entryId: string) => {
    const report = await window.vaani.exportBugReport(entryId)
    await window.vaani.copyText(JSON.stringify(report, null, 2))
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="flex min-h-0 flex-1 flex-col">
      <motion.div variants={rise} className="mb-4 flex shrink-0 items-end justify-between gap-4">
        <div>
          <p className="label-meta text-[10px] text-faint">{countLine(counts.all, counts.recovery)}</p>
          <h1 className="text-display mt-1.5 text-[56px] text-ink">History</h1>
        </div>
        {selectedDictation && (
          <Button variant="secondary" size="sm" onClick={() => copyBugReport(selectedDictation.entry.id)}>
            <Bug size={15} />Export bug report
          </Button>
        )}
      </motion.div>

      <motion.div variants={rise} className="mb-4 flex shrink-0 flex-wrap items-center gap-2.5">
        <label className="flex h-10 w-[300px] max-w-full items-center gap-2 rounded-full bg-surface px-4 text-faint">
          <Search size={15} className="shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search what you said…"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-faint hover:text-ink">
              <X size={15} />
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => {
            const active = filter === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                  active ? 'border-transparent bg-ink text-bg' : option.value === 'recovery' ? 'border-transparent bg-chip-peach text-[#8a3b22] hover:opacity-90' : 'border-line text-muted hover:text-ink',
                )}
              >
                {option.label}
                <span className="font-mono text-[10px] opacity-70">{counts[option.value]}</span>
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* Only worth the space when recovery can't do its job; "ready" is the normal state. */}
      {recoveryReadiness.state !== 'ready' && (
        <p role="status" className="mb-4 shrink-0 rounded-[14px] bg-surface px-4 py-2.5 text-[13px] text-muted">{recoveryReadinessMessage(recoveryReadiness)}</p>
      )}

      <motion.div variants={rise} className="grid min-h-0 flex-1 grid-cols-[360px_1fr] grid-rows-[minmax(0,1fr)] gap-4">
        <div className="min-h-0 overflow-y-auto pr-1">
          {filter === 'recovery' && (
            <div className="mb-3 flex flex-wrap gap-1.5 px-1">
              {RECOVERY_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRecoveryFilter(option.value)}
                  className={cn('h-7 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors', recoveryFilter === option.value ? 'bg-ink text-bg' : 'bg-surface text-muted hover:text-ink')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="py-20 text-center">
              <Search size={44} className="mx-auto mb-4 text-line" />
              <h3 className="text-display text-xl text-ink">No results found</h3>
              <p className="mt-2 text-sm text-muted">{filter === 'recovery' && !searchQuery ? 'No recovery items match this filter.' : 'Try adjusting your search query.'}</p>
            </div>
          ) : rows.map((row, index) => {
            const isSelected = row.key === selected?.key
            const onSelect = () => setSelectedKey(row.key)
            return (
              <Fragment key={row.key}>
                {rows[index - 1]?.group !== row.group && <div className="label-meta px-3 pb-1.5 pt-4 text-[10px] text-faint">{row.group}</div>}
                {row.kind === 'dictation'
                  ? <DictationRowButton row={row} selected={isSelected} proof={proofLines.get(row.entry.id)} onSelect={onSelect} />
                  : <RecoveryRowButton row={row} selected={isSelected} onSelect={onSelect} />}
              </Fragment>
            )
          })}
        </div>

        <section className="min-h-0 overflow-y-auto rounded-card border border-line bg-card px-7 py-6">
          {selectedDictation && (
            <>
              <div className="flex items-center gap-3.5">
                <AppBadge app={selectedDictation.item.app} large />
                <div className="min-w-0">
                  <h2 className="text-display text-[26px] text-ink">{selectedDictation.item.app}</h2>
                  <p className="label-meta mt-1 text-[10px] text-faint">{dictationMeta(selectedDictation.item)}</p>
                </div>
                <Tag tone={selectedDictation.item.injectionStatus === 'injected' ? 'mint' : 'butter'} className="ml-auto shrink-0">
                  {selectedDictation.item.injectionStatus === 'injected' ? 'Inserted' : 'Saved'}
                </Tag>
              </div>

              <div className="mt-[18px] flex items-center justify-between gap-3">
                <div role="tablist" className="inline-flex gap-0.5 rounded-full bg-surface p-[3px]">
                  {DETAIL_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={detailTab === tab.value}
                      onClick={() => setDetailTab(tab.value)}
                      className={cn('h-[30px] rounded-full px-3.5 text-[12.5px] font-semibold text-muted transition-colors', detailTab === tab.value && 'bg-card text-ink shadow-sm dark:bg-[#34343b]')}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <span className="label-meta text-[10px] text-faint">{DETAIL_TABS.find((tab) => tab.value === detailTab)?.caption}</span>
              </div>

              {editingId === selectedDictation.item.id ? (
                <div className="mt-3.5">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={6}
                    className="resize-none rounded-[16px] border-2 border-accent p-3.5 text-base leading-[1.55]"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                    <Button variant="accent" size="sm" onClick={handleSave}><Check size={14} />Save</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3.5 rounded-[20px] border border-line bg-bg p-5">
                  {detailTab === 'proof' && <ProofText tokens={selectedProof} />}
                  {detailTab === 'cleaned' && <p className="whitespace-pre-line text-[19px] leading-[1.7]">{selectedDictation.entry.cleanedText}</p>}
                  {detailTab === 'raw' && <p className="whitespace-pre-line font-mono text-[14.5px] leading-[1.7] text-muted">{selectedDictation.entry.rawText}</p>}
                  {detailTab === 'proof' && <ProofLegend summary={selectedSummary} />}
                </div>
              )}

              <div className="mt-5 flex items-center gap-2 border-b border-line pb-5">
                <Button size="sm" onClick={() => reinjectHistoryEntry(selectedDictation.item.id)}><CornerDownLeft size={14} />Re-insert</Button>
                <Button variant="secondary" size="sm" onClick={() => copyHistoryEntry(selectedDictation.item.text)}><Copy size={14} />Copy</Button>
                <Button variant="secondary" size="sm" onClick={() => { setEditingId(selectedDictation.item.id); setEditText(selectedDictation.item.text) }}><Edit3 size={14} />Edit</Button>
                <Button variant="secondary" size="sm" onClick={() => retryHistoryEntry(selectedDictation.item.id)}><RefreshCw size={14} />Retry</Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete dictation"
                  aria-label="Delete dictation"
                  className="ml-auto h-8 w-8 text-faint hover:bg-red-50 hover:text-red-500"
                  onClick={() => deleteHistoryEntry(selectedDictation.item.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>

              {selectedDictation.item.traceId && (
                <>
                  <SectionLabel>Diagnostics</SectionLabel>
                  <Diagnostics trace={resolvedTrace(traces[selectedDictation.item.traceId])} />
                </>
              )}
            </>
          )}

          {selectedRecovery && (
            <RecoveryDetail
              row={selectedRecovery}
              busy={busyRecoveryIds.includes(selectedRecovery.item.entry.id)}
              errorMessage={recoveryActionErrors[selectedRecovery.item.entry.id]}
              onAction={(action) => { void runRecoveryAction(selectedRecovery.item.entry.id, action) }}
            />
          )}

          {!selected && <p className="py-20 text-center text-sm text-muted">Pick a dictation to see what Vaani changed.</p>}
        </section>
      </motion.div>
    </motion.div>
  )
}

// Builds the list rows for the active filter and search, newest first.
function buildRows(
  historyItems: HistoryItemView[],
  entries: ReadonlyMap<string, DictationEntry>,
  recoveryItems: RecoveryItemView[],
  filter: HistoryFilter,
  recoveryFilter: RecoveryFilter,
  query: string,
): ListRow[] {
  const dictations = historyItems.flatMap((item): DictationRow[] => {
    const entry = entries.get(item.id)
    if (!entry || !matchesDictationFilter(filter, item)) return []
    if (!item.text.toLowerCase().includes(query.toLowerCase())) return []
    return [{ kind: 'dictation', key: `dictation:${item.id}`, group: item.group, at: Date.parse(entry.timestamp), item, entry }]
  })
  const pool = filter === 'all' ? recoveryItems : filter === 'recovery' ? filterRecoveryItems(recoveryItems, recoveryFilter) : []
  const recovery = pool
    .filter((recoveryItem) => matchesRecoverySearch(recoveryItem, query))
    .map((recoveryItem): RecoveryRow => ({
      kind: 'recovery',
      key: `recovery:${recoveryItem.entry.id}`,
      group: dayGroup(recoveryItem.entry.createdAt),
      at: Date.parse(recoveryItem.entry.createdAt),
      time: clockTime(recoveryItem.entry.createdAt),
      item: recoveryItem,
    }))
  return [...dictations, ...recovery].sort((a, b) => b.at - a.at)
}

// Whether a dictation belongs under the chosen filter; recovery items are handled separately.
function matchesDictationFilter(filter: HistoryFilter, item: HistoryItemView): boolean {
  if (filter === 'inserted') return item.injectionStatus === 'injected'
  if (filter === 'saved') return item.injectionStatus !== 'injected'
  return filter === 'all'
}

// One-line summary of what cleanup changed; empty when only punctuation changed.
function proofLine(entry: DictationEntry, options: ProofOptions): string {
  return proofSummaryLine(summarizeProof(buildProof(entry.rawText, entry.cleanedText, options)))
}

// Day bucket for a timestamp, using the same labels as the history groups.
function dayGroup(timestamp: string, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const date = new Date(timestamp)
  if (date >= today) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date >= yesterday) return 'Yesterday'
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - 6)
  return date >= weekStart ? 'This Week' : 'Earlier'
}

// Clock time such as "7:31 PM".
function clockTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// Header line such as "1 dictation · 3 need you"; the second part is dropped when nothing needs you.
function countLine(total: number, needsYou: number): string {
  const dictations = `${total} ${total === 1 ? 'dictation' : 'dictations'}`
  return needsYou > 0 ? `${dictations} · ${needsYou} need you` : dictations
}

// Meta line under the detail title: day, time, duration, words, and language when known.
function dictationMeta(item: HistoryItemView): string {
  const language = item.detectedLanguage || item.language
  return [item.group, item.time, item.duration, `${item.wordCount} words`, language ? getLanguageLabel(language) : null]
    .filter(Boolean)
    .join(' · ')
}

// Failure line for a recovery item, or null when no error was saved.
function failureText(item: RecoveryItemView): string | null {
  const { lastError } = item.entry
  if (lastError.class === 'none') return null
  const failure = lastError.class.replaceAll('_', ' ')
  return lastError.detail ? `${failure} · ${lastError.detail}` : failure
}

// Picks a pastel for an app badge from its name, so each app keeps the same colour.
function appTone(app: string): string {
  let hash = 0
  for (const char of app) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return APP_TONES[hash % APP_TONES.length] ?? 'bg-chip-lav'
}

// Renders the proof tokens as marked-up words, spaced like the typed text.
function ProofText({ tokens }: { tokens: ProofToken[] }) {
  return (
    <p className="whitespace-pre-wrap text-[19px] leading-[1.7]">
      {tokens.map((token, index) => (
        <Fragment key={index}>
          {index > 0 && token.kind !== 'break' && tokens[index - 1]?.kind !== 'break' && ' '}
          <ProofTokenView token={token} />
        </Fragment>
      ))}
    </p>
  )
}

// Renders one proof token with the mark style for its kind.
function ProofTokenView({ token }: { token: ProofToken }) {
  switch (token.kind) {
    case 'same': return token.text
    case 'break': return token.text
    case 'filler': return <del className="pm-f" title="Filler removed">{token.text}</del>
    case 'scratched': return <del className="pm-x" title="Removed by “scratch that”">{token.text}</del>
    case 'command': return <span className="pm-c">{token.text}</span>
    case 'removed': return <del className="pm-f">{token.text}</del>
    case 'fix': return token.dictionary
      ? <span className="pm-d" title="Dictionary rule"><s>{token.from}</s>{token.to}</span>
      : <span className="pm-a" title="Cleanup rewrite"><s>{token.from}</s>{token.to}</span>
    case 'added': return <span className="pm-a">{token.text}</span>
  }
}

// Colour key under the proof box with counts for each kind of change.
function ProofLegend({ summary }: { summary: ProofSummary }) {
  if (!summary.changed) {
    return <div className="mt-3.5 border-t border-dashed border-line pt-3 text-[11.5px] text-muted">Vaani only added punctuation and capitals.</div>
  }
  return (
    <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-dashed border-line pt-3 text-[11.5px] text-muted">
      {summary.fillers > 0 && (
        <LegendItem swatch="h-0.5 bg-[var(--color-mark-filler)]">{summary.fillers} {summary.fillers === 1 ? 'filler' : 'fillers'} removed</LegendItem>
      )}
      {summary.scratched > 0 && <LegendItem swatch="h-2 bg-chip-blush">Scratched with “scratch that”</LegendItem>}
      {summary.dictionaryFixes > 0 && (
        <LegendItem swatch="h-2 bg-chip-sky">{summary.dictionaryFixes} dictionary {summary.dictionaryFixes === 1 ? 'fix' : 'fixes'}</LegendItem>
      )}
      {summary.rewrites > 0 && (
        <LegendItem swatch="h-2 bg-chip-butter">{summary.rewrites} {summary.rewrites === 1 ? 'rewrite' : 'rewrites'}</LegendItem>
      )}
    </div>
  )
}

function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn('block w-3.5 rounded-[3px]', swatch)} />
      {children}
    </span>
  )
}

function DictationRowButton({ row, selected, proof, onSelect }: { row: DictationRow; selected: boolean; proof: string | undefined; onSelect: () => void }) {
  const { item } = row
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn('grid w-full grid-cols-[30px_1fr] gap-3 rounded-[18px] p-3 text-left transition-colors', selected ? 'bg-chip-lav pastel-scope' : 'hover:bg-surface')}
    >
      <AppBadge app={item.app} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('label-meta truncate text-[10px]', selected ? 'pastel-scope/50' : 'text-faint')}>{item.app} · {item.time}</span>
          {item.injectionStatus !== 'injected' && <Tag tone="butter" className="px-2 py-0.5 text-[10px]">Saved</Tag>}
        </div>
        <p className={cn('mt-1 line-clamp-2 text-[13px] leading-[1.45]', !selected && 'text-ink/85')}>{item.text}</p>
        {proof && <div className={cn('label-meta mt-1.5 text-[9.5px]', selected ? 'text-accent-strong' : 'text-accent')}>✎ {proof}</div>}
      </div>
    </button>
  )
}

function RecoveryRowButton({ row, selected, onSelect }: { row: RecoveryRow; selected: boolean; onSelect: () => void }) {
  const app = appNameOf(row.item)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn('grid w-full grid-cols-[30px_1fr] gap-3 rounded-[18px] p-3 text-left transition-colors', selected ? 'bg-chip-lav pastel-scope' : 'hover:bg-surface')}
    >
      <AppBadge app={app} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('label-meta truncate text-[10px]', selected ? 'pastel-scope/50' : 'text-faint')}>{app} · {row.time}</span>
          <Tag tone="peach" className="px-2 py-0.5 text-[10px]">Needs retry</Tag>
        </div>
        <p className={cn('mt-1 line-clamp-2 text-[13px] leading-[1.45] text-[#a2462c]', !selected && 'dark:text-[#ff9b85]')}>
          {failureText(row.item) ?? row.item.status}
        </p>
      </div>
    </button>
  )
}

function RecoveryDetail({ row, busy, errorMessage, onAction }: { row: RecoveryRow; busy: boolean; errorMessage: string | undefined; onAction: (action: RecoveryAction) => void }) {
  const view = row.item
  const { entry } = view
  const app = appNameOf(view)
  const hasText = Boolean(entry.text.formattedText || entry.text.cleanedText || entry.text.rawTranscript)
  return (
    <>
      <div className="flex items-center gap-3.5">
        <AppBadge app={app} large />
        <div className="min-w-0">
          <h2 className="text-display text-[26px] text-ink">{app}</h2>
          <p className="label-meta mt-1 text-[10px] text-faint">{row.group} · {row.time}</p>
        </div>
        <Tag tone="peach" className="ml-auto shrink-0">Needs retry</Tag>
      </div>

      <div className="mt-[18px] flex items-start gap-3.5 rounded-[20px] bg-chip-peach p-[18px_20px] pastel-scope">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-white/60 text-[#b2452a]">
          <ShieldAlert size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="text-display text-[20px]">{view.status}</h3>
          <p className="mt-1 text-[13px] leading-normal pastel-scope/75">{failureText(view) ?? 'No error was saved for this item.'}</p>
          <p className="label-meta mt-2 text-[10px] pastel-scope/50">{view.age} · {view.expires}</p>
        </div>
      </div>

      {hasText && (
        <>
          <SectionLabel>Saved text</SectionLabel>
          <div className="mt-2.5 rounded-[20px] border border-line bg-bg p-5 text-[16px] leading-[1.6]">{view.preview}</div>
        </>
      )}

      <div className="mt-[18px] grid grid-cols-3 gap-2">
        <DiagnosticCell label="Audio" value={entry.audioAvailable ? `Available${entry.audioDurationSeconds ? ` · ${Math.round(entry.audioDurationSeconds)}s` : ''}` : 'Unavailable'} />
        <DiagnosticCell label="Target" value={entry.appName ?? 'Not noted'} />
        <DiagnosticCell label="State" value={entry.state.replaceAll('_', ' ')} />
      </div>

      {errorMessage && <p role="alert" className="mt-3 text-[13px] text-[#a2462c] dark:text-[#ff9b85]">{errorMessage}</p>}

      <SectionLabel>Recovery actions</SectionLabel>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {RECOVERY_ACTIONS.map((action) => (
          <RecoveryActionButton
            key={action}
            action={action}
            primary={action === view.actions[0]}
            available={view.actions.includes(action)}
            busy={busy}
            onClick={() => onAction(action)}
          />
        ))}
      </div>
    </>
  )
}

function RecoveryActionButton({ action, primary, available, busy, onClick }: { action: RecoveryAction; primary: boolean; available: boolean; busy: boolean; onClick: () => void }) {
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
  const destructive = action === 'discard' || action === 'delete-audio'
  return (
    <Button
      variant={primary ? 'primary' : destructive ? 'destructive' : 'secondary'}
      className="h-auto min-h-10 justify-center whitespace-normal px-2 py-2 text-center text-[12.5px] leading-tight"
      onClick={onClick}
      disabled={busy || !available}
      title={available ? undefined : 'Not available for this failure'}
    >
      <Icon size={14} />{labels[action]}
    </Button>
  )
}

function Diagnostics({ trace }: { trace: DictationTrace | null | undefined }) {
  if (trace === undefined) return <Notice>Loading diagnostics…</Notice>
  if (!trace) return <Notice>No diagnostics saved for this dictation.</Notice>
  const raw = trace.rawAudio
  const trimmed = trace.trimmedAudio
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <DiagnosticCell label="Outcome" value={trace.outcome} />
      <DiagnosticCell label="Target" value={trace.targetAppName ?? 'Unknown app'} />
      <DiagnosticCell label="STT" value={`${trace.sttProvider ?? 'default'}${trace.sttLatencyMs ? ` · ${trace.sttLatencyMs}ms` : ''}`} />
      <DiagnosticCell label="Reason" value={trace.rejectionReason ?? trace.userMessage ?? 'None'} />
      <DiagnosticCell label="Quality" value={trace.qualityDecision ? `${trace.qualityDecision.action} · ${trace.qualityDecision.reason}` : 'Not captured'} />
      <DiagnosticCell label="Raw audio" value={raw ? `${raw.durationSeconds.toFixed(2)}s · peak ${raw.peakAmplitude.toFixed(2)} · clip ${(raw.clippingRatio * 100).toFixed(2)}%` : 'Not captured'} />
      <DiagnosticCell label="Trimmed audio" value={trimmed ? `${trimmed.durationSeconds.toFixed(2)}s · silence ${(trimmed.silenceRatio * 100).toFixed(0)}%` : 'Not captured'} />
      {trace.rawAudioPath && <DiagnosticCell label="Audio file" value={trace.rawAudioPath} className="col-span-3" />}
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-[14px] bg-surface px-[13px] py-[11px] text-[13px] text-muted">{children}</div>
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="label-meta mt-[22px] text-[10px] text-faint">{children}</div>
}

function DiagnosticCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-[14px] bg-surface px-[13px] py-[11px]', className)}>
      <div className="label-meta text-[10px] text-faint">{label}</div>
      <div className="mt-[5px] truncate text-[13px] font-semibold text-ink" title={value}>{value}</div>
    </div>
  )
}

// Coloured app tile with the app's first letter.
function AppBadge({ app, large = false }: { app: string; large?: boolean }) {
  return (
    <span className={cn(
      'text-display grid shrink-0 place-items-center pastel-scope',
      large ? 'h-11 w-11 rounded-[14px] text-[20px]' : 'h-[30px] w-[30px] rounded-[9px] text-[13px]',
      appTone(app),
    )}>
      {app.charAt(0).toUpperCase()}
    </span>
  )
}

function appNameOf(view: RecoveryItemView): string {
  return view.entry.appName?.trim() || 'Unknown'
}

function resolvedTrace(trace: TraceLoadState | undefined): DictationTrace | null | undefined {
  return trace === 'loading' ? undefined : trace
}
