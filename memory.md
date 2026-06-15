# Memory — Omnecor Phase 5 Started (F23 Complete)

Last updated: 2026-06-15

---

## DO NOT REMOVE THIS NOTE **Important: Read AGENTS.md Before Beginning The Next Session**

---

## What was built

### Phase 5, Feature 23: Secure KeyStore Encryption — ✅ COMPLETE

Scope: get the OMMESH secret and chat histories out of plaintext AsyncStorage and
into the hardware KeyStore (Android KeyStore / iOS Keychain) via `expo-secure-store`.
All changes are in `packaging/android/omnecor-hq/` (the APK workspace only).

- **NEW: `lib/_core/secure-crypto.ts`** — hardware-backed **envelope encryption** helper.
  SecureStore caps each value at ~2048 bytes, too small for chat histories, so:
  - A random 256-bit data key (DEK) lives in SecureStore (slot `omnecor_dek_v1`), created
    lazily on first use. Hardware-backed; never leaves the KeyStore-protected store.
  - From the DEK we derive two domain-separated sub-keys: `encKey = SHA256(master || "omnecor-enc")`,
    `macKey = SHA256(master || "omnecor-mac")` (cached in module memory).
  - `encryptString(plaintext)` → `v1.<ivB64>.<ctB64>.<macHex>` — AES-256-CBC + PKCS7,
    then HMAC-SHA256 over `ivB64.ctB64` (encrypt-then-MAC). `decryptString` verifies the
    MAC (constant-time-ish `safeEqual`) before decrypting; returns null on any
    format/MAC/decode failure (callers treat as "no data"). `isEncrypted(v)` heuristic =
    `v1.` prefix + 4 dot-parts. Bulk ciphertext is stored in AsyncStorage.

- **`lib/_core/server-config.ts`** — OMMESH secret (`omnecor_ommesh_secret`) now in SecureStore.
  - `loadServerConfig`: reads secret from SecureStore; migrates any legacy plaintext
    AsyncStorage secret into SecureStore, then `removeItem`s the plaintext —
    **but only scrubs after the SecureStore write succeeds** (KeyStore-unavailable devices
    keep the plaintext to retry next launch, so the secret is never lost).
  - `saveServerConfig`: writes the secret ONLY to SecureStore (empty string → `deleteItemAsync`).
    IP / port / node name stay in AsyncStorage `multiSet` (not sensitive).
  - All secret consumers already go through `getOmmeshSecret()` (reads in-memory `_secret`),
    so no other code touched. `mobile-mesh-node.ts` sends it over WS (expected).

- **`lib/_core/chat-store.ts`** — chat histories encrypted at rest.
  - `saveChats`: `encryptString(JSON.stringify(snapshot))` → AsyncStorage.
  - `loadChats`: if stored value `isEncrypted` → `decryptString`; else treats it as a
    legacy plaintext snapshot, uses it, and re-persists it encrypted (best-effort migration).
  - `saveChats`/`clearChats` now `console.warn` on failure (was silent `catch {}`, per
    AGENTS "no silent catch" rule).

- **Dependency added:** `crypto-js ^4.2.0` (+ dev `@types/crypto-js ^4.2.2`) in the APK
  workspace package.json. Pure-JS, Hermes-safe. Its `WordArray.random` pulls from
  `crypto.getRandomValues`, which is polyfilled app-wide by `react-native-get-random-values`
  (already imported at `app/_layout.tsx:4`).

Also ran `/review` (project skill) on the change — it found 2 minor issues, both fixed
(the secret-loss-on-write-failure guard, and the silent chat-store catches above).

---

## Decisions made

- **Envelope encryption, not raw SecureStore for chat histories.** SecureStore's ~2048-byte
  value limit makes storing chat JSON directly impossible/unreliable — the KeyStore holds the
  *key*, AsyncStorage holds the AES-256 ciphertext. This is the correct realization of the
  F23 plan wording ("save chat histories inside the hardware KeyStore").
- **crypto-js chosen** over aes-js: single self-contained pure-JS dep providing AES + HMAC-SHA256
  + base64, Hermes-compatible, uses the existing CSPRNG. Hand-rolling AES would violate good
  security practice; WebCrypto `subtle` is not available in Hermes; `expo-crypto` lacks a cipher.
- **IP/port/nodeName are NOT secrets** — they stay in AsyncStorage; only the OMMESH secret moved.
- Plaintext is scrubbed only after a confirmed SecureStore write (no data-loss window).

(Carried-forward decisions from prior phases still hold — single libSQL/SQLite engine;
`cloudProcedure` for external APIs; `Pressable` from `@/components/pressable`; release APK
required; `bonjour` static import; integer PKs → `z.number()`; nanoid Metro fix permanent.)

---

## Problems solved

- **SecureStore 2048-byte limit** would break direct chat-history storage → solved with
  envelope encryption (key in KeyStore, ciphertext in AsyncStorage).
- **crypto-js randomness in Hermes**: crypto-js 4.x THROWS (no Math.random fallback) if
  `crypto.getRandomValues` is absent. It's present because `react-native-get-random-values`
  is imported at app entry — confirmed before relying on it.
- **pnpm transient `ENOENT ... rename ... esbuild`** during `pnpm add` (electron-vite nested
  esbuild race) left package.json half-written. Fix: re-run `pnpm add crypto-js@^4.2.0`, then
  `pnpm install` from repo root to relink the workspace symlink
  (`packaging/android/omnecor-hq/node_modules/crypto-js`).
- **Secret-loss edge case** (review finding): scrubbing plaintext before confirming the
  KeyStore write could lose the secret on KeyStore-unavailable devices → reordered.

---

## Current state

- **Gates GREEN:** APK `tsc --noEmit` = 0 · root `pnpm check` = 0 · `pnpm test` = 323/323.
- `Context/Progress-Tracker.md`: F23 marked [x] with Done note; "Current Status" → Phase 5
  (1/5), Next Task = Feature 24.
- **APK NOT rebuilt** — crypto-js is a new bundle dep; the rebuild + device test is scoped
  under F27 (no rebuild needed now; `tsc` validates types).

---

## Next session starts with

1. **Read `/home/linux/Documents/OmnecorV1-Beta/AGENTS.md` first** (mandatory reading order).
2. **Phase 5, Feature 24: Mobile 3D Canvas Interactivity** —
   File: `client/src/pages/3DDesigner.tsx` (per Build-Plan). Task: implement real
   touch-rotation, mesh selection, and format-export logic inside the mobile 3D Viewer
   WebView container. NOTE: APK-todo currently says the mobile 3D viewer is "preview-only,
   AI panel removed" — reconcile what F24 actually targets (mobile viewer wiring to
   `blender`/`comfy` for real models) before building.
3. Continue F25 → F26 → F27 in order.
4. **F27** includes: rebuild APK (`pnpm prebuild:android && pnpm apk:release`) — will now
   bundle crypto-js — and device-test on Samsung S25 Ultra (nanoid crypto fix, local
   register, tabs load, plus verify F23: secret persists in KeyStore, chats survive restart).

---

## Open questions

- APK not yet validated on device (crypto fix + now F23 KeyStore/encryption) — must rebuild
  and test in F27.
- F24 scope ambiguity: Build-Plan says "mobile 3D Viewer WebView container" but the APK
  3D screen was made preview-only (AI panel removed) in a prior pass. Confirm target before coding.
- Auto-memory note ([[omnecor-audit]]) still flags the social pipeline (discovery + publishing)
  as a shell, which contradicts the "social pipeline NOW REAL" entry in Progress-Tracker —
  worth reconciling (⚠️ "not yet live-tested against real platform APIs" is the likely truth).
- On-device CPU inference speed (NPU/Hexagon disabled) — acceptable for target use?
- Phase 5 F26 Settings controls need their subsystems to exist first.
