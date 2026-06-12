/**
 * Voice hook: Whisper STT + expo-speech TTS.
 *
 * STT flow:
 *   1. Record audio via expo-audio (mic)
 *   2. POST the audio file directly to the PC's Whisper server on port 8001
 *      (bypasses tRPC — Whisper accepts raw multipart/form-data)
 *   3. Return transcribed text, inject it into the chat input
 *
 * TTS flow:
 *   - Uses expo-speech (device-native engine — no server round-trip)
 *   - Near-zero latency, works offline
 *   - Falls back silently if speech engine unavailable
 *
 * Requires: pnpm add expo-speech
 */
import { useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import * as Speech from "expo-speech";
import { getWhisperUrl, isServerConfigured } from "@/lib/_core/server-config";

export type VoiceState = {
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  ttsEnabled: boolean;
  error: string | null;
};

export function useVoice() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking]         = useState(false);
  const [ttsEnabled, setTtsEnabled]         = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  // ── STT ──────────────────────────────────────────────────────────────────

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) throw new Error("Microphone permission denied");
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [recorder]);

  const stopAndTranscribe = useCallback(async (): Promise<string> => {
    if (!isRecording) return "";
    setIsRecording(false);

    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return "";

      if (!isServerConfigured()) {
        setError("Set your Omnecor server IP in Settings first");
        return "";
      }

      setIsTranscribing(true);
      const whisperUrl = getWhisperUrl();

      // Build multipart form — Whisper server accepts `file` field
      const formData = new FormData();
      formData.append("file", {
        uri,
        type: "audio/m4a",
        name: "recording.m4a",
      } as any);

      const response = await fetch(`${whisperUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Whisper returned ${response.status} — is the Whisper server running on port 8001?`);
      }

      const data = await response.json();
      // Whisper server returns { text: "..." } or { transcript: "..." }
      return (data.text ?? data.transcript ?? "").trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return "";
    } finally {
      setIsTranscribing(false);
    }
  }, [isRecording, recorder]);

  // ── TTS ──────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string, opts?: { rate?: number; pitch?: number }): void => {
      if (!ttsEnabled || !text.trim()) return;

      // Strip markdown for cleaner reading
      const clean = text
        .replace(/#{1,6}\s/g, "")
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
        .replace(/`[^`]+`/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .slice(0, 2000); // expo-speech limit

      Speech.speak(clean, {
        rate:    opts?.rate  ?? 1.0,
        pitch:   opts?.pitch ?? 1.0,
        onStart: () => setIsSpeaking(true),
        onDone:  () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    },
    [ttsEnabled]
  );

  const stopSpeaking = useCallback((): void => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  return {
    isRecording,
    isTranscribing,
    isSpeaking,
    ttsEnabled,
    setTtsEnabled,
    error,
    startRecording,
    stopAndTranscribe,
    speak,
    stopSpeaking,
  };
}
