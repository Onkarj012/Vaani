import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function Select({ value, onChange, options, placeholder, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const currentLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? value;

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
  }, []);

  const select = useCallback(
    (v: string) => {
      onChange(v);
      close();
    },
    [onChange, close]
  );

  // Click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      const idx = options.findIndex((o) => o.value === value);
      setFocusedIndex(idx >= 0 ? idx : 0);
    } else if (e.key === "Escape") {
      close();
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < options.length) {
        select(options[focusedIndex]!.value);
      }
    } else if (e.key === "Escape") {
      close();
    }
  };

  // Focus list item when index changes
  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const items = listRef.current?.querySelectorAll("li");
    if (items && items[focusedIndex]) {
      (items[focusedIndex] as HTMLElement).focus();
    }
  }, [open, focusedIndex]);

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={{ display: "inline-block" }}
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          if (!open) {
            setOpen(true);
            const idx = options.findIndex((o) => o.value === value);
            setFocusedIndex(idx >= 0 ? idx : 0);
          } else {
            close();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          minWidth: 160,
          height: 36,
          paddingLeft: 12,
          paddingRight: 10,
          gap: 8,
          border: `1px solid ${open ? "var(--accent)" : "var(--border-light)"}`,
          background: "var(--bg)",
          color: "var(--text)",
          borderRadius: 0,
          outline: "none",
          cursor: "pointer",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          fontSize: 13,
          transition: "border-color 0.1s",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentLabel}
        </span>
        {/* Chevron triangle */}
        <span
          style={{
            display: "inline-block",
            width: 0,
            height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: open ? undefined : "5px solid var(--text-muted)",
            borderBottom: open ? "5px solid var(--accent)" : undefined,
            flexShrink: 0,
            transition: "border-color 0.1s",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 1px)",
            left: 0,
            minWidth: "100%",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            zIndex: 50,
            listStyle: "none",
            margin: 0,
            padding: 0,
            outline: "none",
          }}
        >
          {options.map((option, idx) => {
            const isActive = option.value === value;
            const isFocused = idx === focusedIndex;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isActive}
                tabIndex={isFocused ? 0 : -1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(option.value);
                }}
                onMouseEnter={() => setFocusedIndex(idx)}
                style={{
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 8,
                  paddingBottom: 8,
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                  outline: "none",
                  borderLeft: isActive || isFocused ? "3px solid var(--accent)" : "3px solid transparent",
                  background: isActive
                    ? "var(--accent)"
                    : isFocused
                    ? "var(--bg-2)"
                    : "transparent",
                  color: isActive ? "#fff" : "var(--text)",
                  transition: "background 0.08s",
                }}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
