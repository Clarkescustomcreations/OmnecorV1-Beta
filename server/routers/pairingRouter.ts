/**
 * @file server/routers/pairingRouter.ts
 * @description Desktop-side device pairing — generate a pairing code/QR for the
 * Omnecor HQ mobile app and manage paired devices. The phone redeems the code at
 * the public `POST /api/pair/redeem` route (see server/_core/index.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, nonDeviceProcedure } from "../_core/trpc.js";
import { PairingService } from "../_core/pairing.js";
import { primaryIPv4 } from "../_core/net-utils.js";
import { getBoundPort } from "../_core/runtime-info.js";

export const pairingRouter = router({
  /**
   * Generate (or replace) the active pairing code for the signed-in desktop user.
   * Returns the code plus the host/port the phone should connect to, so the
   * desktop can render a QR encoding everything the phone needs in one scan.
   */
  createCode: nonDeviceProcedure.mutation(async ({ ctx }) => {
    const { code, secret, expiresAt } = PairingService.createCode(ctx.user.openId, ctx.user.name ?? "");
    return {
      code,    // short, shown for manual entry
      secret,  // long, encoded in the QR (never displayed/typed)
      expiresAt,
      host: primaryIPv4() ?? null, // LAN IPv4; for remote use the Tailscale host
      port: getBoundPort(),
    };
  }),

  /** List the user's paired devices (name, method, when paired, last seen, revoked). */
  listDevices: protectedProcedure.query(async ({ ctx }) => {
    return { devices: await PairingService.listDevices(ctx.user.openId) };
  }),

  /** Revoke a paired device — its session tokens stop authenticating immediately. */
  revokeDevice: nonDeviceProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await PairingService.revokeDevice(ctx.user.openId, input.deviceId);
      return { revoked };
    }),

  /**
   * Enable/disable the remote PTY terminal for one of the operator's paired
   * devices. Granting a phone shell access to the PC is privileged, so it is
   * restricted to an admin/owner operator (never a plain user, and — via
   * nonDeviceProcedure — never a paired device toggling its own access). Audit
   * logged by the protected-procedure middleware.
   */
  setDeviceTerminal: nonDeviceProcedure
    .input(z.object({ deviceId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an admin or owner can change terminal access for a device.",
        });
      }
      const updated = await PairingService.setTerminalEnabled(
        ctx.user.openId,
        input.deviceId,
        input.enabled,
      );
      return { updated, enabled: input.enabled };
    }),
});
