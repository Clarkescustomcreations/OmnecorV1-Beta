import { EventEmitter } from "events";
import bonjour from "bonjour";
import type { Bonjour, Browser, Service, RemoteService } from "bonjour";
import { primaryIPv4, mdnsBindInterface, pickPeerAddress } from "../../_core/net-utils.js";

export interface MeshNode {
  id: string;
  name: string;
  address: string;
  port: number;
  capabilities: string[];
}

const MDNS_SERVICE_TYPE = "omnecor";
const ANNOUNCE_PORT = parseInt(process.env.PORT ?? "3000", 10);

export class MeshDiscoveryService extends EventEmitter {
  private static instance: MeshDiscoveryService | null = null;
  private nodes: Map<string, MeshNode> = new Map();
  private bjInstance: Bonjour | null = null;
  private browser: Browser | null = null;
  private service: Service | null = null;

  private constructor() {
    super();
    this.startMdns();
  }

  public static getInstance(): MeshDiscoveryService {
    if (!MeshDiscoveryService.instance) {
      MeshDiscoveryService.instance = new MeshDiscoveryService();
    }
    return MeshDiscoveryService.instance;
  }

  private startMdns(): void {
    // Bind mDNS multicast to the real LAN interface only on hosts with a
    // WSL/Hyper-V vEthernet adapter (else undefined → bind all, the safe
    // default that keeps multicast reception working alongside avahi on Linux).
    const ifaceIp = mdnsBindInterface();
    try {
      this.bjInstance = bonjour(ifaceIp ? { interface: ifaceIp } : undefined);
    } catch (err) {
      console.warn("[MeshDiscoveryService] bonjour init failed — mDNS disabled:", (err as Error).message);
      return;
    }

    const bj = this.bjInstance;
    const nodeName = process.env.OMNECOR_NODE_NAME ?? `omnecor-${this.localHostname()}`;

    try {
      this.service = bj.publish({
        name: nodeName,
        type: MDNS_SERVICE_TYPE,
        port: ANNOUNCE_PORT,
        txt: { version: "1", capabilities: "llm,tts,stt" },
      });
      console.info(`[MeshDiscoveryService] Advertising as "${nodeName}" on port ${ANNOUNCE_PORT}`);
    } catch (err) {
      console.warn("[MeshDiscoveryService] mDNS advertise failed:", (err as Error).message);
    }

    try {
      this.browser = bj.find({ type: MDNS_SERVICE_TYPE }, (svc) => {
        if (svc.name === nodeName) return;

        const address = pickPeerAddress(svc);
        const txt = (svc.txt ?? {}) as Record<string, string>;
        const node: MeshNode = {
          id: `${svc.name}@${address}:${svc.port}`,
          name: svc.name,
          address,
          port: svc.port,
          capabilities: (txt.capabilities ?? "").split(",").filter(Boolean),
        };

        this.nodes.set(node.id, node);
        this.emit("nodeDiscovered", node);
        console.info(`[MeshDiscoveryService] Discovered node: ${node.name} at ${address}:${node.port}`);
      });

      this.browser.on("down", (svc: RemoteService) => {
        const address = pickPeerAddress(svc);
        const id = `${svc.name}@${address}:${svc.port}`;
        const node = this.nodes.get(id);
        if (node) {
          this.nodes.delete(id);
          this.emit("nodeLost", node);
          console.info(`[MeshDiscoveryService] Node left: ${svc.name}`);
        }
      });
    } catch (err) {
      console.warn("[MeshDiscoveryService] mDNS browse failed:", (err as Error).message);
    }
  }

  getNodes(): MeshNode[] {
    return Array.from(this.nodes.values());
  }

  destroy(): void {
    try { this.browser?.stop(); } catch { /* ignore */ }
    try { this.service?.stop(); } catch { /* ignore */ }
    try { this.bjInstance?.destroy(); } catch { /* ignore */ }
    this.nodes.clear();
    MeshDiscoveryService.instance = null;
  }

  private localHostname(): string {
    const ip = primaryIPv4();
    return ip ? ip.replace(/\./g, "-") : "node";
  }
}
