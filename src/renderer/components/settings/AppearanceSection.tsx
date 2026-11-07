import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { Segmented } from "@renderer/components/ui/Segmented";
import { Toggle } from "@renderer/components/ui/toggle";
import { Group, Row, type SectionComponentProps } from "./SettingsRows";

const accents = [
  { color: "#7575c8", label: "Indigo" },
  { color: "#ff006e", label: "Pink" },
  { color: "#2bb5a0", label: "Teal" },
  { color: "#e0a030", label: "Amber" },
];

// Renders theme, accent and Home display settings.
export default function AppearanceSection({
  context: c,
}: SectionComponentProps) {
  const accentChoices = accents.some(
    (accent) => accent.color === c.settings.accentColor,
  )
    ? accents
    : [...accents, { color: c.settings.accentColor, label: "Custom" }];

  return (
    <>
      <Row title="Theme">
        <Segmented
          value={c.mode}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(value) => c.setMode(value as "light" | "dark")}
        />
      </Row>
      <Row
        title="Accent colour"
        description="Tints the capsule's Send button and its waveform."
      >
        <div
          role="radiogroup"
          aria-label="Accent colour"
          className="flex flex-wrap gap-1.5"
          onKeyDown={(event) => {
            if (
              !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const radios = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[role=radio]",
              ),
            ];
            const current = radios.findIndex(
              (radio) => radio.getAttribute("aria-checked") === "true",
            );
            const offset =
              event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
            const next =
              radios[(current + offset + radios.length) % radios.length];
            next?.focus();
            next?.click();
          }}
        >
          {accentChoices.map((accent) => (
            <button
              key={accent.color}
              type="button"
              role="radio"
              aria-label={accent.label}
              aria-checked={c.settings.accentColor === accent.color}
              tabIndex={c.settings.accentColor === accent.color ? 0 : -1}
              onClick={() =>
                void c.updateSettings({ accentColor: accent.color })
              }
              className={`inline-flex h-[30px] items-center gap-[7px] rounded-full border-[1.5px] px-3 pl-2 text-[12.5px] font-semibold text-ink ${c.settings.accentColor === accent.color ? "border-[var(--swatch)] bg-[color-mix(in_srgb,var(--swatch)_11%,transparent)]" : "border-line"}`}
              style={{ "--swatch": accent.color } as CSSProperties}
            >
              <i
                aria-hidden="true"
                className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)]"
                style={{ backgroundColor: accent.color }}
              />
              {accent.label}
              {c.settings.accentColor === accent.color && (
                <Check size={12} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </Row>
      <Group title="Home">
        <Row
          title="How to dictate card"
          description="Shows on Home for your first 5 dictations, then hides. Turn on to bring it back."
        >
          <Toggle
            checked={c.tip.visible}
            onChange={(value) => c.tip.setVisible(value)}
          />
        </Row>
        <Row
          title="Setup checklist"
          description="Shows on Home until every step is done."
        >
          <Toggle
            checked={!c.settings.setupChecklistDismissed}
            onChange={(value) =>
              void c.updateSettings({ setupChecklistDismissed: !value })
            }
          />
        </Row>
      </Group>
    </>
  );
}
