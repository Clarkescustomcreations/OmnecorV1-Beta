/**
 * Mic Foreground Service — local Expo module (Android).
 *
 * Starts an Android foreground service with `foregroundServiceType="microphone"`
 * and a persistent notification so the always-listening wake-word pipeline keeps
 * the mic alive while the app is backgrounded or closed. The JS audio pipeline
 * (Porcupine + the app-wide capture provider) continues running because the
 * foreground service keeps the process from being killed.
 *
 * The native module is optional at load time so the JS type-checks (and the app
 * runs) before `expo prebuild` regenerates the Android project with this module.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

interface MicForegroundServiceNative {
  startService(title: string, body: string): void;
  stopService(): void;
}

const native = requireOptionalNativeModule<MicForegroundServiceNative>("MicForegroundService");

export function isMicForegroundServiceAvailable(): boolean {
  return native != null;
}

export function startMicForegroundService(
  title = "Omnecor is listening",
  body = 'Say "Hey Omnecor" to talk.',
): void {
  native?.startService(title, body);
}

export function stopMicForegroundService(): void {
  native?.stopService();
}
