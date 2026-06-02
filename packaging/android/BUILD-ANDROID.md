# Omnecor — Android Build Guide

This guide explains how to build the Omnecor Android thin client. The Android app acts as a remote interface to a running Omnecor desktop brain on the same local network.

## Prerequisites

1.  **JDK 17**: Required for Gradle.
2.  **Android SDK**: Download via [Android Studio](https://developer.android.com/studio) or command-line tools.
    *   Target SDK: 34
    *   Build Tools: 34.0.0+
3.  **Node.js & pnpm**: See the root `INSTALL.md` for pinned versions.

## Building the APK (Debug)

The following commands build the web assets and synchronize them with the native Android project:

```bash
# From the project root
pnpm install
pnpm build:android
```

Then, compile the APK using Gradle:

```bash
cd packaging/electron-app/android
./gradlew assembleDebug
```

Output: `packaging/electron-app/android/app/build/outputs/apk/debug/app-debug.apk`

## Sideloading for Beta Testing

1.  Enable **Developer Options** on your Android device.
2.  Enable **USB Debugging** and **Install via USB**.
3.  Connect your device and run:
    ```bash
    ./gradlew installDebug
    ```
    Alternatively, copy the `app-debug.apk` to your device and open it via a file manager.

## Connecting to the Desktop Brain

1.  Ensure your Android device and Desktop are on the **same Wi-Fi/LAN**.
2.  Launch the Omnecor app on Android.
3.  In the **Local Network** step of the Setup Wizard, enter the **IP address** of your desktop workstation.
4.  The app will navigate to the desktop backend and provide the full workstation experience.

## Build from Android Studio

1.  Open Android Studio.
2.  Select **Open** and choose the directory: `packaging/electron-app/android`.
3.  Wait for Gradle to sync.
4.  Click **Run > Run 'app'** to deploy to a connected device or emulator.
