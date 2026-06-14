/**
 * Pushes locally-stored chat conversations up to the desktop when the PC is
 * reachable. The desktop surfaces them in its Notifications tab and offers
 * "Add to project" when a chat had no project / neural map selected.
 *
 * Dedup is handled desktop-side by mobileSessionId, so re-pushing is safe. We
 * additionally remember the last-synced signature per session to avoid
 * redundant network calls.
 */
import { loadChats } from "./chat-store";
import { trpcMutate } from "./trpc-fetch";
import { isServerConfigured, getNodeName } from "./server-config";
import { getConnectionState } from "./connection";

// session.id -> last synced message count (cheap change signal)
const lastSynced = new Map<string, number>();
let _inFlight = false;

export async function syncChatsToPc(): Promise<void> {
  if (_inFlight) return;
  if (!isServerConfigured() || !getConnectionState().online) return;

  _inFlight = true;
  try {
    const snapshot = await loadChats();
    if (!snapshot?.sessions?.length) return;
    const deviceName = getNodeName();

    for (const session of snapshot.sessions) {
      // Skip the empty starter session and unchanged sessions.
      const userTurns = session.messages.filter((m) => m.role === "user").length;
      if (userTurns === 0) continue;
      if (lastSynced.get(session.id) === session.messages.length) continue;

      try {
        await trpcMutate("mobileSync.push", {
          deviceName,
          mobileSessionId: session.id,
          title: session.title,
          messages: session.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
          neuralMapId: session.neuralMapId ?? null,
          projectId: null,
        });
        lastSynced.set(session.id, session.messages.length);
      } catch {
        // PC unreachable mid-sync — try again on the next online tick.
      }
    }
  } finally {
    _inFlight = false;
  }
}
