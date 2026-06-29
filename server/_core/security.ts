import path from "path";
import fs from "fs/promises";
import net from "net";
import dns from "dns/promises";
import { PATHS } from "./paths.js";

/**
 * Security Utility for path validation
 */

// os.homedir() intentionally excluded — it is too broad on multi-user systems
// and would allow traversal to SSH keys, credentials, and sibling project dirs.
const ALLOWED_DIRECTORIES = [
  PATHS.data,
  PATHS.models,
  PATHS.exports,
  PATHS.projects,
];

/**
 * Validates that a path is within the allowed directories and does not contain traversal sequences.
 * 
 * @param userPath - The path provided by the user
 * @param baseDir - Optional root directory that the path MUST be within
 * @returns The resolved absolute path if valid
 * @throws Error if validation fails
 */
/**
 * Separator-aware containment check.
 *
 * A plain `startsWith` would treat `/data-evil` as being inside `/data`, allowing
 * a sibling-directory prefix bypass. A child path is only contained when it equals
 * the parent or sits beneath it across a real path separator.
 */
function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

export async function validatePath(userPath: string, baseDir?: string): Promise<string> {
  // 1. Resolve absolute path
  const absolutePath = path.resolve(process.cwd(), userPath);

  // 2. Ensure we check actual disk location (mitigates symlink injection)
  const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

  // 3. If baseDir is provided, the path MUST be within it
  if (baseDir) {
    const resolvedBase = path.resolve(process.cwd(), baseDir);
    const realBase = await fs.realpath(resolvedBase).catch(() => resolvedBase);

    if (!isWithin(realPath, realBase)) {
      throw new Error(`Security Violation: Path ${userPath} is outside of allowed base ${baseDir}.`);
    }
  }

  // 4. Check against global allowed directories
  const isAllowed = ALLOWED_DIRECTORIES.some(dir => isWithin(realPath, path.resolve(dir)));

  if (!isAllowed) {
    throw new Error(`Security Violation: Path ${userPath} is not in an allowed directory.`);
  }

  // 5. Explicitly block sensitive system directories even if they happen to be in home (unlikely)
  const sensitiveDirs = ['/etc', '/var/log', '/root', '/boot', '/sys', '/proc'];
  if (sensitiveDirs.some(dir => isWithin(realPath, dir))) {
     throw new Error(`Security Violation: Access to system directory ${realPath} is forbidden.`);
  }

  return realPath;
}

/**
 * Classifies an IP literal as one that outbound requests must never reach.
 *
 * Blocks link-local (incl. the cloud metadata endpoint `169.254.169.254`),
 * the unspecified address, and multicast. It deliberately does NOT block
 * loopback or RFC-1918 private ranges, because self-hosted services this app
 * legitimately talks to (e.g. a LAN Penpot at `192.168.x.x`) live there.
 */
function isBlockedOutboundIp(ip: string): boolean {
  const low = ip.toLowerCase();
  // IPv4-mapped IPv6 in dotted form (e.g. ::ffff:169.254.169.254).
  const mapped = low.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedOutboundIp(mapped[1]);
  // IPv4-mapped IPv6 in hex form (URL parsers normalize to e.g. ::ffff:a9fe:a9fe).
  const hexMapped = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isBlockedOutboundIp(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    );
  }

  if (net.isIPv4(ip)) {
    if (ip === "0.0.0.0") return true; // unspecified
    if (ip.startsWith("169.254.")) return true; // link-local + cloud metadata
    const firstOctet = Number(ip.split(".")[0]);
    if (firstOctet >= 224 && firstOctet <= 239) return true; // multicast
    return false;
  }

  // IPv6
  if (low === "::") return true; // unspecified
  if (low.startsWith("fe80") || low.startsWith("fec0")) return true; // link-local
  if (low.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * SSRF guard for user-configurable outbound URLs (e.g. a self-hosted service
 * endpoint). Requires http(s), blocks well-known metadata hostnames, and
 * resolves the host so a name that points at a link-local/metadata address is
 * rejected too (mitigates DNS rebinding at validation time).
 *
 * NOTE: callers should also fetch with `redirect: "error"` so a 3xx to an
 * internal host can't bypass this check after validation.
 *
 * @throws Error if the URL is not safe to request.
 */
export async function assertOutboundUrlAllowed(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Security Violation: invalid URL "${rawUrl}".`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Security Violation: only http(s) URLs are allowed (got "${parsed.protocol}").`,
    );
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Cloud metadata hostnames are never a legitimate target.
  if (["metadata.google.internal", "metadata"].includes(host.toLowerCase())) {
    throw new Error(`Security Violation: host "${host}" is not allowed.`);
  }

  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw new Error(`Security Violation: could not resolve host "${host}".`);
    }
  }

  for (const addr of addresses) {
    if (isBlockedOutboundIp(addr)) {
      throw new Error(
        `Security Violation: host "${host}" resolves to a blocked address (${addr}).`,
      );
    }
  }
}
