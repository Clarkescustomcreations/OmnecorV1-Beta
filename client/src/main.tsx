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
import { App } from "./App";
import { getLoginUrl } from "./const";
import { FictionModeProvider } from "./contexts/FictionModeContext";
import { IS_DEMO } from "@/lib/demo";
import { authHeaders } from "@/lib/desktopAuth";
import { applyFontSize, getStoredFontSize } from "@/lib/fontSize";
import "./Globals.css";

// Apply the persisted base font size before first paint so the UI doesn't
// flash at the default size on reload.
applyFontSize(getStoredFontSize(), false);

// Dedupes a burst of concurrent/retried unauthorized errors so we navigate at
// most once. Without this, every failing query on a wiped/expired session fires
// its own redirect — and a hard reload to the same workspace re-issues the query,
// producing an infinite reload loop that strobes the screen.
let handlingUnauthorized = false;

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (error.message !== UNAUTHED_ERR_MSG) return;
  if (handlingUnauthorized) return;

  const target = getLoginUrl();

  // Local-first / desktop build: getLoginUrl() returns "/" when no external OAuth
  // portal is configured. Hard-redirecting to "/" just reloads the same workspace,
  // which re-issues the failing query → infinite reload loop (screen strobe). The
  // sign-in surface here is the in-app Setup Wizard, so navigate there CLIENT-SIDE
  // (history API, no reload → no flash) exactly once, and clear the stale
  // setup-complete flag so the route gate keeps the user on the wizard.
  if (target === "/" || target === "") {
    // Base-aware setup path: wouter's <Router base> is derived from BASE_URL, so
    // the raw history path must include the same base or the route won't match.
    const routerBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const setupPath = `${routerBase}/setup`;
    if (window.location.pathname === setupPath) return;
    handlingUnauthorized = true;
    try {
      localStorage.removeItem("omnecor:setup_complete");
    } catch { /* ignore storage errors */ }
    window.history.pushState(null, "", setupPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
    // Release the guard on the next tick so a later genuine session expiry can
    // still route the user back to sign-in.
    setTimeout(() => { handlingUnauthorized = false; }, 0);
    return;
  }

  handlingUnauthorized = true;
  window.location.href = target;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry an unauthorized request: it cannot succeed without a session,
      // and retrying just amplifies the failure storm. Other errors retry twice.
      retry: (failureCount, error) =>
        !(error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG) &&
        failureCount < 2,
    },
  },
  // Global safety net so no mutation can ever fail silently: any mutation
  // without its own onError handler surfaces the failure as a toast. Mutations
  // that do define onError keep full control (no double-toasting).
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      redirectToLoginIfUnauthorized(error);
      console.error("[API Mutation Error]", error);
      // Don't toast the "please login" redirect case — it's handled by navigation.
      if (!mutation.options.onError && !(error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG)) {
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
  // Electron desktop app: preload exposes the embedded backend base URL via
  // window.api.backendBase (e.g. "http://localhost:37291"). The page origin is
  // app://omnecor/ so window.location.host is unusable for API calls.
  const electronBase = (window as Window & { api?: { backendBase?: string } }).api?.backendBase;
  if (electronBase) {
    try {
      const u = new URL(electronBase);
      return { host: u.host, proto: u.protocol, wsProto: "ws:" };
    } catch { /* fall through */ }
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
              // Use absolute URL for Electron (app:// origin) and Capacitor
              // (remote host). Fall back to relative for normal web serving.
              const isElectron = !!(window as Window & { api?: { backendBase?: string } }).api?.backendBase;
              const capacitorHost =
                typeof window !== "undefined" &&
                localStorage.getItem("omnecor_server_ip");
              if (isElectron || (capacitorHost && capacitorHost !== "localhost")) {
                return `${proto}//${host}/api/trpc`;
              }
              return "/api/trpc";
            })(),
            transformer: superjson,
            headers: () => authHeaders(),
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
