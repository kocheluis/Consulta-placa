import { describe, it, expect } from 'vitest';
import { parseProxy, proxyServerArg, proxyForSource, proxySources } from './proxy.js';

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
