import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import type { ProxyConfig } from './proxy.js';

/**
 * FORWARDER local de proxy: mini-proxy HTTP en 127.0.0.1 SIN auth que reenvía todo al proxy
 * residencial upstream CON `Proxy-Authorization` (Basic).
 *
 * ¿Por qué? Chrome NO acepta credenciales en `--proxy-server` (user:pass inline) — por eso las
 * fuentes CDP (ATU/SUNARP…) no podían usar el `ENGINE_PROXY` autenticado de iProyal y quedaba solo
 * la whitelist de IP (que en iProyal salía con país equivocado). Con este túnel, Chrome apunta a
 * `--proxy-server=127.0.0.1:<port>` (sin auth, loopback-only) y el forwarder agrega la auth camino
 * al upstream → cualquier fuente CDP puede salir por el proxy con credenciales (`_country-pe`).
 *
 * Maneja CONNECT (https — el caso real: ATU es https) y requests HTTP planos (absolute-form).
 * Escucha SOLO en 127.0.0.1 y con `unref()` → no expone nada afuera ni bloquea el exit del proceso.
 */
export interface ProxyForwarder {
  /** Puerto local asignado (efímero): úsalo como `--proxy-server=127.0.0.1:<port>`. */
  port: number;
  close: () => Promise<void>;
}

export async function startProxyForwarder(upstream: ProxyConfig, listenPort = 0): Promise<ProxyForwarder> {
  const u = new URL(upstream.server); // p. ej. http://geo.iproyal.com:12321
  const upHost = u.hostname;
  const upPort = Number(u.port || 80);
  const auth = upstream.username
    ? `Basic ${Buffer.from(`${upstream.username}:${upstream.password ?? ''}`).toString('base64')}`
    : null;

  const server: Server = createServer();

  // CONNECT (túnel TLS): reenvía el CONNECT al upstream con auth y, tras su "200", empalma los sockets.
  server.on('connect', (req, clientSocket: Socket, head: Buffer) => {
    const upSocket = netConnect(upPort, upHost, () => {
      const lines = [`CONNECT ${req.url} HTTP/1.1`, `Host: ${req.url}`];
      if (auth) lines.push(`Proxy-Authorization: ${auth}`);
      upSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let established = false;
    let buf = Buffer.alloc(0);
    upSocket.on('data', (d: Buffer) => {
      if (established) return; // ya empalmado: el pipe se encarga
      buf = Buffer.concat([buf, d]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const header = buf.subarray(0, idx).toString();
      const rest = buf.subarray(idx + 4);
      if (/^HTTP\/1\.[01] 200/.test(header)) {
        established = true;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upSocket.write(head);
        if (rest.length) clientSocket.write(rest);
        upSocket.pipe(clientSocket);
        clientSocket.pipe(upSocket);
      } else {
        // Upstream rechazó (407 auth, 403…): se lo contamos al cliente como 502 y cerramos.
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        upSocket.destroy();
      }
    });
    upSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upSocket.destroy());
  });

  // HTTP plano (absolute-form): reenvía la request al upstream agregando la auth.
  server.on('request', (req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    if (auth) headers['proxy-authorization'] = auth;
    const pr = httpRequest({ host: upHost, port: upPort, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    pr.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(pr);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });
  server.unref(); // no bloquea el exit de scripts CLI (probes)
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : listenPort;
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

// ── Forwarder COMPARTIDO del proceso ────────────────────────────────────────────────────────────
// UN solo túnel por upstream para todo el motor (ATU por CDP + fuentes ligeras GNV): se crea al
// primer uso y se recicla si cambia el ENGINE_PROXY. Los navegadores apuntan a 127.0.0.1:<port>.
let shared: ProxyForwarder | null = null;
let sharedKey = '';

/** Devuelve `127.0.0.1:<port>` del forwarder compartido hacia `upstream` (lo crea si hace falta). */
export async function sharedForwarderArg(upstream: ProxyConfig, log?: (m: string) => void): Promise<string> {
  const key = `${upstream.server}|${upstream.username ?? ''}`;
  if (!shared || sharedKey !== key) {
    if (shared) await shared.close().catch(() => {});
    shared = await startProxyForwarder(upstream);
    sharedKey = key;
    log?.(`forwarder local 127.0.0.1:${shared.port} → ${upstream.server} (túnel con auth)`);
  }
  return `127.0.0.1:${shared.port}`;
}
