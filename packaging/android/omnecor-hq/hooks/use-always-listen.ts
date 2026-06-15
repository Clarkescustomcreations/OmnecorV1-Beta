/**
 * Hooks for the always-listening voice loop.
 *
 * Split into two concerns so the mic capturer isn't tied to any one screen:
 *
 *  - `useAlwaysListenCapture()` — headless. Owns an expo-audio recorder and
 *    registers it as the orchestrator's capture provider. Mount ONCE at the app
 *    root (`app/_layout.tsx`) so a wake event works regardless of which screen
 *    is showing (Phase 3's foreground service swaps in a background VAD provider
 *    via `setCaptureProvider`).
 *  - `useAlwaysListen()` — controls + live state for the Settings UI. Does NOT
 *    own a recorder; it drives the orchestrator, which uses the globally
 *    registered capture provider.
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
  type ListenState,
} from "@/lib/_core/always-listen";

/** Max length of a single captured utterance (foreground fixed window). */
const UTTERANCE_MS = 6000;

/**
 * Headless: registers the app-wide utterance capture provider. Mount once at the
 * root. Records a fixed window and returns the file URI; the orchestrator handles
 * pausing/re-arming the wake engine around it.
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
