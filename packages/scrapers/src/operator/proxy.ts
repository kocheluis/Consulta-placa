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
  // Tolerante a placeholders pegados tal cual: quita <>, comillas y espacios de los bordes
  // (caso real: ENGINE_PROXY=<geo.iproyal.com:32325:user:pass> copiado CON los corchetes de la
  // instrucción → "Invalid URL" en el forwarder). Un password legítimo no termina en '>'.
  const s = (raw ?? '').trim().replace(/^[<'"]+|[>'"]+$/g, '').trim();
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

/**
 * Gate LEGADO de fuentes Playwright → `ENGINE_PROXY` (modo fijo, sin fallback). ⚠ Hoy ni ATU ni
 * las GNV lo usan: ATU tiene su cadena de egresos en `atu-cdp.ts` y FISE/Infogas la suya en
 * `operator/index.ts` (`gnvEgressChain`), ambas con fallback directo → túnel → proxy — poner esas
 * fuentes aquí es inocuo (se ignora). El gate queda para overrides puntuales de OTRAS fuentes
 * ligeras vía env `PROXY_SOURCES` (p. ej. si SAT/SBS empezaran a rechazar la IP del VPS).
 */
const DEFAULT_PROXY_SOURCES = 'fise-gnv,infogas-gnv';
export function proxySources(): Set<string> {
  return new Set((process.env.PROXY_SOURCES ?? DEFAULT_PROXY_SOURCES).split(',').map((s) => s.trim()).filter(Boolean));
}

/** Proxy compartido (`ENGINE_PROXY`) para una fuente, o undefined si la fuente no está en
 *  `PROXY_SOURCES` o no hay proxy configurado. Se evalúa al llamar (no al cargar el módulo). */
export function proxyForSource(sourceId: string): ProxyConfig | undefined {
  return proxySources().has(sourceId) ? parseProxy(process.env.ENGINE_PROXY) : undefined;
}
