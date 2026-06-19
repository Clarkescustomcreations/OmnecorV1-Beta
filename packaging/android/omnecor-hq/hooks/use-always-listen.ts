/**
 * Hooks for the always-listening voice loop.
 *
 * Implements continuous sliding-window wake-word recording loop
 * using local NPU Whisper STT, replacing Picovoice.
 */
import { useCallback, useEffect, useState } from "react";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import {
  subscribeListenState,
  getListenState,
  getListenError,
  setCaptureProvider,
  startListening,
  stopListening,
  captureAndRun,
  ensureSttModelLoaded,
  isListening,
  type ListenState,
} from "@/lib/_core/always-listen";
import { transcribeFile } from "@/lib/_core/local-stt";
import { getListenConfig } from "@/lib/_core/always-listen-config";

/** Max length of a single captured utterance (foreground fixed window). */
const UTTERANCE_MS = 6000;

/**
 * Headless: registers the app-wide utterance capture provider. Mount once at the
 * root. Runs continuous wake-word loop when state is "listening".
 */
export function useAlwaysListenCapture(): void {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const capture = useCallback(async (): Promise<string | null> => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return null;
    await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
    recorder.record();
    await new Promise((r) => setTimeout(r, UTTERANCE_MS));
    await recorder.stop();
    return recorder.uri ?? null;
  }, [recorder]);

  useEffect(() => {
    setCaptureProvider(capture);
    return () => setCaptureProvider(null);
  }, [capture]);

  // Continuous wake-word detection loop
  useEffect(() => {
    let active = true;
    let isLooping = false;

    const wakeLoop = async () => {
      if (isLooping) return;
      isLooping = true;
      while (active) {
        const state = getListenState();
        if (state === "listening" && isListening()) {
          try {
            const { granted } = await AudioModule.requestRecordingPermissionsAsync();
            if (!granted) {
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
            recorder.record();
            // Record short 1.8s chunk
            await new Promise((r) => setTimeout(r, 1800));
            await recorder.stop();

            const uri = recorder.uri;
            if (uri && active && getListenState() === "listening" && isListening()) {
              // Run transcription on local NPU
              const text = await transcribeFile(uri, { language: "en" });
              const clean = text.toLowerCase().trim();

              // Clean up punctuation
              const cleanText = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
              const wakeWord = getListenConfig().wakeWord?.toLowerCase() || "omnecor";

              if (cleanText.includes(wakeWord) || cleanText.includes("computer")) {
                // Wake word heard! Trigger utterance capture
                void captureAndRun();
                // Wait to prevent immediate loop re-entry
                await new Promise((r) => setTimeout(r, 2000));
              }
            }
          } catch (e) {
            console.warn("[useAlwaysListenCapture] Loop error:", e);
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else {
          // Check again in 500ms
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      isLooping = false;
    };

    void wakeLoop();

    return () => {
      active = false;
    };
  }, [recorder]);
}

/** Controls + live state for the Settings UI (no recorder of its own). */
export function useAlwaysListen() {
  const [state, setState] = useState<ListenState>(getListenState());
  const [error, setError] = useState<string | null>(getListenError());
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      subscribeListenState((s) => {
        setState(s);
        setError(getListenError());
      }),
    [],
  );

  const start = useCallback(async () => {
    setBusy(true);
    try { await startListening(); } finally { setBusy(false); }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try { await stopListening(); } finally { setBusy(false); }
  }, []);

  /** Manual one-shot turn for testing the pipeline without the wake word. */
  const testTurn = useCallback(async () => {
    setBusy(true);
    try {
      await ensureSttModelLoaded();
      await captureAndRun();
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, start, stop, testTurn };
}
