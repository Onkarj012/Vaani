import { useState, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

export interface ApiKeyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  className?: string;
  wrapperClassName?: string;
}

export const ApiKeyInput = forwardRef<HTMLInputElement, ApiKeyInputProps>(
  ({ className, wrapperClassName, onFocus, onBlur, style, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const [focused, setFocused] = useState(false);

    return (
      <div className={cn("relative inline-flex items-center", wrapperClassName)}>
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "h-9 w-[220px] rounded-none px-3 pr-9 text-[13px]",
            "placeholder:text-[var(--text-muted)]",
            "bg-[var(--bg)] text-[var(--text)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          style={{
            border: `1px solid ${focused ? "var(--accent)" : "var(--border-light)"}`,
            outline: "none",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            transition: "border-color 0.1s",
            ...style,
          }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            height: "100%",
            width: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: 0,
            outline: "none",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          aria-label={visible ? "Hide API key" : "Show API key"}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    );
  }
);
ApiKeyInput.displayName = "ApiKeyInput";
