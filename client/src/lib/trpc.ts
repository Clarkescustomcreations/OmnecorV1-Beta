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

const wsClient = IS_DEMO
  ? null
  : createWSClient({
      url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`,
    });

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
            url: "/api/trpc",
            transformer: superjson,
          }),
        }),
      ],
});
