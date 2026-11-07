import { Search } from "lucide-react";
import { forwardRef } from "react";
import type { KeyboardEventHandler } from "react";
import { cn } from "@renderer/lib/utils";

// Renders a controlled search input with an optional keyboard hint.
const SearchField = forwardRef<
  HTMLInputElement,
  {
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    hint?: string;
    className?: string;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }
>(function SearchField(
  { value, onChange, placeholder = "Search", hint, className = "", onKeyDown },
  ref,
) {
  return (
    <label
      className={cn(
        "flex h-10 min-w-0 items-center gap-[9px] rounded-full bg-surface px-[15px] text-muted",
        className,
      )}
    >
      <Search size={16} aria-hidden="true" />
      <input
        ref={ref}
        className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
        value={value}
        onChange={
          onChange ? (event) => onChange(event.target.value) : undefined
        }
        placeholder={placeholder}
        onKeyDown={onKeyDown}
      />
      {hint && (
        <kbd className="pointer-events-none inline-grid h-6 min-w-6 place-items-center rounded-[7px] border border-line bg-card px-1.5 font-body text-[11px] font-semibold text-ink shadow-[0_2px_0_var(--color-line)]">
          {hint}
        </kbd>
      )}
    </label>
  );
});

export default SearchField;
