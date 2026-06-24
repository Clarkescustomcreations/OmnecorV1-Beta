/**
 * Canonical Terms of Service version metadata, shared by the client (wizard,
 * /terms page, Settings) and the server (acceptance recording). Bump TOS_VERSION
 * whenever the terms change materially — every user is then re-prompted to
 * accept, because acceptance is stored per-version (`users.tosAcceptedVersion`).
 *
 * The human-readable section text lives in `client/src/lib/tosContent.ts`; only
 * the version/date constants live here so the server stays UI-free.
 */
export const TOS_VERSION = "1.1.0";
export const TOS_EFFECTIVE_DATE = "2026-06-24";

/**
 * Where the developer is based — referenced as a soft, plain-language note in
 * the closing section of the Terms (not a formal governing-law clause).
 */
export const TOS_GOVERNING_JURISDICTION = "Nova Scotia, Canada";

/** True when the user's recorded acceptance matches the current ToS version. */
export function hasAcceptedCurrentTos(
  acceptedVersion: string | null | undefined,
): boolean {
  return acceptedVersion === TOS_VERSION;
}
