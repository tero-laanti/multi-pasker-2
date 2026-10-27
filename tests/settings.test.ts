import { describe, expect, it } from 'vitest';
import { qualityFor } from '../src/client/settings';

describe('a first-timer’s quality', () => {
  it('comes from the graphics chip', () => {
    // Built-in graphics: Medium.
    expect(qualityFor('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(qualityFor('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(qualityFor('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)')).toBe('medium');
    expect(qualityFor('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(qualityFor('ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    // Graphics cards and Apple's chips: High.
    expect(qualityFor('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(qualityFor('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(qualityFor('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(qualityFor('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('high');
    expect(qualityFor('Apple GPU')).toBe('high');
    // Software rendering and phone chips: Low.
    expect(qualityFor('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('low');
    expect(qualityFor('Mali-G78')).toBe('low');
  });
});
