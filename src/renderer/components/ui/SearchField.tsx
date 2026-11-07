import { Search } from 'lucide-react'
import { forwardRef } from 'react'
import type { KeyboardEventHandler } from 'react'
// Renders a search input with an optional keyboard hint.
const SearchField = forwardRef<HTMLInputElement, { value?: string; onChange?: (value: string) => void; placeholder?: string; hint?: string; className?: string; onKeyDown?: KeyboardEventHandler<HTMLInputElement> }>(function SearchField({ value, onChange, placeholder = 'Search', hint, className = '', onKeyDown }, ref) {
  return <label className={`search ${className}`}><Search size={16} aria-hidden="true"/><input ref={ref} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} onKeyDown={onKeyDown}/>{hint && <kbd className="kc">{hint}</kbd>}</label>
})
export default SearchField
