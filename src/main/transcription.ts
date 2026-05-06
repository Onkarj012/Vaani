import Groq from "groq-sdk";
import type { Settings, AudioClip, TranscriptionResult } from "@shared/types";
import { formatTranscript } from "./formatting";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
// Whisper's `prompt` parameter is treated as a continuation hint / vocabulary
// sample — NOT as instructions. Putting instructive sentences here causes
// Whisper to hallucinate, paraphrase, or drop content. Keep it short and
// stylistic so the model just biases towards the right vocabulary/casing.
const TRANSCRIPTION_PROMPT: Record<string, string> = {
  default: "",
  hi: "नमस्ते। यह हिंदी में लिखा गया प्रतिलेख है।",
  hinglish: "Namaste. Yeh Hinglish mein likha gaya transcript hai."
};

export class TranscriptionService {
  constructor(private readonly settingsProvider: () => Settings) {}

  async transcribe(clip: AudioClip): Promise<TranscriptionResult> {
    const settings = this.settingsProvider();

    if (!settings.groqApiKey) {
      throw new Error("Groq API key not configured. Add it in Settings.");
    }

    const wavBuffer = createWavBuffer(clip);
    const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer;
    const file = new File([arrayBuffer], "recording.wav", { type: "audio/wav" });

    let lastError: Error | null = null;
    
    // Determine language and prompt
    const isHinglish = settings.language === "hinglish";
    const languageCode = isHinglish ? undefined : settings.language === "auto" ? undefined : settings.language;
    const whisperLang = settings.language === "hinglish" ? "hi" : languageCode; // Hinglish uses Hindi model
    
    const prompt = TRANSCRIPTION_PROMPT[settings.language as keyof typeof TRANSCRIPTION_PROMPT] || TRANSCRIPTION_PROMPT.default;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const groq = new Groq({ apiKey: settings.groqApiKey });
        
        // Whisper prompt: vocabulary/style hint only. We append user
        // dictionary terms (just the written forms) as a comma-separated
        // sample so Whisper biases toward correct spelling, without
        // instructing it to do anything.
        const dictionaryWritten = (settings.customCorrections ?? [])
          .slice(0, 20)
          .map(c => c.written)
          .filter(Boolean)
          .join(", ");
        const enhancedPrompt = [prompt, dictionaryWritten].filter(Boolean).join(" ").trim();

        const response = await groq.audio.transcriptions.create({
          file,
          model: "whisper-large-v3-turbo",
          language: whisperLang,
          temperature: 0,
          ...(enhancedPrompt ? { prompt: enhancedPrompt } : {})
        });

        const rawText = (response.text ?? "").trim();
        if (!rawText) throw new Error("No speech detected in the recording.");
        const formattedText = await formatTranscript(settings.groqApiKey, rawText);

        return {
          rawText,
          formattedText,
          language: settings.language === "auto" ? "en" : settings.language
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) await delay(RETRY_DELAY);
      }
    }

    throw new Error(`Transcription failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
  }
}

function createWavBuffer(audio: AudioClip): Buffer {
  const dataSize = audio.pcmData.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(audio.sampleRate, 24);
  buf.writeUInt32LE(audio.sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < audio.pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, audio.pcmData[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
