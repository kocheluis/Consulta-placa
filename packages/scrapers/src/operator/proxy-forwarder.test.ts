import { describe, it, expect, afterEach } from 'vitest';
import { createServer as netServer, connect, type Server, type Socket } from 'node:net';
import { startProxyForwarder, type ProxyForwarder } from './proxy-forwarder.js';

/** Levanta un server TCP en un puerto efímero y devuelve el puerto. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
}
const closeAll: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of closeAll.splice(0)) await c(); });

describe('startProxyForwarder (túnel local con auth para Chrome CDP)', () => {
  it('CONNECT: agrega Proxy-Authorization al upstream y empalma el túnel (eco end-to-end)', async () => {
    // Destino final: eco TCP (simula el servidor al que Chrome se conecta vía CONNECT).
    const target = netServer((s: Socket) => s.on('data', (d) => s.write(d)));
    const targetPort = await listen(target);
    closeAll.push(() => new Promise((r) => target.close(() => r())));

    // Upstream "iProyal" de mentira: exige el header de auth, responde 200 y empalma al destino.
    let seenAuth = '';
    const upstream = netServer((s: Socket) => {
      s.once('data', (d) => {
        const txt = d.toString();
        seenAuth = /proxy-authorization:\s*(.+)/i.exec(txt)?.[1]?.trim() ?? '';
        const m = /^CONNECT\s+([^\s:]+):(\d+)/.exec(txt);
        if (!m || !seenAuth) { s.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
        const out = connect(Number(m[2]), m[1]!, () => {
          s.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          out.pipe(s);
          s.pipe(out);
        });
      });
    });
    const upstreamPort = await listen(upstream);
    closeAll.push(() => new Promise((r) => upstream.close(() => r())));

    const fwd: ProxyForwarder = await startProxyForwarder({
      server: `http://127.0.0.1:${upstreamPort}`, username: 'user_pe', password: 'cla:ve', // password con ':' (caso iProyal)
    });
    closeAll.push(() => fwd.close());

    // "Chrome": CONNECT al forwarder (SIN auth) → espera 200 → manda payload → espera el eco.
    const echoed = await new Promise<string>((resolve, reject) => {
      const c = connect(fwd.port, '127.0.0.1');
      const timer = setTimeout(() => { c.destroy(); reject(new Error('timeout')); }, 4000);
      let buf = '';
      let established = false;
      c.on('data', (d) => {
        buf += d.toString();
        if (!established && /HTTP\/1\.[01] 200/.test(buf) && buf.includes('\r\n\r\n')) {
          established = true;
          buf = '';
          c.write('hola-tunel');
          return;
        }
        if (established && buf.includes('hola-tunel')) { clearTimeout(timer); c.end(); resolve(buf); }
      });
      c.on('connect', () => c.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`));
      c.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    expect(echoed).toContain('hola-tunel'); // el túnel funciona end-to-end
    expect(seenAuth).toBe(`Basic ${Buffer.from('user_pe:cla:ve').toString('base64')}`); // auth inyectada
  });

  it('CONNECT: si el upstream rechaza (407), el cliente recibe 502 (no se cuelga)', async () => {
    const upstream = netServer((s: Socket) => { s.once('data', () => s.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')); });
    const upstreamPort = await listen(upstream);
    closeAll.push(() => new Promise((r) => upstream.close(() => r())));

    const fwd = await startProxyForwarder({ server: `http://127.0.0.1:${upstreamPort}` }); // sin creds
    closeAll.push(() => fwd.close());

    const reply = await new Promise<string>((resolve, reject) => {
      const c = connect(fwd.port, '127.0.0.1');
      const timer = setTimeout(() => { c.destroy(); reject(new Error('timeout')); }, 4000);
      let buf = '';
      c.on('data', (d) => { buf += d.toString(); });
      c.on('connect', () => c.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));
      c.on('close', () => { clearTimeout(timer); resolve(buf); });
      c.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    expect(reply).toContain('502');
  });
});
