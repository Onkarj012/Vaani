// Renders selectable filters with optional result counts.
export default function FilterChips({ value, options, onChange, className = '' }: { value: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void; className?: string }) {
  return <div className={`fchips ${className}`} role="group">{options.map((option) => <button type="button" key={option.value} className={value === option.value ? 'on' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <small>{option.count}</small>}</button>)}</div>
}
