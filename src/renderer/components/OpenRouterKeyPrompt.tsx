import { useState } from "react";
import type { Settings } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface OpenRouterKeyPromptProps {
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

// One-time notice asking for an OpenRouter key. It stays until the user saves a key or dismisses it.
export default function OpenRouterKeyPrompt({ updateSettings }: OpenRouterKeyPromptProps) {
  const [key, setKey] = useState("");

  async function dismiss() {
    await updateSettings({ openRouterKeyPromptShown: true });
  }

  async function save() {
    const trimmed = key.trim();
    if (!trimmed) return;
    await window.vaani.setProviderApiKey("openrouter", trimmed);
    await dismiss();
  }

  return (
    <div role="dialog" aria-label="Add an OpenRouter key" className="fixed bottom-5 right-5 z-50 w-[360px] rounded-2xl border border-line bg-bg p-5 shadow-card">
      <h2 className="text-base font-semibold text-ink">Add an OpenRouter key</h2>
      <p className="mt-1 text-sm text-muted">
        Transcription and cleanup now run through OpenRouter. Without a key, transcription falls back to Groq if a Groq key is saved, and cleanup is skipped.
      </p>
      <Input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="mt-4"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => void dismiss()}>Later</Button>
        <Button variant="accent" size="sm" disabled={!key.trim()} onClick={() => void save()}>Save key</Button>
      </div>
    </div>
  );
}
