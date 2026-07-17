/**
 * Parseo de proxy para Playwright (headless) y para `--proxy-server` de Chrome (CDP).
 *
 * iProyal (residencial) da dos formas de auth:
 *  1. **user:pass** — funciona con Playwright (`chromium.launch({ proxy:{server,username,password} })`)
 *     pero NO con `--proxy-server` de Chrome (no acepta credenciales inline).
 *  2. **whitelist de IP** — agregas la IP del VPS en el panel de iProyal y conectas SIN credenciales
 *     (`host:port`). Funciona para AMBOS (Playwright y `--proxy-server` CDP). Es la vía recomendada
 *     para usar el proxy en TODO el motor (ATU/SUNARP van por CDP y necesitan esta forma).
 *
 * Formatos aceptados en la env:
 *  - `http://user:pass@host:port` · `socks5://host:port`   (URL completa)
 *  - `host:port:user:pass`                                  (export típico de iProyal)
 *  - `host:port`                                            (whitelist, sin credenciales)
 */
export interface ProxyConfig {
  /** Para Playwright `proxy.server` y para `--proxy-server` (si no hay credenciales). */
  server: string;
  username?: string;
  password?: string;
}

export function parseProxy(raw?: string | null): ProxyConfig | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;

  // Forma URL: scheme://[user:pass@]host:port
  if (/^[a-z0-9]+:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const cfg: ProxyConfig = { server: `${u.protocol}//${u.host}` };
      if (u.username) cfg.username = decodeURIComponent(u.username);
      if (u.password) cfg.password = decodeURIComponent(u.password);
      return cfg;
    } catch { /* cae al parseo por ':' */ }
  }

  // Forma con dos puntos: host:port[:user:pass]  (la contraseña puede traer ':' → se re-une)
  const parts = s.split(':');
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const [host, port, user, ...passRest] = parts;
    const cfg: ProxyConfig = { server: `http://${host}:${port}` };
    if (user) cfg.username = user;
    if (passRest.length) cfg.password = passRest.join(':');
    return cfg;
  }
  return undefined;
}

/** `host:port` sin credenciales, para `--proxy-server` de Chrome (CDP). Requiere whitelist de IP. */
export function proxyServerArg(cfg?: ProxyConfig): string | undefined {
  if (!cfg) return undefined;
  return cfg.server.replace(/^[a-z0-9]+:\/\//i, '');
}
