export const enum IpcChannel {
  // Dictation lifecycle
  DictationState = "dictation:state",
  GetDictationState = "dictation:get-state",
  AudioLevel = "dictation:audio-level",
  SubmitAudioClip = "dictation:submit-audio",
  RecorderReady = "dictation:recorder-ready",
  RecorderStarted = "dictation:recorder-started",
  ReportAudioFrame = "dictation:report-audio-frame",
  RecorderFailure = "dictation:recorder-failure",
  PrepareRecordingInput = "dictation:prepare-recording-input",
  RestoreRecordingInput = "dictation:restore-recording-input",
  StartRecording = "dictation:start-recording",
  StopRecording = "dictation:stop-recording",

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

  // App lifecycle / diagnostics
  RendererReady = "app:renderer-ready",
  RendererError = "app:renderer-error",
}
