import { useEffect, useRef } from "react";
import { useDictation } from "./hooks/useDictation";
import { useHistory } from "./hooks/useHistory";
import { useSettings } from "./hooks/useSettings";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

// Headless app - no UI rendered
// The renderer runs only for audio recording via Web Audio API
// All user feedback is through the overlay capsule
export default function App() {
  const dictation = useDictation();
  const history = useHistory();
  useSettings(); // Initialize settings
  const { startRecording, stopRecording } = useAudioRecorder();
  const prevStateRef = useRef(dictation);

  useEffect(() => {
    // Report that recorder is ready
    void window.__VAANI_RECORDER__.reportRecorderReady();
  }, []);

  // Core dictation logic - handles audio recording based on dictation state
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = dictation;

    // Start recording when entering recording state
    if (dictation.status === "recording" && prev.status !== "recording") {
      void startRecording().then((started) => {
        if (!started) {
          void window.__VAANI_RECORDER__.reportRecorderFailure({
            sessionId: dictation.sessionId,
            message: "Microphone recording could not start."
          });
        }
      });
    }

    // Stop recording when leaving recording state
    if (prev.status === "recording" && dictation.status !== "recording") {
      if (dictation.status === "finalizing") {
        void stopRecording().then(async (result) => {
          if (result) {
            await window.__VAANI_RECORDER__.submitAudioClip({
              sessionId: dictation.sessionId,
              clip: result.clip
            });
            return;
          }
          await window.__VAANI_RECORDER__.reportRecorderFailure({
            sessionId: dictation.sessionId,
            message: "Recording could not be finalized."
          });
        });
      } else {
        void stopRecording();
      }
    }
  }, [dictation, startRecording, stopRecording]);

  // Reload history when dictation succeeds
  useEffect(() => {
    if (dictation.status === "completed") {
      void history.reload();
    }
  }, [dictation.status, history.reload]);

  // No UI rendered - app is headless
  // The overlay capsule provides all visual feedback
  return null;
}
