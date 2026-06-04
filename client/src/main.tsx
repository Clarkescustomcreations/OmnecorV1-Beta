import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  httpBatchLink,
  TRPCClientError,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { FictionModeProvider } from "./contexts/FictionModeContext";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
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

const wsClient = createWSClient({
  url: () => {
    const { host, wsProto } = getServerBase();
    return `${wsProto}//${host}/api/trpc`;
  },
});

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === "subscription",
      true: wsLink({ client: wsClient, transformer: superjson }),
      false: httpBatchLink({
        url: () => {
          const { host, proto } = getServerBase();
          // Relative URL works for web/desktop, absolute needed for Capacitor
          const capacitorHost = typeof window !== "undefined" && localStorage.getItem("omnecor_server_ip");
          if (capacitorHost && capacitorHost !== "localhost") {
            return `${proto}//${host}/api/trpc`;
          }
          return "/api/trpc";
        },
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
