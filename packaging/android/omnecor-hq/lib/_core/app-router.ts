/**
 * Self-contained AppRouter type for the mobile tRPC React client.
 *
 * Why this exists
 * ---------------
 * Omnecor HQ is a *client* of the desktop Omnecor server — it never runs a
 * backend of its own. The desktop's real `AppRouter` (40+ routers) cannot be
 * imported here: the mobile tsconfig is stricter and would try to type-check
 * the entire server source tree (express, drizzle, node-only APIs), which
 * explodes. The old `server/` + `drizzle/` template scaffolding that used to
 * provide this type has been removed.
 *
 * At runtime every real PC call goes through the untyped HTTP helpers in
 * `trpc-fetch.ts` (`trpcQuery` / `trpcMutate`), so connection stability does
 * not depend on this type at all. This minimal router only exists to give the
 * mounted `trpc.Provider` (see `app/_layout.tsx`) a valid, self-contained
 * `AppRouter` shape with no server dependencies.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

// Transformer must match the client (`createTRPCClient` in trpc.ts) so the
// inferred router type lines up with the superjson-configured httpBatchLink.
const t = initTRPC.create({ transformer: superjson });

const appRouter = t.router({
  system: t.router({
    health: t.procedure.query(() => ({ ok: true })),
  }),
  auth: t.router({
    me: t.procedure.query(() => null as unknown),
    logout: t.procedure.mutation(() => ({ success: true as const })),
  }),
});

export type AppRouter = typeof appRouter;
