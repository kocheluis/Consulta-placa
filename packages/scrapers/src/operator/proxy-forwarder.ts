import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import type { ProxyConfig } from './proxy.js';

/**
 * FORWARDER local de proxy: mini-proxy HTTP en 127.0.0.1 SIN auth que reenvía todo al proxy
 * residencial upstream CON autenticación. El upstream puede ser:
 *  - **HTTP** (`http://…`): reenvía el CONNECT agregando `Proxy-Authorization: Basic`.
 *  - **SOCKS5** (`socks5://…`): habla el protocolo SOCKS5 (RFC 1928) con auth user/pass (RFC 1929)
 *    por el navegador. ⚠ Chromium NO soporta auth SOCKS5 — este túnel es la única vía. Además
 *    iProyal corta el CONNECT HTTP a puertos raros (p. ej. FISE :23308) pero su SOCKS5 puede
 *    dejarlos pasar → el mismo upstream por SOCKS5 alcanza destinos que por HTTP no.
 *
 * ¿Por qué existe? Chrome no acepta credenciales en `--proxy-server`, y la whitelist de iProyal
 * salía con país equivocado. Con este túnel, el navegador apunta a `--proxy-server=127.0.0.1:<port>`
 * (sin auth, loopback-only) y el forwarder pone la auth camino al upstream.
 *
 * Maneja CONNECT (https — el caso real) y requests HTTP planos (solo con upstream HTTP).
 * Escucha SOLO en 127.0.0.1 y con `unref()` → no expone nada ni bloquea el exit del proceso.
 */
export interface ProxyForwarder {
  /** Puerto local asignado (efímero): úsalo como `--proxy-server=127.0.0.1:<port>`. */
  port: number;
  close: () => Promise<void>;
}

/** Handshake SOCKS5 (greeting + auth user/pass + CONNECT dominio:puerto). Llama a `ready(resto)`
 *  cuando el túnel quedó establecido (resto = bytes de datos que llegaron pegados a la respuesta). */
function socks5Connect(
  upSocket: Socket,
  upstream: ProxyConfig,
  dstHost: string,
  dstPort: number,
  ready: (rest: Buffer) => void,
  fail: () => void,
): void {
  let stage: 'greeting' | 'auth' | 'connect' = 'greeting';
  let buf = Buffer.alloc(0);
  const sendConnect = (): void => {
    const host = Buffer.from(dstHost, 'utf8');
    upSocket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host,
      Buffer.from([(dstPort >> 8) & 0xff, dstPort & 0xff]),
    ]));
    stage = 'connect';
    buf = Buffer.alloc(0);
  };
  upSocket.write(Buffer.from([0x05, 0x02, 0x00, 0x02])); // métodos: sin-auth, user/pass
  const onData = (d: Buffer): void => {
    buf = Buffer.concat([buf, d]);
    if (stage === 'greeting') {
      if (buf.length < 2) return;
      const method = buf[1];
      buf = buf.subarray(2);
      if (method === 0x02) {
        const user = Buffer.from(upstream.username ?? '', 'utf8');
        const pass = Buffer.from(upstream.password ?? '', 'utf8');
        upSocket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
        stage = 'auth';
      } else if (method === 0x00) sendConnect();
      else fail(); // 0xFF = sin método aceptable
    } else if (stage === 'auth') {
      if (buf.length < 2) return;
      const ok = buf[1] === 0x00;
      buf = buf.subarray(2);
      if (!ok) return fail();
      sendConnect();
    } else {
      // Respuesta del CONNECT: VER STATUS RSV ATYP BND.ADDR BND.PORT (longitud según ATYP).
      if (buf.length < 4) return;
      if (buf[1] !== 0x00) return fail();
      const atyp = buf[3]!;
      const need = 4 + (atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : 1 + (buf[4] ?? 0)) + 2;
      if (buf.length < need) return;
      upSocket.off('data', onData); // el pipe toma el control desde aquí
      ready(buf.subarray(need));
    }
  };
  upSocket.on('data', onData);
}

export async function startProxyForwarder(upstream: ProxyConfig, listenPort = 0): Promise<ProxyForwarder> {
  const u = new URL(upstream.server); // http://host:port ó socks5://host:port
  const upHost = u.hostname;
  const upPort = Number(u.port || 80);
  const isSocks = /^socks/i.test(u.protocol);
  const auth = upstream.username
    ? `Basic ${Buffer.from(`${upstream.username}:${upstream.password ?? ''}`).toString('base64')}`
    : null;

  const server: Server = createServer();

  // CONNECT (túnel TLS): establece el túnel contra el upstream (HTTP CONNECT o SOCKS5) y empalma.
  server.on('connect', (req, clientSocket: Socket, head: Buffer) => {
    const [dstHost = '', dstPortRaw = ''] = String(req.url ?? '').split(':');
    const dstPort = Number(dstPortRaw || 443);
    const fail = (): void => { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); upSocket.destroy(); };
    const established = (rest: Buffer): void => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upSocket.write(head);
      if (rest.length) clientSocket.write(rest);
      upSocket.pipe(clientSocket);
      clientSocket.pipe(upSocket);
    };
    const upSocket: Socket = netConnect(upPort, upHost, () => {
      if (isSocks) { socks5Connect(upSocket, upstream, dstHost, dstPort, established, fail); return; }
      const lines = [`CONNECT ${req.url} HTTP/1.1`, `Host: ${req.url}`];
      if (auth) lines.push(`Proxy-Authorization: ${auth}`);
      upSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      let buf = Buffer.alloc(0);
      const onData = (d: Buffer): void => {
        buf = Buffer.concat([buf, d]);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        upSocket.off('data', onData);
        if (/^HTTP\/1\.[01] 200/.test(buf.subarray(0, idx).toString())) established(buf.subarray(idx + 4));
        else fail(); // upstream rechazó (407 auth, 403 puerto…)
      };
      upSocket.on('data', onData);
    });
    upSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upSocket.destroy());
  });

  // HTTP plano (absolute-form): solo con upstream HTTP (con SOCKS respondemos 501 — no aplica:
  // todas nuestras fuentes van por https/CONNECT).
  server.on('request', (req, res) => {
    if (isSocks) { res.statusCode = 501; res.end(); return; }
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

// ── Forwarders COMPARTIDOS del proceso ──────────────────────────────────────────────────────────
// UN túnel por upstream (HTTP y SOCKS5 son upstreams distintos) para todo el motor (ATU + GNV):
// se crean al primer uso y se reciclan si cambian las credenciales/el server.
const shared = new Map<string, ProxyForwarder>();

/** Devuelve `127.0.0.1:<port>` del forwarder compartido hacia `upstream` (lo crea si hace falta). */
export async function sharedForwarderArg(upstream: ProxyConfig, log?: (m: string) => void): Promise<string> {
  const key = `${upstream.server}|${upstream.username ?? ''}|${upstream.password ?? ''}`;
  let fwd = shared.get(key);
  if (!fwd) {
    fwd = await startProxyForwarder(upstream);
    shared.set(key, fwd);
    log?.(`forwarder local 127.0.0.1:${fwd.port} → ${upstream.server} (túnel con auth)`);
  }
  return `127.0.0.1:${fwd.port}`;
}
