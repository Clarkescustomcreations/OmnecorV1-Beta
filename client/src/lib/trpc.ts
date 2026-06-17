import { createTRPCReact } from "@trpc/react-query";
import {
  createTRPCProxyClient,
  httpBatchLink,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import type { AppRouter } from "../../../server/routers";
import superjson from "superjson";
import { IS_DEMO } from "./demo";
import { authHeaders } from "./desktopAuth";

export const trpc = createTRPCReact<AppRouter>();

// Demo/static builds have no backend. Creating the WebSocket client here (at
// module load) would immediately try to open wss://<host>/ws and log a failed
// connection in the console, so skip it and resolve HTTP calls to empty data.
const noopFetch: typeof fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );

// When running inside the Electron desktop app the page origin is app://omnecor/
// (not http://localhost) so relative URLs like /api/trpc don't resolve to the
// backend. The preload script exposes window.api.backendBase with the absolute
// URL of the embedded backend (e.g. http://localhost:37291).
const electronBase: string | undefined =
  typeof window !== "undefined"
    ? (window as Window & { api?: { backendBase?: string } }).api?.backendBase
    : undefined;

const apiBase = electronBase ?? "";
const wsBase = electronBase
  ? electronBase.replace(/^http/, "ws")
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

const wsClient = IS_DEMO
  ? null
  : createWSClient({ url: `${wsBase}/ws` });

export const vanillaTrpc = createTRPCProxyClient<AppRouter>({
  links: IS_DEMO
    ? [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch: noopFetch,
        }),
      ]
    : [
        splitLink({
          condition: op => op.type === "subscription",
          true: wsLink({
            client: wsClient!,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url: `${apiBase}/api/trpc`,
            transformer: superjson,
            headers: () => authHeaders(),
          }),
        }),
      ],
});
