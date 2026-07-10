/**
 * PCBWayService — real PCBWay partner-API integration for PCB fabrication.
 *
 * Endpoints follow PCBWay's published partner API at https://api-partner.pcbway.com:
 *   - POST /api/Pcb/PcbQuotation  — parametric price quote (board specs JSON; no
 *     Gerbers are uploaded for a quote — PCBWay prices from the parameters).
 *   - POST /api/Pcb/PcbOrder      — place an order; the Gerber/drill archive is
 *     attached as a multipart file alongside the board spec + shipping fields.
 *
 * The partner API is approval-gated (email anson@pcbway.com); the exact auth
 * handshake is provided on approval, so it is env-configurable:
 * PCBWAY_API_KEY + PCBWAY_API_AUTH_HEADER (default "Authorization" → Bearer).
 * Until a key is set, isConfigured() is false and the router surfaces a clear
 * PRECONDITION_FAILED rather than calling the API.
 */
import { TRPCError } from "@trpc/server";
import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";
import type { BoardSpecs } from "./kicadBoardSpecs.js";

const log = createLogger("PCBWayService");

export interface PCBWayQuote {
  totalCost: number;
  currency: string;
  estimatedDays: number;
  layers: number;
  lengthMm: number;
  widthMm: number;
  qty: number;
  /** Raw price items from PCBWay, passed through for transparency. */
  priceList: unknown[];
  shipping?: { cost: number; days: number };
}

export interface ShippingAddress {
  name: string;
  address: string;
  city: string;
  country: string;
  zipCode: string;
}

export interface PCBWayOrder {
  orderId: string;
  status: string;
  totalCost: number;
  estimatedDelivery: string;
}

type Json = Record<string, unknown>;

/** Standard 2-layer FR-4 prototype defaults; overridden by extracted board specs. */
const QUOTE_DEFAULTS = {
  BoardType: "Single PCB",
  DesignInPanel: 1,
  Material: "FR-4",
  FR4Tg: "TG130",
  Thickness: 1.6,
  MinTrackSpacing: "6/6mil",
  MinHoleSize: 0.3,
  SolderMask: "Green",
  Silkscreen: "White",
  SilkSides: 2,
  Goldfingers: "No",
  SurfaceFinish: "HASL",
  ViaProcess: "Tenting vias",
  FinishedCopper: "1 oz Cu",
  RemoveProductNo: "No",
} as const;

export class PCBWayService {
  private static instance: PCBWayService | null = null;
  static getInstance(): PCBWayService {
    if (!PCBWayService.instance) PCBWayService.instance = new PCBWayService();
    return PCBWayService.instance;
  }

  isConfigured(): boolean {
    return !!ENV.pcbwayApiKey;
  }

  private guardConfigured(): void {
    if (!this.isConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "PCBWay API key not configured. Set PCBWAY_API_KEY (partner approval required).",
      });
    }
  }

  /** Auth header(s). Default "Authorization: Bearer <key>"; configurable per partner onboarding. */
  private authHeaders(): Record<string, string> {
    const header = ENV.pcbwayApiAuthHeader || "Authorization";
    const value = header.toLowerCase() === "authorization" ? `Bearer ${ENV.pcbwayApiKey}` : ENV.pcbwayApiKey;
    return { [header]: value };
  }

  private buildQuotationRequest(specs: BoardSpecs, qty: number): Json {
    return {
      ...QUOTE_DEFAULTS,
      Length: specs.lengthMm,
      Width: specs.widthMm,
      Layers: specs.layers,
      Qty: qty,
      ...(ENV.pcbwayPartnerId ? { PartnerId: ENV.pcbwayPartnerId } : {}),
    };
  }

  /** Request a parametric quote for the given board specs and quantity. */
  async getQuote(specs: BoardSpecs, qty: number): Promise<PCBWayQuote> {
    this.guardConfigured();
    const body = this.buildQuotationRequest(specs, qty);
    let parsed: Json;
    try {
      const res = await fetch(`${ENV.pcbwayApiBase}/api/Pcb/PcbQuotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      parsed = text ? (JSON.parse(text) as Json) : {};
      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay quote HTTP ${res.status}: ${text.slice(0, 300)}` });
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay quote failed: ${(err as Error).message}` });
    }

    if (typeof parsed.Status === "string" && parsed.Status.toLowerCase() !== "ok") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `PCBWay: ${String(parsed.ErrorText ?? "quote rejected")}` });
    }

    const priceList = Array.isArray(parsed.priceList) ? (parsed.priceList as unknown[]) : [];
    const totalCost = this.sumPriceList(priceList);
    const shipping = this.parseShipping(parsed.Shipping);
    const estimatedDays =
      this.pickNumber(priceList[0] as Json | undefined, ["buildTime", "BuildTime", "days", "Days", "leadTime"]) ??
      shipping?.days ??
      0;

    return {
      totalCost,
      currency: "USD",
      estimatedDays,
      layers: specs.layers,
      lengthMm: specs.lengthMm,
      widthMm: specs.widthMm,
      qty,
      priceList,
      shipping,
    };
  }

  /**
   * Place a fabrication order: multipart-upload the Gerber/drill archive along
   * with the board spec + shipping fields. The archive is produced by
   * KiCadService.buildFabricationPackage (gerbers + drills → zip).
   */
  async submitOrder(params: {
    specs: BoardSpecs;
    qty: number;
    shippingAddress: ShippingAddress;
    zip: Buffer;
  }): Promise<PCBWayOrder> {
    this.guardConfigured();
    const { specs, qty, shippingAddress, zip } = params;

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(zip)], { type: "application/zip" }), "fabrication.zip");
    for (const [k, v] of Object.entries(this.buildQuotationRequest(specs, qty))) {
      form.append(k, String(v));
    }
    form.append("Name", shippingAddress.name);
    form.append("Address", shippingAddress.address);
    form.append("City", shippingAddress.city);
    form.append("Country", shippingAddress.country);
    form.append("Postalcode", shippingAddress.zipCode);

    let parsed: Json;
    try {
      // NOTE: do not set Content-Type — fetch derives the multipart boundary.
      const res = await fetch(`${ENV.pcbwayApiBase}/api/Pcb/PcbOrder`, {
        method: "POST",
        headers: { ...this.authHeaders() },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      parsed = text ? (JSON.parse(text) as Json) : {};
      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay order HTTP ${res.status}: ${text.slice(0, 300)}` });
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay order failed: ${(err as Error).message}` });
    }

    if (typeof parsed.Status === "string" && parsed.Status.toLowerCase() !== "ok") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `PCBWay: ${String(parsed.ErrorText ?? "order rejected")}` });
    }

    const orderId = String(parsed.OrderNo ?? parsed.orderId ?? parsed.OrderId ?? parsed.Code ?? "unknown");
    log.info("PCBWay order accepted", { orderId, qty });
    return {
      orderId,
      status: String(parsed.Status ?? "submitted"),
      totalCost: this.pickNumber(parsed, ["totalPrice", "TotalPrice", "amount"]) ?? 0,
      estimatedDelivery: String(parsed.estimatedDelivery ?? parsed.DeliveryDate ?? ""),
    };
  }

  // ── parse helpers (defensive — partner price-item shapes vary) ───────────────

  private pickNumber(obj: Json | undefined, keys: string[]): number | undefined {
    if (!obj) return undefined;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return undefined;
  }

  private sumPriceList(priceList: unknown[]): number {
    let total = 0;
    for (const item of priceList) {
      const price = this.pickNumber(item as Json, ["price", "Price", "totalPrice", "TotalPrice", "UnitPrice", "amount"]);
      if (price !== undefined) total += price;
    }
    return Math.round(total * 100) / 100;
  }

  private parseShipping(shipping: unknown): { cost: number; days: number } | undefined {
    if (!shipping || typeof shipping !== "object") return undefined;
    const s = shipping as Json;
    const cost = this.pickNumber(s, ["ShipCost", "shipCost", "cost"]) ?? 0;
    const days = this.pickNumber(s, ["ShipDays", "shipDays", "days"]) ?? 0;
    return { cost, days };
  }
}
