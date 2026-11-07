import { Select } from "@renderer/components/ui/Select";
import { Toggle } from "@renderer/components/ui/toggle";
import {
  Group,
  OptionCards,
  Row,
  type SectionComponentProps,
} from "./SettingsRows";

// Renders recording, microphone and audio controls.
export default function DictationSection({
  context: c,
}: SectionComponentProps) {
  return (
    <>
      <Group title="Recording">
        <Row wide title="Mode">
          <OptionCards
            value={c.settings.dictationMode}
            options={[
              {
                value: "toggle",
                label: "Toggle",
                description: "Press once to start, again to stop.",
              },
              {
                value: "push-to-talk",
                label: "Push to talk",
                description: "Hold to record, release to send.",
              },
              {
                value: "toggle-double",
                label: "Smart toggle",
                description: "Hold to talk. Double-press to go hands-free.",
              },
            ]}
            onChange={(value) =>
              void c.updateSettings({ dictationMode: value })
            }
          />
        </Row>
        <Row
          title="Audio capture"
          description="Native capture is experimental. If it fails, Vaani switches to browser capture."
        >
          <Select
            value={c.settings.captureBackend}
            onChange={(value) =>
              void c.updateSettings({
                captureBackend: value as typeof c.settings.captureBackend,
              })
            }
            options={[
              { value: "renderer", label: "Browser capture (recommended)" },
              {
                value: "native",
                label: "Native voice processing (experimental)",
              },
            ]}
          />
        </Row>
        <Row
          title="Microphone"
          description="Virtual and aggregate devices are skipped for native capture."
        >
          <Select
            value={c.settings.micDeviceId ?? ""}
            onChange={(value) =>
              void c.updateSettings({ micDeviceId: value || undefined })
            }
            options={c.micOptions}
          />
        </Row>
        <Row
          title="Save recordings"
          description="Keeps WAV files on disk so you can replay them."
        >
          <Toggle
            checked={c.settings.saveRecordings}
            onChange={(value) =>
              void c.updateSettings({ saveRecordings: value })
            }
          />
        </Row>
        {c.settings.saveRecordings && (
          <Row
            title="Recordings folder"
            description="Where saved WAV files go."
          >
            <span className="max-w-[240px] truncate font-mono text-[11px] text-muted">
              {c.settings.recordingsPath || "Not set"}
            </span>
          </Row>
        )}
        <Row
          title="Suggest dictionary words"
          description="After you fix a pasted word, offer to add a rule."
        >
          <Toggle
            checked={c.settings.suggestDictionaryWords}
            onChange={(value) =>
              void c.updateSettings({ suggestDictionaryWords: value })
            }
          />
        </Row>
        <Row
          title="Low latency mode"
          description="Keeps the microphone open between dictations. Uses more battery."
        >
          <Toggle
            checked={c.settings.preWarmMic}
            onChange={(value) => void c.updateSettings({ preWarmMic: value })}
          />
        </Row>
      </Group>
      <Group title="Audio">
        <Row
          title="Minimum clip length"
          description="Clips shorter than this are ignored as accidental taps."
        >
          <div className="flex w-[190px] items-center gap-3">
            <input
              aria-label="Minimum clip length"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={c.settings.minClipDuration}
              onChange={(event) =>
                void c.updateSettings({
                  minClipDuration: Number(event.target.value),
                })
              }
              className="w-full accent-[#7575c8]"
            />
            <output className="w-12 text-right font-mono text-[11px]">
              {c.settings.minClipDuration.toFixed(1)} s
            </output>
          </div>
        </Row>
        <Row
          title="Silence threshold"
          description="Audio below this level counts as silence and gets trimmed."
        >
          <div className="flex w-[190px] items-center gap-3">
            <input
              aria-label="Silence threshold"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={c.settings.silenceThreshold}
              onChange={(event) =>
                void c.updateSettings({
                  silenceThreshold: Number(event.target.value),
                })
              }
              className="w-full accent-[#7575c8]"
            />
            <output className="w-12 text-right font-mono text-[11px]">
              {Math.round(c.settings.silenceThreshold * 100)}%
            </output>
          </div>
        </Row>
      </Group>
    </>
  );
}
