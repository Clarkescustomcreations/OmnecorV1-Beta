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

export const trpc = createTRPCReact<AppRouter>();

const wsClient = createWSClient({
  url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`,
});

export const vanillaTrpc = createTRPCProxyClient<AppRouter>({
  links: [
    splitLink({
      condition: op => op.type === "subscription",
      true: wsLink({
        client: wsClient,
        transformer: superjson,
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
      }),
    }),
  ],
});
