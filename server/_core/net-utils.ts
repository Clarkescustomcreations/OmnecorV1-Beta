// server/_core/net-utils.ts
//
// Shared networking helpers for OMMESH mDNS discovery.
//
// Two failure modes observed during 3-way LAN testing (Windows + Linux + phone)
// are fixed here so every discovery layer behaves identically:
//
//  1. Peers resolved to an IPv6 link-local address (fe80::…) instead of their
//     routable IPv4. multicast-dns returns every A/AAAA record it resolved and
//     the link-local AAAA frequently sorts first, leaving an unusable address.
//  2. On hosts with virtual adapters (WSL/Hyper-V/Docker), multicast-dns binds
//     its multicast socket to the wrong NIC (e.g. the WSL vEthernet 172.x), so
//     the node's announcements never reach the real LAN.

import { networkInterfaces } from "os";
import { isIPv4 } from "net";

// Interface names belonging to virtualization / WSL / containers. These must
// not be used as the node's primary LAN address or as the mDNS egress
// interface — they otherwise hijack multicast on Windows dev boxes.
const VIRTUAL_IFACE = /vethernet|wsl|docker|virtualbox|vmware|hyper-?v|loopback|veth|br-|tap/i;

/**
 * Pick the host's primary routable IPv4 LAN address.
 *
 * Skips internal, link-local (169.254.x) and virtual-adapter interfaces, then
 * prefers a common private-LAN range (192.168/10) over anything left over
 * (e.g. a stray 172.x). Returns undefined when no LAN address can be found, in
 * which case callers should fall back to binding all interfaces.
 */
export function primaryIPv4(): string | undefined {
  const nets = networkInterfaces();
  const candidates: string[] = [];

  for (const [name, ifaces] of Object.entries(nets)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const iface of ifaces ?? []) {
      if (
        !iface.internal &&
        iface.family === "IPv4" &&
        !iface.address.startsWith("169.254.")
      ) {
        candidates.push(iface.address);
      }
    }
  }

  return (
    candidates.find((a) => a.startsWith("192.168.") || a.startsWith("10.")) ??
    candidates[0]
  );
}

/**
 * Decide which interface IP to bind the mDNS multicast socket to.
 *
 * The WSL/Hyper-V vEthernet adapter hijacks multicast egress so a node becomes
 * undiscoverable to the LAN — but that failure mode is Windows-specific, so we
 * only force-bind the real LAN interface there. On Linux/macOS, binding to a
 * specific unicast interface IP can instead *break* multicast reception (e.g.
 * alongside avahi-daemon, and Linux hosts routinely have docker0/veth/br-
 * adapters), so we return undefined → bind all interfaces, the safe default.
 */
export function mdnsBindInterface(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return primaryIPv4();
}

/**
 * Choose the best routable address for a discovered mDNS peer.
 *
 * Prefers a real IPv4 from the resolved address list, then the source IP of the
 * mDNS response packet (`referer`), then the host name — never blindly the
 * first address, which is often an unusable fe80:: link-local.
 */
export function pickPeerAddress(service: {
  addresses?: string[];
  referer?: { address?: string };
  host?: string;
}): string {
  const addrs = Array.isArray(service.addresses) ? service.addresses : [];
  const ipv4 = addrs.find((a) => isIPv4(a));
  if (ipv4) return ipv4;

  const referer = service.referer?.address;
  if (referer && isIPv4(referer)) return referer;

  return addrs[0] ?? service.host ?? "unknown";
}
