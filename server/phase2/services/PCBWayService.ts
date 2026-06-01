import { TRPCError } from "@trpc/server";
import { ENV } from "../../_core/env.js";

export interface PCBWayQuote {
  quoteId: string;
  totalCost: number;
  currency: string;
  estimatedDays: number;
  layers: number;
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

export class PCBWayService {
  private static instance: PCBWayService | null = null;
  private readonly baseUrl = "https://api.pcbway.com/api";

  static getInstance(): PCBWayService {
    if (!PCBWayService.instance) PCBWayService.instance = new PCBWayService();
    return PCBWayService.instance;
  }

  isConfigured(): boolean {
    return !!ENV.pcbwayApiKey;
  }

  private guardConfigured(): void {
    if (!this.isConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PCBWay API key not configured. Set PCBWAY_API_KEY." });
    }
  }

  async getQuote(gerberFilePath: string): Promise<PCBWayQuote> {
    this.guardConfigured();
    const resp = await fetch(`${this.baseUrl}/order/GetQuote`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: ENV.pcbwayPartnerId, gerberFile: gerberFilePath }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay API error: ${resp.status}` });
    return resp.json() as Promise<PCBWayQuote>;
  }

  async placeOrder(quoteId: string, shippingAddress: ShippingAddress): Promise<PCBWayOrder> {
    this.guardConfigured();
    const resp = await fetch(`${this.baseUrl}/order/PlaceOrder`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId, shippingAddress }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay API error: ${resp.status}` });
    return resp.json() as Promise<PCBWayOrder>;
  }

  async getOrderStatus(orderId: string): Promise<{ orderId: string; status: string; trackingNumber: string | null }> {
    this.guardConfigured();
    const resp = await fetch(`${this.baseUrl}/order/GetOrderStatus?orderId=${encodeURIComponent(orderId)}`, {
      headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PCBWay API error: ${resp.status}` });
    return resp.json() as Promise<{ orderId: string; status: string; trackingNumber: string | null }>;
  }
}
