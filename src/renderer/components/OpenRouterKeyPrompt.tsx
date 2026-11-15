import { useState } from "react";
import type { FormEvent } from "react";
import type { Settings } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { providerKeySaved } from "@renderer/lib/providerKeyDraft";

interface OpenRouterKeyPromptProps {
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

const SAVE_FAILED = "Key not saved. Check that Vaani can use Keychain, then try again.";

// One-time notice asking for an OpenRouter key. It stays until the user saves a key or dismisses it.
export default function OpenRouterKeyPrompt({ updateSettings }: OpenRouterKeyPromptProps) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function dismiss() {
    await updateSettings({ openRouterKeyPromptShown: true });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const next = await window.vaani.setProviderApiKey("openrouter", trimmed);
      // Main returns unchanged settings when it refuses the save, so only close once the key is really stored.
      if (providerKeySaved(next.providerApiKeys, "openrouter")) {
        await dismiss();
        return;
      }
      setError(SAVE_FAILED);
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      role="dialog"
      aria-label="Add an OpenRouter key"
      onSubmit={(event) => void save(event)}
      className="fixed bottom-5 right-5 z-50 w-[360px] rounded-2xl border border-line bg-bg p-5 shadow-card"
    >
      <h2 className="text-base font-semibold text-ink">Add an OpenRouter key</h2>
      <p className="mt-1 text-sm text-muted">
        Transcription and cleanup now run through OpenRouter. Without a key, transcription falls back to Groq if a Groq key is saved, and cleanup is skipped.
      </p>
      <Input
        type="password"
        aria-label="OpenRouter API key"
        value={key}
        onChange={(e) => { setKey(e.target.value); setError(""); }}
        autoComplete="off"
        spellCheck={false}
        className="mt-4"
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => void dismiss()}>Later</Button>
        <Button type="submit" variant="accent" size="sm" disabled={!key.trim() || saving}>
          {saving ? "Saving…" : "Save key"}
        </Button>
      </div>
    </form>
  );
}
