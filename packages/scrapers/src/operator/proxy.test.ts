import { describe, it, expect } from 'vitest';
import { parseProxy, proxyServerArg } from './proxy.js';

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
