import type { ReactNode } from 'react'
export type SegmentOption = { value: string; label: ReactNode }
// Renders a compact single-choice control.
export function Segmented({ value, options, onChange, className = '' }: { value: string; options: SegmentOption[]; onChange: (value: string) => void; className?: string }) {
  return <div className={`seg ${className}`} role="group">{options.map((option) => <button type="button" key={option.value} className={value === option.value ? 'on' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
}
