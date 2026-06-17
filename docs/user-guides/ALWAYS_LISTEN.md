# Always-Listening Voice Mode Configuration Guide

This guide explains how to configure and run the **Always-Listening Voice Mode** in the Omnecor Mobile companion app.

Always-Listening Mode allows your Android device to run a persistent microphone loop in the background, listening for the custom wake word `"Hey Omnecor"` (or standard fallbacks), executing on-device transcription via Whisper, and interacting with your desktop workstation's AI personas.

---

## 1. How the Voice Pipeline Works

1. **Wake Word Detection**: The app runs the **Picovoice Porcupine** engine locally on the device to monitor the microphone stream.
2. **Foreground Service (Kotlin)**: To prevent Android's system battery optimizer from terminating the mic capture, a custom native Foreground Service (`MicForegroundService`) runs with persistent notifications and microphone priority.
3. **Local STT (Whisper)**: Once the wake word is triggered, **expo-audio** records the utterance, and the local **whisper.rn** engine transcribes the audio directly on the device.
4. **Desktop Persona Handoff**: The text output is sent to your desktop's designated Persona Agent via WebSockets.
5. **Speech Synthesis**: The response is spoken back to you via `expo-speech` (TTS) or local audio players.

---

## 2. Setup Prerequisites

To utilize Always-Listening Mode, you must obtain a Picovoice API Key:
1. Go to the [Picovoice Console](https://console.picovoice.ai/) and create a free account.
2. Copy your **AccessKey** from the dashboard.
3. (Optional) In the Picovoice console, train a custom wake-word model for the phrase `"Hey Omnecor"` targeting the Android platform, and download the resulting `.ppn` file.

---

## 3. Configuration Steps (Mobile App)

1. Open the **Omnecor HQ App** and navigate to the **Settings** tab.
2. Expand the **Always-Listening** config section.
3. Enter your **Picovoice AccessKey** and save settings.
4. Under **Wake Word Configuration**:
   - By default, the app uses the built-in fallback keyword `COMPUTER`.
   - To use your custom trained wake word, upload your `.ppn` file to the app's document storage directory, or select it from the file picker.
5. Under **STT Model Setup**:
   - Download the Whisper `base` or `tiny` model (`ggml-model.bin`) using the download progress bar in the settings. (The downloader ignores standard media files to prevent indexing conflicts).
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
