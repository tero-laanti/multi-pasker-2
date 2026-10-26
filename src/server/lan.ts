import os from 'node:os';

/** Adapter names that are never the LAN players connect over (VPNs, VMs, containers, WSL). */
const VIRTUAL =
  /(vethernet|wsl|hyper-v|virtualbox|vbox|vmware|vmnet|docker|^br-|^veth|virbr|^utun|^tun|^tap|^ppp|ipsec|^wg|wireguard|tailscale|zerotier|^zt|hamachi|^ham|npcap|loopback|^lo\d*$|^bridge|^awdl|^llw|^anpi|^gif|^stf|^ap\d|nordlynx|proton|openvpn|wintun|^feth|^vnic|bluetooth|^rmnet|^ipv6)/i;

const PHYSICAL = /^(en\d+|eth\d+|wlan\d+|wlp|wlo|enp|eno|wl|wi-?fi|wlan|ethernet|langaton|lähiverkko)/i;

export interface LanCandidate {
  name: string;
  address: string;
  score: number;
}

export function scoreAddress(name: string, address: string): number {
  if (VIRTUAL.test(name)) return -1;
  if (address.startsWith('169.254.') || address.startsWith('127.')) return -1;
  let score = 1;
  if (address.startsWith('192.168.')) score += 30;
  else if (address.startsWith('10.')) score += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 10;
  if (PHYSICAL.test(name)) score += 15;
  return score;
}

export function lanCandidates(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const score = scoreAddress(name, info.address);
      if (score > 0) out.push({ name, address: info.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The address printed in join URLs and QR codes: the override if given, else the best LAN guess. */
export function pickLanAddress(override?: string, ifaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  if (override && override.trim()) return override.trim();
  return lanCandidates(ifaces)[0]?.address ?? null;
}
