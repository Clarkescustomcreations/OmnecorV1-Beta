import { createTRPCReact } from "@trpc/react-query";
import {
  createTRPCProxyClient,
  httpBatchLink,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/_core/app-router";
import { getApiBaseUrl } from "@/constants/oauth";
import { getServerBaseUrl, getAuthedWsUrl } from "@/lib/_core/server-config";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Custom fetch to include credentials for cookie-based auth
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
      }),
    ],
  });
}

// ── Agentic chat stream client (WebSocket subscription) ──────────────────────
// The main Chat screen consumes `aiProvider.agentChatStream` — a real tRPC
// subscription — imperatively (not via a React hook), so it needs a *vanilla*
// proxy client with a WebSocket link (the React client's httpBatchLink can't do
// subscriptions). Subscriptions ride a `wsLink` to the PC's token-authed `/ws`;
// every other call on this client (resolveToolApproval, runCodeSnippet) rides
// the same superjson httpBatchLink the rest of the app uses.
//
// Built lazily and cached per base URL: no socket opens until a stream actually
// starts, and if the user points the app at a new PC IP the client transparently
// rebuilds (closing the stale socket) against the new host.

function buildAgentTrpc(base: string) {
  const wsUrl = base.replace(/^http/, "ws") + "/ws";
  const ws = createWSClient({
    // Resolve the token-authed URL at connect time — RN WebSockets can't attach
    // cookies, so the session token rides as `?token=`. Falls back to the bare
    // URL if no token is stored yet.
    url: async () => (await getAuthedWsUrl()) || wsUrl,
    // Keep the socket closed until a subscription needs it, and drop it shortly
    // after the last one ends so an idle chat screen holds no radio wake-lock.
    lazy: { enabled: true, closeMs: 10_000 },
  });
  const client = createTRPCProxyClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({ client: ws, transformer: superjson }),
        false: httpBatchLink({
          url: `${base}/api/trpc`,
          transformer: superjson,
          async headers() {
            const token = await Auth.getSessionToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      }),
    ],
  });
  return { client, ws };
}

type AgentTrpc = ReturnType<typeof buildAgentTrpc>["client"];

let _agent: { base: string; client: AgentTrpc; ws: ReturnType<typeof createWSClient> } | null = null;

/**
 * The lazily-built, base-URL-cached agentic tRPC client (WS subscriptions + HTTP
 * mutations against the desktop PC). Throws when no PC server is configured — the
 * caller routes to the on-device model path instead.
 */
export function getAgentTrpc(): AgentTrpc {
  const base = getServerBaseUrl();
  if (!base) throw new Error("No server configured");
  if (_agent && _agent.base === base) return _agent.client;
  _agent?.ws.close();
  const built = buildAgentTrpc(base);
  _agent = { base, client: built.client, ws: built.ws };
  return built.client;
}
