import { AlertTriangle, X } from "lucide-react";
import type { Settings } from "@shared/types";
import { isLanguageSupportedByProvider } from "@shared/defaults";
import { Textarea } from "@renderer/components/ui/input";
import { Select } from "@renderer/components/ui/Select";
import { Segmented } from "@renderer/components/ui/Segmented";
import { Toggle } from "@renderer/components/ui/toggle";
import { Row, Group, type SectionComponentProps } from "./SettingsRows";
import AppProfiles from "./AppProfiles";

const styles = [
  { value: "plain", label: "Plain" },
  { value: "developer", label: "Developer" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
  { value: "email", label: "Email" },
];

// Renders global language and text cleanup settings.
export default function LanguageSection({ context: c }: SectionComponentProps) {
  return (
    <>
      <Row
        title="Default language"
        description="Used when an app has no profile."
      >
        <Select
          value={c.settings.language}
          onChange={(value) => void c.updateSettings({ language: value })}
          options={c.profileLanguageOptions.filter((item) => item.value !== "")}
        />
      </Row>
      {!isLanguageSupportedByProvider(
        c.settings.language,
        c.settings.transcriptionProvider,
        c.settings.localWhisperModel,
      ) && (
        <p className="flex gap-2 py-2 text-[12px] text-amber-600">
          <AlertTriangle size={14} />
          The selected transcription provider does not support this language.
          Vaani will fall back to auto-detect.
        </p>
      )}
      <AppProfiles context={c} />
      <Group title="Cleanup">
        <Row
          title="Smart punctuation"
          description="Adds periods, commas and capitals."
        >
          <Toggle
            checked={c.settings.smartPunctuation}
            onChange={(value) =>
              void c.updateSettings({ smartPunctuation: value })
            }
          />
        </Row>
        <Row
          title="Cleanup"
          description="Removes filler words and applies corrections."
        >
          <Toggle
            checked={c.settings.cleanupEnabled}
            onChange={(value) =>
              void c.updateSettings({ cleanupEnabled: value })
            }
          />
        </Row>
        <Row
          title="Context awareness"
          description="Sends the app name and style hint to the formatter."
        >
          <Toggle
            checked={c.settings.contextAwarenessEnabled}
            onChange={(value) =>
              void c.updateSettings({ contextAwarenessEnabled: value })
            }
          />
        </Row>
        <Row
          title="Style preset"
          description="Default tone when an app has no profile."
        >
          <Segmented
            value={c.settings.stylePreset}
            options={styles}
            onChange={(value) =>
              void c.updateSettings({
                stylePreset: value as Settings["stylePreset"],
              })
            }
          />
        </Row>
        <Row
          wide
          title="Filler words"
          description="Cleanup drops these when they are not part of a sentence."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {c.settings.fillerWords.map((word) => (
              <span
                key={`d-${word}`}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-surface pl-3 pr-1 font-mono text-[11px]"
              >
                {word}
                <button
                  type="button"
                  aria-label={`Remove ${word}`}
                  onClick={() =>
                    void c.updateSettings({
                      fillerWords: c.settings.fillerWords.filter(
                        (item) => item !== word,
                      ),
                      fillerWordsCustomized: true,
                    })
                  }
                  className="grid size-5 place-items-center rounded-full text-muted hover:bg-card"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {c.settings.extraFillerWords.map((word) => (
              <span
                key={`e-${word}`}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-surface pl-3 pr-1 font-mono text-[11px]"
              >
                {word}
                <button
                  type="button"
                  aria-label={`Remove ${word}`}
                  onClick={() =>
                    void c.updateSettings({
                      extraFillerWords: c.settings.extraFillerWords.filter(
                        (item) => item !== word,
                      ),
                    })
                  }
                  className="grid size-5 place-items-center rounded-full text-muted hover:bg-card"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              value={c.fillerDraft}
              onChange={(event) => c.setFillerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const word = c.fillerDraft.trim().toLowerCase();
                if (
                  word &&
                  !c.settings.extraFillerWords.includes(word) &&
                  !c.settings.fillerWords.includes(word)
                )
                  void c.updateSettings({
                    extraFillerWords: [...c.settings.extraFillerWords, word],
                  });
                c.setFillerDraft("");
              }}
              placeholder="Add a word"
              aria-label="Add a filler word"
              className="h-7 w-28 rounded-full border border-dashed border-faint bg-transparent px-3 text-[11px] outline-none focus:border-accent"
            />
          </div>
        </Row>
        <Row
          wide
          title="Custom instructions"
          description="Extra rules for the cleanup model, in plain words."
        >
          <Textarea
            value={c.promptDraft}
            onChange={(event) => c.setPromptDraft(event.target.value)}
            onBlur={() => {
              if (c.promptDraft !== (c.settings.customPrompt ?? ""))
                void c.updateSettings({ customPrompt: c.promptDraft });
            }}
            placeholder="e.g. Use British spelling. Never add emoji."
            className="min-h-20 resize-y"
          />
        </Row>
      </Group>
    </>
  );
}
