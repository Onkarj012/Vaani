const WHISPER_MODEL_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function isValidWhisperModelName(modelName: string): boolean {
  return WHISPER_MODEL_NAME_PATTERN.test(modelName) && !modelName.includes("..");
}

export function assertValidWhisperModelName(modelName: string): void {
  if (!isValidWhisperModelName(modelName)) {
    throw new Error("Invalid Whisper model name. Use letters, numbers, dots, dashes, or underscores only.");
  }
}
