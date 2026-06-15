import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { hasPermission, type Role } from "../phase2/config/rbac.js";
import { createLogger } from "./logger.js";

const log = createLogger("trpc-audit");

const t = initTRPC.context<TrpcContext>().meta<{ cloud?: boolean }>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

function redactSensitiveData(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const redacted = { ...(obj as Record<string, unknown>) };
  const sensitiveKeys = ["password", "token", "secret", "key", "apiKey", "accessToken", "refreshToken"];
  for (const k of Object.keys(redacted)) {
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      redacted[k] = "[REDACTED]";
    } else if (typeof redacted[k] === "object") {
      redacted[k] = redactSensitiveData(redacted[k]);
    }
  }
  return redacted;
}

const auditMiddleware = t.middleware(async (opts) => {
  const { ctx, next, path } = opts;
  const result = await next();
  if (ctx.user) {
    // Fire-and-forget — never awaited so it can't block the response, but a
    // failure to persist a security audit event must NOT be silently dropped.
    AuditLogService.getInstance().log({
      eventType: "trpc_call",
      actorId: ctx.user.id,
      actorType: "user",
      procedure: path,
      args: redactSensitiveData((opts as { rawInput?: unknown }).rawInput) as Record<string, unknown> | null,
      result: result.ok ? null : { error: true },
      ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
      sessionId: null,
    }).catch((err: unknown) => {
      log.error(`Failed to persist audit log for procedure "${path}"`, err);
    });
  }
  return result;
});

export const protectedProcedure = t.procedure.use(requireUser).use(auditMiddleware);

const sovereignCheck = t.middleware(async (opts) => {
  const { ctx, meta, next, path } = opts;
  if (ctx.user?.executionMode === "sovereign" && meta?.cloud === true) {
    AuditLogService.getInstance().log({
      eventType: "sovereign_block",
      actorId: ctx.user.id,
      actorType: "user",
      procedure: path,
      args: null,
      result: { blocked: true, reason: "sovereign_mode" },
      ipAddress: ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null,
      sessionId: null,
    }).catch((err: unknown) => {
      log.error(`Failed to persist sovereign-block audit log for procedure "${path}"`, err);
    });
    throw new TRPCError({ code: "FORBIDDEN", message: "Sovereign mode: cloud calls are disabled." });
  }
  return next();
});

export const cloudProcedure = protectedProcedure.meta({ cloud: true }).use(sovereignCheck);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "owner")) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

export const ownerProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Owner-only operation." });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

export function requirePermission(resource: string, action: string) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated." });
    }
    const role = (ctx.user.role ?? "user") as Role;
    if (!hasPermission(role, resource, action)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Insufficient permissions: ${resource}:${action}` });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}
