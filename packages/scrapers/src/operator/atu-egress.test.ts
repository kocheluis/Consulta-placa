import { describe, it, expect, afterEach } from 'vitest';
import { atuEgressChain } from './atu-cdp.js';

// La cadena lee el env AL LLAMAR → cada test setea/limpia sus variables.
const saved = { ep: process.env.ENGINE_PROXY, ap: process.env.ATU_PROXY, cp: process.env.CDP_PROXY };
afterEach(() => {
  for (const [k, v] of [['ENGINE_PROXY', saved.ep], ['ATU_PROXY', saved.ap], ['CDP_PROXY', saved.cp]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const clear = (): void => { delete process.env.ENGINE_PROXY; delete process.env.ATU_PROXY; delete process.env.CDP_PROXY; };

describe('atuEgressChain (directo → túnel ENGINE_PROXY → proxy explícito)', () => {
  it('sin env → solo directo (IP del VPS)', async () => {
    clear();
    const c = atuEgressChain();
    expect(c.map((e) => e.label)).toEqual(['directo (IP del VPS)']);
    expect(await c[0]!.proxy(() => {})).toBe(''); // '' = sin --proxy-server
  });

  it('ENGINE_PROXY con credenciales → 2º egreso es el túnel local (Chrome no acepta user:pass)', () => {
    clear();
    process.env.ENGINE_PROXY = 'geo.iproyal.com:12321:usuario:clave_country-pe';
    const c = atuEgressChain();
    expect(c).toHaveLength(2);
    expect(c[0]!.label).toContain('directo');
    expect(c[1]!.label).toContain('túnel local → http://geo.iproyal.com:12321');
  });

  it('ENGINE_PROXY whitelist (sin credenciales) → 2º egreso va directo a --proxy-server', async () => {
    clear();
    process.env.ENGINE_PROXY = 'geo.iproyal.com:12321';
    const c = atuEgressChain();
    expect(c).toHaveLength(2);
    expect(await c[1]!.proxy(() => {})).toBe('geo.iproyal.com:12321'); // sin túnel, no hay auth que inyectar
  });

  it('ATU_PROXY explícito va AL FINAL (última instancia, después del túnel)', () => {
    clear();
    process.env.ENGINE_PROXY = 'geo.iproyal.com:12321:u:p';
    process.env.ATU_PROXY = 'socks5://localhost:1080';
    const c = atuEgressChain();
    expect(c.map((e) => e.label)[0]).toContain('directo');
    expect(c[1]!.label).toContain('túnel');
    expect(c[2]!.label).toContain('socks5://localhost:1080');
  });
});
