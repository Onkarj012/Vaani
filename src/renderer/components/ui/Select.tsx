import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@renderer/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

// Renders a custom select menu.
export function Select({
  value,
  onChange,
  options,
  dropUp = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  dropUp?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const current = options.find((option) => option.value === value);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-[13px] text-[13px] text-ink hover:border-ink/20 focus:border-accent focus:outline-none"
      >
        <span className="min-w-0 truncate text-left">
          {current?.label ?? value}
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close options"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            id={listboxId}
            role="listbox"
            className={cn(
              "absolute left-0 z-30 max-h-56 min-w-full w-max max-w-[360px] overflow-y-auto rounded-2xl border border-line bg-bg p-1.5 shadow-card",
              dropUp ? "bottom-full mb-2" : "top-full mt-2",
            )}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface",
                  value === option.value
                    ? "font-semibold text-accent"
                    : "text-ink",
                )}
              >
                {option.label}
                {value === option.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
