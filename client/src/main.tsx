import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  httpBatchLink,
  TRPCClientError,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { toast } from "sonner";
import App from "./App";
import { getLoginUrl } from "./const";
import { FictionModeProvider } from "./contexts/FictionModeContext";
import { IS_DEMO } from "@/lib/demo";
import "./index.css";

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

const queryClient = new QueryClient({
  // Global safety net so no mutation can ever fail silently: any mutation
  // without its own onError handler surfaces the failure as a toast. Mutations
  // that do define onError keep full control (no double-toasting).
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      redirectToLoginIfUnauthorized(error);
      console.error("[API Mutation Error]", error);
      if (!mutation.options.onError) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message.length > 200 ? `${message.slice(0, 200)}…` : message);
      }
    },
  }),
});

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

function getServerBase(): { host: string; proto: string; wsProto: string } {
  if (typeof window === "undefined") {
    return { host: "localhost:3000", proto: "http:", wsProto: "ws:" };
  }
  // Capacitor thin-client: server runs on desktop, not on this origin
  const capacitorHost = localStorage.getItem("omnecor_server_ip");
  const capacitorPort = localStorage.getItem("omnecor_server_port") || "3000";
  if (capacitorHost && capacitorHost !== "localhost") {
    return { host: `${capacitorHost}:${capacitorPort}`, proto: "http:", wsProto: "ws:" };
  }
  const proto = window.location.protocol;
  const wsProto = proto === "https:" ? "wss:" : "ws:";
  return { host: window.location.host, proto, wsProto };
}

// In demo/static builds there is no backend — skip WebSocket entirely to
// prevent connection errors, and use a fetch that resolves to empty data.
const noopFetch: typeof fetch = () =>
  Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }));

const wsClient = IS_DEMO
  ? null
  : createWSClient({
      url: () => {
        const { host, wsProto } = getServerBase();
        return `${wsProto}//${host}/ws`;
      },
    });

const trpcClient = trpc.createClient({
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
          true: wsLink({ client: wsClient!, transformer: superjson }),
          false: httpBatchLink({
            url: (() => {
              const { host, proto } = getServerBase();
              const capacitorHost =
                typeof window !== "undefined" &&
                localStorage.getItem("omnecor_server_ip");
              if (capacitorHost && capacitorHost !== "localhost") {
                return `${proto}//${host}/api/trpc`;
              }
              return "/api/trpc";
            })(),
            transformer: superjson,
            fetch(input, init) {
              return globalThis.fetch(input, {
                ...(init ?? {}),
                credentials: "include",
              });
            },
          }),
        }),
      ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <FictionModeProvider>
        <App />
      </FictionModeProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
