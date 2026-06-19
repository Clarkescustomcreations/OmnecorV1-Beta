# Always-Listening Voice Mode Configuration Guide

This guide explains how to configure and run the **Always-Listening Voice Mode** in the Omnecor Mobile companion app.

Always-Listening Mode allows your Android device to run a persistent microphone loop in the background, listening for the custom wake word `"Hey Omnecor"` (or standard fallbacks), executing on-device transcription via Whisper, and interacting with your desktop workstation's AI personas.

---

## 1. How the Voice Pipeline Works

1. **Wake Word Detection**: The app runs the local **whisper.rn** (GGML) engine on the device's NPU/GPU, transcribing short audio segments to detect your configured wake word (`"Hey Omnecor"` / `"Computer"`). No cloud service or third-party wake-word engine is used.
2. **Foreground Service (Kotlin)**: To prevent Android's system battery optimizer from terminating the mic capture, a custom native Foreground Service (`MicForegroundService`) runs with persistent notifications and microphone priority.
3. **Local STT (Whisper)**: Once the wake word is triggered, **expo-audio** records the utterance, and the local **whisper.rn** engine transcribes the audio directly on the device.
4. **Desktop Persona Handoff**: The text output is sent to your desktop's designated Persona Agent via WebSockets.
5. **Speech Synthesis**: The response is spoken back to you via `expo-speech` (TTS) or local audio players.

---

## 2. Setup 

Always-Listening Mode runs **100% on-device** — there is no account to create, no API key, and no third-party wake-word service. You only need:
1. An Android device with a working microphone.
2. A reachable Omnecor desktop workstation (paired over OMMESH / Tailscale) for the AI persona handoff.
3. A downloaded on-device Whisper STT model (the app downloads this for you in Settings — see below).

---

## 3. Configuration Steps (Mobile App)

1. Open the **Omnecor HQ App** and navigate to the **Settings** tab.
2. Expand the **Always-Listening** config section.
3. Under **Wake Word Configuration**:
   - Type the wake word you want to listen for (defaults to `omnecor`). It is matched against the on-device Whisper transcription — no custom model file is required.
   - Adjust the **Sensitivity** slider (0–1; higher is more sensitive / triggers on lower audio energy).
4. Under **STT Model Setup**:
   - Download the Whisper `base` or `tiny` model (`ggml-model.bin`) using the download progress bar in the settings. (The downloader ignores standard media files to prevent indexing conflicts).
5. Select the **Persona** that should answer your voice intents.
6. Tap the **Test Audio Pipeline** button to verify that permissions are granted and the microphone is capturing cleanly.

---

## 4. Activating Always-Listen Mode

1. Tap the **Always-Listen Switch** in the Settings tab.
2. The system will prompt you for the following Android permissions (grant them all):
   - Record Audio (Microphone)
   - Post Notifications (For the persistent foreground service alert)
3. Once active, a persistent notification badge will appear in your status bar indicating `Omnecor Mic Service - Listening`.
4. You can now close or background the app. Speak the wake word, followed by your query.

---

## 5. Troubleshooting & Limitations

- **Microphone Contention**: Only one service can hold the microphone. If another app (e.g., Google Assistant, a call, or recording software) locks the mic, the foreground service will pause until the device is free.
- **Battery Optimization**: On some Android devices (e.g., Samsung, Xiaomi), you must explicitly turn off battery optimization for the "Omnecor HQ" app in system settings to prevent background suspension.
- **Whisper Latency**: If transcriptions take too long (>3 seconds), switch to the smaller `ggml-tiny.bin` model in the settings tab to reduce inference times on low-end CPUs.
