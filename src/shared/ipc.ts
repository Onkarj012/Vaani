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
  CopyText = "clipboard:copy-text",

  // Settings
  GetSettings = "settings:get",
  UpdateSettings = "settings:update",
  SetHotkeyCapture = "hotkeys:set-capture",

  // Navigation
  Navigation = "app:navigate",

  // Dictionary
  ShowDictionaryPrompt = "dictionary:show-prompt",

  // macOS permissions
  GetPermissionStatus = "permissions:get-status",
  RequestMicrophonePermission = "permissions:request-microphone",
  RequestAccessibilityPermission = "permissions:request-accessibility",
  OpenPermissionSettings = "permissions:open-settings",

  // App lifecycle / diagnostics
  RendererReady = "app:renderer-ready",
  RendererError = "app:renderer-error",
  RelaunchApp = "app:relaunch",

  // Phase 1: Providers
  TestApiKey = "providers:test-api-key",
  GetProviderStatus = "providers:get-status",

  // Updater notifications
  UpdateNotification = "updater:notification",
  CheckForUpdates = "updater:check",
  GetUpdateStatus = "updater:get-status",
  QuitAndInstall = "updater:quit-and-install",

  // App info
  GetAppVersion = "app:get-version",

  // Demo transcription
  DemoTranscribe = "demo:transcribe",
}
