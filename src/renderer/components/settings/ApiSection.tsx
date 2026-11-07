import { useMemo } from "react";
import { ArrowRight, Cpu, Trash2 } from "lucide-react";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import { Button, IconButton } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { ModelPicker } from "@renderer/components/ModelPicker";
import { Select } from "@renderer/components/ui/Select";
import { Tag } from "@renderer/components/ui/tag";
import { Toggle } from "@renderer/components/ui/toggle";
import { Group, Row, type SectionComponentProps } from "./SettingsRows";

// Formats the time since a provider key was tested.
function relativeTime(testedAt: string): string {
  const testedTime = new Date(testedAt).getTime();
  if (!Number.isFinite(testedTime)) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - testedTime) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Renders model choices, provider keys, failover and local models.
export default function ApiSection({ context: c }: SectionComponentProps) {
  const keyRows = useMemo(() => {
    return c.keyProviders.map((provider) => ({
      provider,
      saved: c.settings.providerApiKeys?.find((key) => key.providerId === provider.id && key.hasKey),
      providerId: provider.id,
      role: provider.type === "llm" ? "Cleanup" : "Transcription",
    }));
  }, [c.keyProviders, c.settings.providerApiKeys]);

  return (
    <>
      <div
        data-setting-row
        className="grid grid-cols-[minmax(0,1fr)_26px_minmax(0,1fr)_26px_.82fr] items-stretch gap-1 py-5 @max-[600px]/pane:grid-cols-1"
      >
        <div className="flex flex-col gap-2 rounded-[20px] border border-line bg-card p-3 shadow-sm">
          <span className="label-meta text-[9px] text-faint">01 · Hear</span>
          <b className="text-display text-[20px]">Transcription</b>
          <ModelPicker
            role="transcription"
            provider={c.settings.transcriptionProvider}
            modelId={c.settings.transcriptionModel}
            onChange={(provider, modelId) =>
              void c.updateSettings({
                transcriptionProvider: provider,
                transcriptionModel: modelId,
              })
            }
          />
          <small className="label-meta text-[9px] text-faint">
            {KNOWN_PROVIDERS.find(
              (provider) => provider.id === c.settings.transcriptionProvider,
            )?.locality === "local"
              ? "on this Mac"
              : "cloud"}
          </small>
        </div>
        <ArrowRight
          aria-hidden="true"
          size={14}
          className="self-center justify-self-center text-faint @max-[600px]/pane:rotate-90"
        />
        <div className="flex flex-col gap-2 rounded-[20px] border border-line bg-card p-3 shadow-sm">
          <span className="label-meta text-[9px] text-faint">02 · Clean</span>
          <b className="text-display text-[20px]">Cleanup</b>
          <ModelPicker
            role="cleanup"
            provider={c.settings.formattingProvider}
            modelId={c.settings.formattingModel}
            onChange={(provider, modelId) =>
              void c.updateSettings({
                formattingProvider: provider,
                formattingModel: modelId,
              })
            }
          />
          <small className="label-meta text-[9px] text-faint">
            {KNOWN_PROVIDERS.find(
              (provider) => provider.id === c.settings.formattingProvider,
            )?.locality === "local"
              ? "on this Mac"
              : "cloud"}
          </small>
        </div>
        <ArrowRight
          aria-hidden="true"
          size={14}
          className="self-center justify-self-center text-faint @max-[600px]/pane:rotate-90"
        />
        <button
          type="button"
          onClick={c.openDictionary}
          className="flex flex-col gap-2 rounded-[20px] border border-white/10 bg-[#0d0d0f] p-3 text-left text-[#f3f3f5]"
        >
          <span className="label-meta text-[9px] text-white/55">03 · Fix</span>
          <b className="text-display text-[20px]">Dictionary &amp; snippets</b>
          <span className="mt-auto text-[12px] text-white/75">
            {c.dictionaryCount} rules · {c.snippetCount} snippets
          </span>
          <small className="label-meta text-[9px] text-white/45">
            on this Mac
          </small>
        </button>
      </div>
      <Group title="Provider keys">
        {keyRows.map(({ provider, saved, providerId, role }) => {
          const hasKey = saved?.hasKey === true;
          const validation = saved?.lastValidation;
          const failed = Boolean(hasKey && validation && !validation.valid);
          const editing = hasKey && c.editingKey === providerId;
          const status = !hasKey
            ? "Not set"
            : failed
              ? "Key failed"
              : "Connected";
          const statusTone = !hasKey ? "surface" : failed ? "peach" : "mint";
          const note = failed
            ? validation?.message
            : validation?.testedAt
              ? `Tested ${relativeTime(validation.testedAt)}`
              : hasKey
                ? "Key saved"
                : "Add a key to use this provider.";
          return (
            <div
              key={providerId}
              data-setting-row
              className="my-2 flex flex-wrap items-center gap-3 rounded-[18px] bg-surface p-3"
            >
              <span
                aria-hidden="true"
                className={`grid size-[34px] shrink-0 place-items-center rounded-[11px] font-display text-[17px] font-extrabold text-ink ${provider.id === "groq" ? "bg-peach" : provider.id.startsWith("openai") ? "bg-mint" : provider.id === "openrouter" ? "bg-lav" : "border border-dashed border-faint bg-card"}`}
              >
                {provider.name[0]}
              </span>
              <div className="min-w-[120px] flex-1">
                <b className="block text-[13px]">{provider.name}</b>
                <span className="block text-[11px] text-faint">{role}</span>
                {hasKey && !editing && (
                  <code
                    aria-label="Saved API key"
                    className="mt-1 block font-mono text-[11px] tracking-[.18em] text-muted"
                  >
                    ••••••••••••
                  </code>
                )}
              </div>
              {!editing && (
                <>
                  <Tag tone={statusTone}>
                    <i
                      className={`mr-1 inline-block size-1.5 rounded-full ${statusTone === "mint" ? "bg-[#3fbf7f]" : statusTone === "peach" ? "bg-[#d78368]" : "bg-faint"}`}
                    />
                    {status}
                  </Tag>
                  <span className="min-w-[118px] flex-1 text-[11px] leading-snug text-muted">
                    {note}
                  </span>
                  {hasKey ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={c.testingProvider === providerId}
                        onClick={() => c.setEditingKey(providerId)}
                      >
                        {c.testingProvider === providerId ? "Testing…" : "Test"}
                      </Button>
                      <IconButton
                        aria-label={`Remove ${provider.name} API key`}
                        title="Remove key"
                        onClick={() =>
                          void window.vaani
                            .clearProviderApiKey(providerId)
                            .then(() => c.updateSettings({}))
                        }
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        aria-label={`${provider.name} API key`}
                        value={c.keyDrafts[providerId] ?? ""}
                        onChange={(event) =>
                          c.setKeyDrafts({
                            ...c.keyDrafts,
                            [providerId]: event.target.value,
                          })
                        }
                        placeholder="Paste API key"
                        className="min-w-[150px] flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!(c.keyDrafts[providerId] ?? "").trim()}
                        onClick={() =>
                          void c
                            .saveKey(providerId, c.keyDrafts[providerId] ?? "")
                            .then(() =>
                              c.setKeyDrafts({
                                ...c.keyDrafts,
                                [providerId]: "",
                              }),
                            )
                        }
                      >
                        Save
                      </Button>
                    </>
                  )}
                </>
              )}
              {editing && (
                <div className="flex min-w-full flex-wrap gap-2">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    aria-label={`${provider.name} API key`}
                    value={c.keyDrafts[providerId] ?? ""}
                    onChange={(event) =>
                      c.setKeyDrafts({
                        ...c.keyDrafts,
                        [providerId]: event.target.value,
                      })
                    }
                    placeholder="Paste API key"
                    className="min-w-[180px] flex-1 font-mono"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!(c.keyDrafts[providerId] ?? "").trim()}
                    onClick={() =>
                      void c.testKey(providerId, c.keyDrafts[providerId])
                    }
                  >
                    Test and save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      c.setEditingKey(null);
                      c.setKeyDrafts({ ...c.keyDrafts, [providerId]: "" });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Group>
      <Group title="Fallbacks">
        <Row
          title="Provider failover"
          description="If a provider fails, Vaani tries the next available provider."
        >
          <Toggle
            checked={c.settings.failoverEnabled}
            onChange={(value) =>
              void c.updateSettings({ failoverEnabled: value })
            }
          />
        </Row>
        <Row
          title="Processing mode"
          description="Choose when Vaani uses cloud providers or local whisper.cpp."
        >
          <Select
            value={c.settings.offlineMode}
            onChange={(value) =>
              void c.updateSettings({
                offlineMode: value as typeof c.settings.offlineMode,
              })
            }
            options={[
              { value: "auto", label: "Cloud with local fallback" },
              { value: "always-offline", label: "Local only" },
              { value: "always-online", label: "Cloud only" },
            ]}
          />
        </Row>
      </Group>
      <Group title="Local whisper.cpp models">
        {c.whisperModels.length ? (
          c.whisperModels.map((model) => (
            <div
              key={model}
              data-setting-row
              className="my-2 flex items-center gap-3 rounded-[18px] bg-surface p-3"
            >
              <Cpu size={17} className="text-muted" />
              <span className="min-w-0 flex-1 font-mono text-[12px]">
                {model}
              </span>
              {c.settings.localWhisperModel === model ? (
                <Tag tone="mint">In use</Tag>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void c.updateSettings({ localWhisperModel: model })
                  }
                >
                  Use
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="py-3 text-[12px] text-muted">
            No local models are installed.
          </p>
        )}
      </Group>
    </>
  );
}
