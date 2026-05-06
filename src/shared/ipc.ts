export const enum IpcChannel {
  // Dictation lifecycle
  DictationState = "dictation:state",
  AudioLevel = "dictation:audio-level",
  SubmitAudioClip = "dictation:submit-audio",
  RecorderReady = "dictation:recorder-ready",
  ReportAudioFrame = "dictation:report-audio-frame",
  RecorderFailure = "dictation:recorder-failure",
  PrepareRecordingInput = "dictation:prepare-recording-input",
  RestoreRecordingInput = "dictation:restore-recording-input",

  // History
  GetHistory = "history:get",
  UpdateHistoryEntry = "history:update",
  ReinjectEntry = "history:reinject",
  DeleteEntry = "history:delete",
  ClearHistory = "history:clear",

  // Settings
  GetSettings = "settings:get",
  UpdateSettings = "settings:update",
  SetHotkeyCapture = "hotkeys:set-capture",

  // Navigation
  Navigation = "app:navigate",

  // Dictionary
  ShowDictionaryPrompt = "dictionary:show-prompt",
}
