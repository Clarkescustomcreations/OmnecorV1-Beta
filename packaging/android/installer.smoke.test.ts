/**
 * Android APK packaging smoke tests.
 *
 * Validates Capacitor config, AndroidManifest, and build.gradle statically.
 * Each test corresponds to an audit finding; the failure message says what to fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ELECTRON_APP = path.resolve(import.meta.dirname, '../../packaging/electron-app');
const ANDROID_APP = path.join(ELECTRON_APP, 'android', 'app');
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

const CAPACITOR_CONFIG = path.join(ELECTRON_APP, 'capacitor.config.ts');
const ANDROID_MANIFEST = path.join(ANDROID_APP, 'src', 'main', 'AndroidManifest.xml');
const BUILD_GRADLE = path.join(ANDROID_APP, 'build.gradle');
const VARIABLES_GRADLE = path.join(ELECTRON_APP, 'android', 'variables.gradle');
const STRINGS_XML = path.join(ANDROID_APP, 'src', 'main', 'res', 'values', 'strings.xml');
const MAIN_ACTIVITY = path.join(
  ANDROID_APP,
  'src', 'main', 'java', 'com', 'omnecor', 'workstation', 'MainActivity.java',
);
const ROOT_PKG = path.join(PROJECT_ROOT, 'package.json');

// ── Capacitor config ───────────────────────────────────────────────────────

describe('Capacitor config (capacitor.config.ts)', () => {
  it('file exists', () => {
    expect(existsSync(CAPACITOR_CONFIG), `Missing: ${CAPACITOR_CONFIG}`).toBe(true);
  });

  it('appId is com.omnecor.workstation', () => {
    const cfg = readFileSync(CAPACITOR_CONFIG, 'utf8');
    expect(cfg).toContain("appId: 'com.omnecor.workstation'");
  });

  it('webDir points to out/renderer (electron-vite renderer output)', () => {
    const cfg = readFileSync(CAPACITOR_CONFIG, 'utf8');
    expect(
      cfg,
      "capacitor.config.ts webDir should be 'out/renderer' — that is where electron-vite outputs the renderer build",
    ).toContain("webDir: 'out/renderer'");
  });

  it('enables allowMixedContent for LAN http connections', () => {
    const cfg = readFileSync(CAPACITOR_CONFIG, 'utf8');
    expect(
      cfg,
      'android.allowMixedContent must be true — the thin client connects over http:// to the LAN desktop backend',
    ).toContain('allowMixedContent: true');
  });
});

// ── AndroidManifest.xml ────────────────────────────────────────────────────

describe('AndroidManifest.xml', () => {
  it('file exists', () => {
    expect(existsSync(ANDROID_MANIFEST), `Missing: ${ANDROID_MANIFEST}`).toBe(true);
  });

  it('declares INTERNET permission', () => {
    const manifest = readFileSync(ANDROID_MANIFEST, 'utf8');
    expect(
      manifest,
      'INTERNET permission missing — the app cannot reach the backend without it',
    ).toContain('android.permission.INTERNET');
  });

  it('allows cleartext traffic (required for LAN http:// connections on Android 9+)', () => {
    const manifest = readFileSync(ANDROID_MANIFEST, 'utf8');
    expect(
      manifest,
      [
        'android:usesCleartextTraffic="true" is missing from <application>.',
        'Android 9+ blocks cleartext by default; the thin-client cannot reach http://<lan-ip>:3000 without it.',
        'Add android:usesCleartextTraffic="true" to the <application> element.',
      ].join('\n'),
    ).toContain('android:usesCleartextTraffic="true"');
  });

  it('MainActivity is exported=true (required for Android 12+ launch)', () => {
    const manifest = readFileSync(ANDROID_MANIFEST, 'utf8');
    expect(manifest).toContain('android:exported="true"');
  });

  it('has a LAUNCHER intent filter on MainActivity', () => {
    const manifest = readFileSync(ANDROID_MANIFEST, 'utf8');
    expect(manifest).toContain('android.intent.category.LAUNCHER');
  });
});

// ── variables.gradle ──────────────────────────────────────────────────────

describe('variables.gradle', () => {
  it('file exists', () => {
    expect(existsSync(VARIABLES_GRADLE), `Missing: ${VARIABLES_GRADLE}`).toBe(true);
  });

  it('compileSdkVersion >= 34 (Google Play requirement since Aug 2024)', () => {
    const gradle = readFileSync(VARIABLES_GRADLE, 'utf8');
    const match = gradle.match(/compileSdkVersion\s*=\s*(\d+)/);
    expect(match, 'compileSdkVersion not found in variables.gradle').not.toBeNull();
    expect(
      parseInt(match![1], 10),
      `compileSdkVersion is ${match![1]} — must be >= 34 for Play Store submission (required since Aug 2024)`,
    ).toBeGreaterThanOrEqual(34);
  });

  it('targetSdkVersion >= 34 (Google Play requirement since Aug 2024)', () => {
    const gradle = readFileSync(VARIABLES_GRADLE, 'utf8');
    const match = gradle.match(/targetSdkVersion\s*=\s*(\d+)/);
    expect(match, 'targetSdkVersion not found in variables.gradle').not.toBeNull();
    expect(
      parseInt(match![1], 10),
      `targetSdkVersion is ${match![1]} — must be >= 34 for Play Store submission (required since Aug 2024)`,
    ).toBeGreaterThanOrEqual(34);
  });

  it('minSdkVersion is set (Capacitor 5 requires >= 22)', () => {
    const gradle = readFileSync(VARIABLES_GRADLE, 'utf8');
    const match = gradle.match(/minSdkVersion\s*=\s*(\d+)/);
    expect(match, 'minSdkVersion not found in variables.gradle').not.toBeNull();
    expect(
      parseInt(match![1], 10),
      `minSdkVersion is ${match![1]} — Capacitor 5 requires >= 22`,
    ).toBeGreaterThanOrEqual(22);
  });
});

// ── app/build.gradle ──────────────────────────────────────────────────────

describe('app/build.gradle', () => {
  it('file exists', () => {
    expect(existsSync(BUILD_GRADLE), `Missing: ${BUILD_GRADLE}`).toBe(true);
  });

  it('applicationId matches Capacitor appId (com.omnecor.workstation)', () => {
    const gradle = readFileSync(BUILD_GRADLE, 'utf8');
    expect(
      gradle,
      'applicationId in build.gradle must match capacitor.config.ts appId: com.omnecor.workstation',
    ).toContain('applicationId "com.omnecor.workstation"');
  });

  it('namespace matches applicationId', () => {
    const gradle = readFileSync(BUILD_GRADLE, 'utf8');
    expect(gradle).toContain('namespace "com.omnecor.workstation"');
  });
});

// ── Source structure ───────────────────────────────────────────────────────

describe('Android source structure', () => {
  it('MainActivity.java exists at the correct package path', () => {
    expect(
      existsSync(MAIN_ACTIVITY),
      `Missing: ${MAIN_ACTIVITY} — package com.omnecor.workstation maps to this path`,
    ).toBe(true);
  });

  it('strings.xml declares the correct app_name', () => {
    const strings = readFileSync(STRINGS_XML, 'utf8');
    expect(strings).toContain('Omnecor');
  });
});
