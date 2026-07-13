/**
 * kicadRouter — PCBWay quote/order path (wiring + HITL gate).
 *
 * The heavy deps are mocked so this runs without kicad-cli or the network
 * (the real kicad-cli DRC/export path lives in the skip-gated kicadRouter.test.ts;
 * the PCBWay HTTP shape is covered in pcbwayService.test.ts). This locks the
 * router-level contract that matters:
 *   - getQuote extracts board specs and quotes parametrically.
 *   - placeOrder is HITL-gated (deny → FORBIDDEN, no order), and on approval
 *     builds the real fabrication ZIP and submits it (proving TD-042 is closed:
 *     the ZIP bytes — not a path — reach submitOrder).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/security.js", async (importActual) => {
  const actual = await importActual<typeof import("../_core/security.js")>();
  return { ...actual, validatePath: vi.fn(async (p: string) => p) };
});

const boardSpecs = vi.hoisted(() => ({ extractBoardSpecs: vi.fn() }));
vi.mock("../core_services/services/kicadBoardSpecs.js", () => boardSpecs);

const pcbway = vi.hoisted(() => ({ getQuote: vi.fn(), submitOrder: vi.fn() }));
vi.mock("../core_services/services/PCBWayService.js", () => ({
  PCBWayService: { getInstance: () => pcbway },
}));

const hitl = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("../core_services/services/HITLApprovalService.js", () => ({
  HITLApprovalService: { getInstance: () => hitl },
}));

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext } from "./_helpers/trpcHarness.js";

const SPECS = { lengthMm: 30, widthMm: 20, layers: 2, outlineFound: true };
const SHIPPING = { name: "Ada", address: "1 Way", city: "London", country: "UK", zipCode: "EC1A" };

async function makeCaller() {
  const { db } = await createTestDb();
  const user = await seedUser(db);
  const buildFabricationPackage = vi.fn().mockResolvedValue({
    zip: Buffer.from("real-gerber-zip"),
    fileCount: 7,
  });
  const ctx = makeContext(user, db, { kicad: { buildFabricationPackage } });
  return { caller: appRouter.createCaller(ctx), buildFabricationPackage };
}

beforeEach(() => {
  boardSpecs.extractBoardSpecs.mockReset().mockResolvedValue(SPECS);
  pcbway.getQuote.mockReset();
  pcbway.submitOrder.mockReset();
  hitl.requestApproval.mockReset();
});

describe("kicad.getQuote", () => {
  it("extracts board specs and quotes parametrically", async () => {
    pcbway.getQuote.mockResolvedValue({ totalCost: 20, qty: 5, layers: 2 });
    const { caller } = await makeCaller();

    const quote = await caller.kicad.getQuote({ pcbPath: "board.kicad_pcb", qty: 5 });

    expect(boardSpecs.extractBoardSpecs).toHaveBeenCalledWith("board.kicad_pcb");
    expect(pcbway.getQuote).toHaveBeenCalledWith(SPECS, 5);
    expect(quote.totalCost).toBe(20);
  });
});

describe("kicad.placeOrder", () => {
  it("denies the order when HITL approval is refused — no submitOrder", async () => {
    hitl.requestApproval.mockResolvedValue(false);
    const { caller, buildFabricationPackage } = await makeCaller();

    await expect(
      caller.kicad.placeOrder({ pcbPath: "board.kicad_pcb", qty: 5, shippingAddress: SHIPPING }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(buildFabricationPackage).not.toHaveBeenCalled();
    expect(pcbway.submitOrder).not.toHaveBeenCalled();
  });

  it("on approval, builds the fabrication ZIP and submits the real bytes (not a path)", async () => {
    hitl.requestApproval.mockResolvedValue(true);
    pcbway.submitOrder.mockResolvedValue({ orderId: "PO-1", status: "ok", totalCost: 42, estimatedDelivery: "" });
    const { caller, buildFabricationPackage } = await makeCaller();

    const order = await caller.kicad.placeOrder({
      pcbPath: "board.kicad_pcb",
      qty: 5,
      shippingAddress: SHIPPING,
    });

    expect(buildFabricationPackage).toHaveBeenCalledWith("board.kicad_pcb");
    const submitArg = pcbway.submitOrder.mock.calls[0]![0];
    expect(submitArg.specs).toEqual(SPECS);
    expect(submitArg.qty).toBe(5);
    expect(submitArg.shippingAddress).toEqual(SHIPPING);
    // The archive bytes from buildFabricationPackage are what get submitted.
    expect(Buffer.isBuffer(submitArg.zip)).toBe(true);
    expect(submitArg.zip.toString()).toBe("real-gerber-zip");
    expect(order.orderId).toBe("PO-1");
  });
});
