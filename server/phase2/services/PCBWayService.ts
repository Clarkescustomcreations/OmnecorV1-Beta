import { TRPCError } from "@trpc/server";
import { ENV } from "../../_core/env.js";
import { apiFetch } from "../../_core/apiClient.js";

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
    try {
      return await apiFetch<PCBWayQuote>(
        `${this.baseUrl}/order/GetQuote`,
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ partnerId: ENV.pcbwayPartnerId, gerberFile: gerberFilePath }),
          timeoutMs: 10_000,
        },
        { label: "PCBWay.getQuote" }
      );
    } catch (err) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
    }
  }

  async placeOrder(quoteId: string, shippingAddress: ShippingAddress): Promise<PCBWayOrder> {
    this.guardConfigured();
    try {
      return await apiFetch<PCBWayOrder>(
        `${this.baseUrl}/order/PlaceOrder`,
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId, shippingAddress }),
          timeoutMs: 10_000,
        },
        { label: "PCBWay.placeOrder" }
      );
    } catch (err) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
    }
  }

  async getOrderStatus(orderId: string): Promise<{ orderId: string; status: string; trackingNumber: string | null }> {
    this.guardConfigured();
    try {
      return await apiFetch<{ orderId: string; status: string; trackingNumber: string | null }>(
        `${this.baseUrl}/order/GetOrderStatus?orderId=${encodeURIComponent(orderId)}`,
        {
          headers: { "Authorization": `Bearer ${ENV.pcbwayApiKey}` },
          timeoutMs: 10_000,
        },
        { label: "PCBWay.getOrderStatus" }
      );
    } catch (err) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
    }
  }
}
