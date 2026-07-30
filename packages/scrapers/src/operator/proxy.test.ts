import { describe, it, expect } from 'vitest';
import { parseProxy, proxyServerArg, proxyForSource, proxySources, withStickySession } from './proxy.js';

describe('parseProxy (formatos de iProyal)', () => {
  it('host:port:user:pass (export típico)', () => {
    expect(parseProxy('geo.iproyal.com:12321:usuario:clave_secreta')).toEqual({
      server: 'http://geo.iproyal.com:12321', username: 'usuario', password: 'clave_secreta',
    });
  });

  it('host:port (whitelist de IP, sin credenciales)', () => {
    expect(parseProxy('geo.iproyal.com:12321')).toEqual({ server: 'http://geo.iproyal.com:12321' });
  });

  it('URL completa http://user:pass@host:port', () => {
    expect(parseProxy('http://usuario:clave@geo.iproyal.com:12321')).toEqual({
      server: 'http://geo.iproyal.com:12321', username: 'usuario', password: 'clave',
    });
  });

  it('socks5 conserva el esquema', () => {
    expect(parseProxy('socks5://host:1080')?.server).toBe('socks5://host:1080');
  });

  it('contraseña con ":" se re-une', () => {
    expect(parseProxy('h:1:u:a:b:c')?.password).toBe('a:b:c');
  });

  it('vacío/indefinido → undefined', () => {
    expect(parseProxy('')).toBeUndefined();
    expect(parseProxy(null)).toBeUndefined();
    expect(parseProxy(undefined)).toBeUndefined();
  });

  it('tolera placeholders pegados con <> o comillas en los bordes (caso real del VPS)', () => {
    expect(parseProxy('<geo.iproyal.com:32325:usuario:clave_country-pe>')).toEqual({
      server: 'http://geo.iproyal.com:32325', username: 'usuario', password: 'clave_country-pe',
    });
    expect(parseProxy('"geo.iproyal.com:12321"')).toEqual({ server: 'http://geo.iproyal.com:12321' });
    expect(parseProxy('<>')).toBeUndefined();
  });

  it('proxyServerArg quita el esquema (para --proxy-server de Chrome)', () => {
    expect(proxyServerArg(parseProxy('http://u:p@host:8080'))).toBe('host:8080');
    expect(proxyServerArg(undefined)).toBeUndefined();
  });
});

describe('proxyForSource (gate PROXY_SOURCES + ENGINE_PROXY)', () => {
  const saved = { ep: process.env.ENGINE_PROXY, ps: process.env.PROXY_SOURCES };
  const restore = (): void => {
    if (saved.ep === undefined) delete process.env.ENGINE_PROXY; else process.env.ENGINE_PROXY = saved.ep;
    if (saved.ps === undefined) delete process.env.PROXY_SOURCES; else process.env.PROXY_SOURCES = saved.ps;
  };

  it('fise/infogas entran por defecto; atu y el resto salen directo (v3 de ATU pasa nativo del VPS)', () => {
    process.env.ENGINE_PROXY = 'geo.iproyal.com:12321:usuario:clave';
    delete process.env.PROXY_SOURCES;
    expect([...proxySources()].sort()).toEqual(['fise-gnv', 'infogas-gnv']);
    expect(proxyForSource('fise-gnv')?.server).toBe('http://geo.iproyal.com:12321');
    expect(proxyForSource('fise-gnv')?.username).toBe('usuario');
    expect(proxyForSource('atu')).toBeUndefined(); // opt-in (proxy cobra por datos y ATU no lo necesita)
    expect(proxyForSource('sunarp')).toBeUndefined();
    restore();
  });

  it('PROXY_SOURCES explícito reemplaza el default (mete a atu si se pide)', () => {
    process.env.ENGINE_PROXY = 'geo.iproyal.com:12321';
    process.env.PROXY_SOURCES = 'fise-gnv,infogas-gnv,atu';
    expect(proxyForSource('atu')?.server).toBe('http://geo.iproyal.com:12321');
    expect(proxyForSource('sbs-soat')).toBeUndefined();
    restore();
  });

  it('sin ENGINE_PROXY → undefined aunque la fuente esté en el gate', () => {
    delete process.env.ENGINE_PROXY;
    delete process.env.PROXY_SOURCES;
    expect(proxyForSource('atu')).toBeUndefined();
    restore();
  });
});

describe('withStickySession (fija la IP de salida de iProyal)', () => {
  it('password estilo iProyal (_country-) → agrega _session-<id>_lifetime-30m', () => {
    const s = withStickySession({ server: 'http://geo.iproyal.com:32325', username: 'u', password: 'clave_country-pe' });
    expect(s.password).toMatch(/^clave_country-pe_session-[a-z0-9]+_lifetime-30m$/);
    // Mismo proceso → mismo id (todas las fuentes comparten UNA IP de salida).
    const s2 = withStickySession({ server: 'http://geo.iproyal.com:32325', username: 'u', password: 'otra_country-pe' });
    expect(s2.password!.split('_session-')[1]).toBe(s.password!.split('_session-')[1]);
  });

  it('ya sticky o sin formato iProyal → tal cual (no doble-sesión, no romper otros proveedores)', () => {
    const ya = { server: 'http://h:1', username: 'u', password: 'p_country-pe_session-abc_lifetime-10m' };
    expect(withStickySession(ya)).toEqual(ya);
    const otro = { server: 'http://h:1', username: 'u', password: 'clave-simple' };
    expect(withStickySession(otro)).toEqual(otro);
  });
});
