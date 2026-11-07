import { ChevronDown } from "lucide-react";
import type { Settings } from "@shared/types";
import {
  isLanguageSupportedByProvider,
  resolveProfileLanguage,
} from "@shared/defaults";
import AppIcon from "@renderer/components/ui/AppIcon";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Select } from "@renderer/components/ui/Select";
import { Toggle } from "@renderer/components/ui/toggle";
import { Group, Row, type SectionComponentProps } from "./SettingsRows";

const styles = [
  { value: "plain", label: "Plain" },
  { value: "developer", label: "Developer" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
  { value: "email", label: "Email" },
];

// Renders per-app language, style and provider settings.
export default function AppProfiles({ context: c }: SectionComponentProps) {
  const profiles = c.settings.appProfiles ?? [];
  return (
    <Group title="App profiles">
      {profiles.map((profile) => {
        const opened = c.expandedProfile === profile.id;
        const effectiveLanguage = resolveProfileLanguage(
          profile.language,
          c.settings.language,
        );
        const profileLanguage =
          profile.language && profile.language !== "auto"
            ? profile.language
            : "";
        return (
          <div
            key={profile.id}
            data-setting-row
            className="my-2 overflow-hidden rounded-[16px] bg-surface"
          >
            <div className="flex flex-wrap items-center gap-2 p-3">
              <AppIcon
                name={profile.name}
                bundleId={profile.appBundleIds[0] ?? ""}
                size={30}
              />
              <div className="min-w-[115px] flex-1">
                <b className="block text-[13px]">{profile.name}</b>
                <span className="block truncate font-mono text-[10px] text-muted">
                  {profile.appBundleIds.join(", ")}
                </span>
              </div>
              <Select
                aria-label={`${profile.name} language`}
                value={profileLanguage}
                onChange={(value) =>
                  c.patchProfile(profile.id, {
                    language: value || undefined,
                    transcriptionProvider:
                      profile.transcriptionProvider &&
                      isLanguageSupportedByProvider(
                        value || c.settings.language,
                        profile.transcriptionProvider,
                        c.settings.localWhisperModel,
                      )
                        ? profile.transcriptionProvider
                        : undefined,
                  })
                }
                options={c.profileLanguageOptions}
              />
              <Select
                aria-label={`${profile.name} style`}
                value={profile.stylePreset ?? ""}
                onChange={(value) =>
                  c.patchProfile(profile.id, {
                    stylePreset: value
                      ? (value as Settings["stylePreset"])
                      : undefined,
                  })
                }
                options={[{ value: "", label: "Default style" }, ...styles]}
              />
              <button
                type="button"
                aria-label={`${opened ? "Collapse" : "Expand"} ${profile.name}`}
                aria-expanded={opened}
                aria-controls={`profile-${profile.id}`}
                onClick={() => c.setExpandedProfile(opened ? null : profile.id)}
                className="grid size-8 place-items-center rounded-full hover:bg-card"
              >
                <ChevronDown
                  size={15}
                  className={`transition-transform ${opened ? "rotate-180" : ""}`}
                />
              </button>
            </div>
            {opened && (
              <div
                id={`profile-${profile.id}`}
                role="region"
                aria-label={`${profile.name} profile`}
                className="grid grid-cols-2 gap-x-4 px-4 pb-4 pl-[54px] max-[700px]:grid-cols-1"
              >
                <label className="grid gap-1 text-[11px] text-muted">
                  Transcription provider
                  <Select
                    value={
                      profile.transcriptionProvider &&
                      isLanguageSupportedByProvider(
                        effectiveLanguage,
                        profile.transcriptionProvider,
                        c.settings.localWhisperModel,
                      )
                        ? profile.transcriptionProvider
                        : ""
                    }
                    onChange={(value) =>
                      c.patchProfile(profile.id, {
                        transcriptionProvider: value || undefined,
                      })
                    }
                    options={[
                      { value: "", label: "Default provider" },
                      ...c.sttProviders
                        .filter((provider) =>
                          isLanguageSupportedByProvider(
                            effectiveLanguage,
                            provider.id,
                            c.settings.localWhisperModel,
                          ),
                        )
                        .map((provider) => ({
                          value: provider.id,
                          label: provider.name,
                        })),
                    ]}
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-muted">
                  Cleanup provider
                  <Select
                    value={profile.formattingProvider ?? ""}
                    onChange={(value) =>
                      c.patchProfile(profile.id, {
                        formattingProvider: value || undefined,
                      })
                    }
                    options={[
                      { value: "", label: "Default provider" },
                      ...c.llmProviders.map((provider) => ({
                        value: provider.id,
                        label: provider.name,
                      })),
                    ]}
                  />
                </label>
                <Row title="Context awareness">
                  <Toggle
                    checked={
                      profile.contextAwarenessEnabled ??
                      c.settings.contextAwarenessEnabled
                    }
                    onChange={(value) =>
                      c.patchProfile(profile.id, {
                        contextAwarenessEnabled: value,
                      })
                    }
                  />
                </Row>
                <Row title="Press Return after inserting">
                  <Toggle
                    checked={profile.autoSubmit ?? false}
                    onChange={(value) =>
                      c.patchProfile(profile.id, { autoSubmit: value })
                    }
                  />
                </Row>
                <Button
                  variant="ghost"
                  size="sm"
                  className="col-span-full justify-self-start text-red-500"
                  onClick={() => {
                    void c.updateSettings({
                      appProfiles: profiles.filter(
                        (item) => item.id !== profile.id,
                      ),
                    });
                    c.setExpandedProfile(null);
                  }}
                >
                  Remove profile
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {c.addingProfile ? (
        <div className="my-2 grid gap-2 rounded-[16px] border border-line p-3">
          <Input
            value={c.profileName}
            onChange={(event) => c.setProfileName(event.target.value)}
            placeholder="App name"
            aria-label="App name"
          />
          <Input
            value={c.profileBundle}
            onChange={(event) => c.setProfileBundle(event.target.value)}
            placeholder="Bundle ID"
            aria-label="Bundle ID"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={c.addProfile}
              disabled={!c.profileBundle.trim()}
            >
              Add profile
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => c.setAddingProfile(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => c.setAddingProfile(true)}
        >
          + Add app profile
        </Button>
      )}
    </Group>
  );
}
