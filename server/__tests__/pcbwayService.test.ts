/**
 * PCBWayService — real partner-API integration (mocked fetch).
 *
 * Proves the quote/order path sends the *right* data — directly refuting the
 * old TD-042 concern ("sends a file-PATH string, not real Gerbers"):
 *   - getQuote posts parametric board specs (PCBWay prices from parameters; no
 *     Gerbers are needed for a quote) to /api/Pcb/PcbQuotation.
 *   - submitOrder multipart-uploads the real Gerber/drill ZIP *bytes* to
 *     /api/Pcb/PcbOrder alongside the spec + shipping fields.
 *
 * ENV is mocked (a mutable object) so the configured/unconfigured gate and the
 * base URL / auth header are controllable per-test; global fetch is stubbed so
 * no network call is made and the request shape can be asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BoardSpecs } from "../core_services/services/kicadBoardSpecs.js";

const env = vi.hoisted(() => ({
  pcbwayApiKey: "test-key",
  pcbwayPartnerId: "",
  pcbwayApiBase: "https://pcbway.test",
  pcbwayApiAuthHeader: "Authorization",
}));
vi.mock("../_core/env.js", () => ({ ENV: env }));

import { PCBWayService } from "../core_services/services/PCBWayService.js";

const SPECS: BoardSpecs = { lengthMm: 30, widthMm: 20, layers: 2, outlineFound: true };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  env.pcbwayApiKey = "test-key";
  env.pcbwayPartnerId = "";
  env.pcbwayApiBase = "https://pcbway.test";
  env.pcbwayApiAuthHeader = "Authorization";
  (PCBWayService as any).instance = null;
});

// ── getQuote (parametric — no Gerbers) ────────────────────────────────────────

describe("PCBWayService.getQuote", () => {
  it("throws PRECONDITION_FAILED when no API key is configured (fails cleanly, no call)", async () => {
    env.pcbwayApiKey = "";
    await expect(PCBWayService.getInstance().getQuote(SPECS, 5)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts parametric board specs (dimensions + layers + qty) to the quotation endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ Status: "ok", priceList: [{ price: 12.5 }, { price: 7.25 }], Shipping: { ShipCost: 4, ShipDays: 9 } }),
    );

    const quote = await PCBWayService.getInstance().getQuote(SPECS, 10);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://pcbway.test/api/Pcb/PcbQuotation");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    // The board is described by its parameters — NOT a file path.
    expect(body.Length).toBe(30);
    expect(body.Width).toBe(20);
    expect(body.Layers).toBe(2);
    expect(body.Qty).toBe(10);
    expect(body.Material).toBe("FR-4"); // a QUOTE_DEFAULT is merged in
    expect(JSON.stringify(body)).not.toContain(".kicad_pcb"); // no path leaked

    expect(quote.totalCost).toBe(19.75); // 12.5 + 7.25
    expect(quote.shipping).toEqual({ cost: 4, days: 9 });
    expect(quote.qty).toBe(10);
    expect(quote.layers).toBe(2);
  });

  it("includes PartnerId only when configured", async () => {
    env.pcbwayPartnerId = "partner-99";
    fetchMock.mockResolvedValue(jsonResponse({ Status: "ok", priceList: [] }));
    await PCBWayService.getInstance().getQuote(SPECS, 5);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.PartnerId).toBe("partner-99");
  });

  it("maps a non-2xx response to INTERNAL_SERVER_ERROR", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(PCBWayService.getInstance().getQuote(SPECS, 5)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("maps a PCBWay Status!=ok payload to BAD_REQUEST with the error text", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: "error", ErrorText: "invalid layer count" }));
    await expect(PCBWayService.getInstance().getQuote(SPECS, 5)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("invalid layer count"),
    });
  });
});

// ── submitOrder (real Gerber/drill ZIP, multipart) ────────────────────────────

describe("PCBWayService.submitOrder", () => {
  const zip = Buffer.from("PK real gerber archive bytes");
  const shippingAddress = {
    name: "Ada Lovelace",
    address: "1 Analytical Way",
    city: "London",
    country: "UK",
    zipCode: "EC1A",
  };

  it("throws PRECONDITION_FAILED when no API key is configured", async () => {
    env.pcbwayApiKey = "";
    await expect(
      PCBWayService.getInstance().submitOrder({ specs: SPECS, qty: 5, shippingAddress, zip }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("multipart-uploads the real ZIP bytes plus spec + shipping fields to the order endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: "ok", OrderNo: "PO-12345", totalPrice: 42 }));

    const order = await PCBWayService.getInstance().submitOrder({
      specs: SPECS,
      qty: 5,
      shippingAddress,
      zip,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://pcbway.test/api/Pcb/PcbOrder");
    // Must NOT set Content-Type — fetch derives the multipart boundary itself.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");

    const form = init.body as FormData;
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    // The real archive bytes are uploaded — not a path string.
    expect((file as Blob).size).toBe(zip.length);
    expect((file as Blob).type).toBe("application/zip");
    // Board spec + shipping travel alongside the file.
    expect(form.get("Layers")).toBe("2");
    expect(form.get("Qty")).toBe("5");
    expect(form.get("Name")).toBe("Ada Lovelace");
    expect(form.get("Country")).toBe("UK");
    expect(form.get("Postalcode")).toBe("EC1A");

    expect(order.orderId).toBe("PO-12345");
    expect(order.totalCost).toBe(42);
  });

  it("maps a rejected order (Status!=ok) to BAD_REQUEST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: "error", ErrorText: "out of capacity" }));
    await expect(
      PCBWayService.getInstance().submitOrder({ specs: SPECS, qty: 5, shippingAddress, zip }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("out of capacity") });
  });
});
