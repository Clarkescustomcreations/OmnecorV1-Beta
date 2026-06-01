export interface IoCEntry {
  type: "ip" | "domain" | "hash" | "url";
  value: string;
  category: string;
  timestamp: string;
  threat_level?: number;
}

export class ThreatIntelService {
  private static instance: ThreatIntelService | null = null;

  static getInstance(): ThreatIntelService {
    if (!ThreatIntelService.instance) ThreatIntelService.instance = new ThreatIntelService();
    return ThreatIntelService.instance;
  }

  isConfigured(): boolean {
    return !!process.env.MISP_URL;
  }

  async getIoCFeed(): Promise<IoCEntry[]> {
    if (!this.isConfigured()) return [];
    try {
      const resp = await fetch(`${process.env.MISP_URL}/attributes/restSearch.json`, {
        method: "POST",
        headers: {
          "Authorization": process.env.MISP_AUTH_KEY ?? "",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ returnFormat: "json", limit: 100, to_ids: 1 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { response?: { Attribute?: Array<{ type: string; value: string; category: string; timestamp: string; threat_level_id?: number }> } };
      const attrs = data.response?.Attribute ?? [];
      return attrs.map(a => ({
        type: (["ip", "domain", "hash", "url"].includes(a.type) ? a.type : "domain") as IoCEntry["type"],
        value: a.value,
        category: a.category,
        timestamp: a.timestamp,
        threat_level: a.threat_level_id,
      }));
    } catch {
      return [];
    }
  }

  async checkIoC(value: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const feed = await this.getIoCFeed();
      return feed.some(entry => entry.value === value);
    } catch {
      return false;
    }
  }
}
