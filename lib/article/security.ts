import dns from "dns";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);

/**
 * Checks if a resolved IP address belongs to a private, loopback, multicast, or link-local range.
 */
export function isPrivateIp(ip: string): boolean {
  // Check IPv6
  if (ip.includes(":")) {
    const ipv6Lower = ip.toLowerCase();
    // Loopback ::1 or empty ::
    if (ipv6Lower === "::1" || ipv6Lower === "::") return true;
    // Link-local address starts with fe80:
    if (ipv6Lower.startsWith("fe80:")) return true;
    // Unique Local Address (ULA) starts with fc00: or fd00:
    if (ipv6Lower.startsWith("fc00:") || ipv6Lower.startsWith("fd00:")) return true;
    // Multicast starts with ff00:
    if (ipv6Lower.startsWith("ff00:")) return true;
    return false;
  }

  // Check IPv4
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return true; // invalid format is blocked
  }

  const [p0, p1, p2, p3] = parts;
  if (p0 === 127 || p0 === 0) return true; // Loopback (127.x.x.x) and Broadcast (0.x.x.x)
  if (p0 === 10) return true; // Private network 10.0.0.0/8
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true; // Private network 172.16.0.0/12
  if (p0 === 192 && p1 === 168) return true; // Private network 192.168.0.0/16
  if (p0 === 169 && p1 === 254) return true; // Link-local 169.254.0.0/16
  if (p0 >= 224) return true; // Multicast / Reserved / Local broadcast

  return false;
}

/**
 * Resolves a hostname to an IP address.
 */
export async function resolveHostname(hostname: string): Promise<string> {
  try {
    const lookupResult = await dnsLookup(hostname);
    return lookupResult.address;
  } catch (err) {
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }
}
