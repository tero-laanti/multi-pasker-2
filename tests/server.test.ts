import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lanCandidates, pickLanAddress } from '../src/server/lan';
import { applyTuning } from '../src/server/tuningWriter';

const iface = (address: string) => [{ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }] as never;

describe('LAN address', () => {
  it('prefers the Wi-Fi address over VPN, VM and container adapters (macOS)', () => {
    const ifaces = {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      utun3: iface('10.8.0.2'),
      bridge100: iface('192.168.64.1'),
      en0: iface('192.168.1.20'),
      docker0: iface('172.17.0.1'),
    } as never;
    expect(pickLanAddress(undefined, ifaces)).toBe('192.168.1.20');
  });

  it('ignores Windows virtual adapters', () => {
    const ifaces = {
      'vEthernet (WSL)': iface('172.20.0.1'),
      'VirtualBox Host-Only Network': iface('192.168.56.1'),
      'VMware Network Adapter VMnet8': iface('192.168.200.1'),
      'Wi-Fi': iface('192.168.0.10'),
      Tailscale: iface('100.101.102.103'),
    } as never;
    expect(pickLanAddress(undefined, ifaces)).toBe('192.168.0.10');
    expect(lanCandidates(ifaces).map((c) => c.address)).toEqual(['192.168.0.10']);
  });

  it('honours an override and never returns loopback', () => {
    expect(pickLanAddress('10.0.0.5', {} as never)).toBe('10.0.0.5');
    expect(pickLanAddress(undefined, { lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] } as never)).toBeNull();
  });
});

describe('tuning writer', () => {
  const src = [
    'const X = 1;',
    '// TUNING-BEGIN',
    'export const TUNING = {',
    '  move: {',
    '    walkSpeed: 5.2,',
    '    // A comment line.',
    '    gravity: 18.5, // trailing',
    '  },',
    '  pistol: {',
    '    rpm: 400,',
    '  },',
    '};',
    '// TUNING-END',
    'const walkSpeed = 3;',
  ].join('\n');

  it('rewrites only changed known values and keeps comments', () => {
    const { text, changed } = applyTuning(src, { move: { walkSpeed: 6.05, gravity: 18.5 }, pistol: { rpm: 450, nope: 3 } } as never);
    expect(changed.sort()).toEqual(['move.walkSpeed', 'pistol.rpm']);
    expect(text).toContain('    walkSpeed: 6.05,');
    expect(text).toContain('    gravity: 18.5, // trailing');
    expect(text).toContain('    // A comment line.');
    expect(text).toContain('    rpm: 450,');
    expect(text).toContain('const walkSpeed = 3;');
  });

  it('round-trips the real config file without changes', () => {
    const file = path.resolve(__dirname, '../src/shared/config.ts');
    const real = fs.readFileSync(file, 'utf8');
    const { text, changed } = applyTuning(real, {});
    expect(changed).toEqual([]);
    expect(text).toBe(real);
  });
});
