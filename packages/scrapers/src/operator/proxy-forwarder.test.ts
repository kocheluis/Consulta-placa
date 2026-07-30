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

  it('SOCKS5: hace el handshake con auth user/pass y empalma el túnel (eco end-to-end)', async () => {
    // Destino final: eco TCP.
    const target = netServer((s: Socket) => s.on('data', (d) => s.write(d)));
    const targetPort = await listen(target);
    closeAll.push(() => new Promise((r) => target.close(() => r())));

    // Upstream SOCKS5 de mentira: greeting → exige user/pass → CONNECT → conecta al destino.
    let seenUser = '', seenPass = '';
    const upstream = netServer((s: Socket) => {
      let stage = 0;
      s.on('data', (d) => {
        if (stage === 0) { // greeting [05, n, métodos…] → elegimos user/pass (0x02)
          stage = 1;
          s.write(Buffer.from([0x05, 0x02]));
        } else if (stage === 1) { // auth [01, ulen, user, plen, pass]
          const ulen = d[1]!;
          seenUser = d.subarray(2, 2 + ulen).toString();
          const plen = d[2 + ulen]!;
          seenPass = d.subarray(3 + ulen, 3 + ulen + plen).toString();
          stage = 2;
          s.write(Buffer.from([0x01, 0x00])); // auth OK
        } else if (stage === 2) { // CONNECT [05,01,00,03,dlen,dominio,portHi,portLo]
          const dlen = d[4]!;
          const host = d.subarray(5, 5 + dlen).toString();
          const port = d.readUInt16BE(5 + dlen);
          stage = 3;
          const out = connect(port, host, () => {
            s.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // OK + bind dummy
            out.pipe(s);
            s.pipe(out);
          });
        }
      });
    });
    const upstreamPort = await listen(upstream);
    closeAll.push(() => new Promise((r) => upstream.close(() => r())));

    const fwd = await startProxyForwarder({ server: `socks5://127.0.0.1:${upstreamPort}`, username: 'u_pe', password: 'cl:ave' });
    closeAll.push(() => fwd.close());

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
          c.write('hola-socks');
          return;
        }
        if (established && buf.includes('hola-socks')) { clearTimeout(timer); c.end(); resolve(buf); }
      });
      c.on('connect', () => c.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`));
      c.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    expect(echoed).toContain('hola-socks'); // túnel SOCKS5 end-to-end
    expect(seenUser).toBe('u_pe');
    expect(seenPass).toBe('cl:ave'); // password con ':' viaja intacta (SOCKS5 no la parsea por ':')
  });

  it('SOCKS5: si el upstream rechaza la auth, el cliente recibe 502 (no se cuelga)', async () => {
    const upstream = netServer((s: Socket) => {
      let stage = 0;
      s.on('data', () => {
        if (stage === 0) { stage = 1; s.write(Buffer.from([0x05, 0x02])); }
        else s.write(Buffer.from([0x01, 0x01])); // auth RECHAZADA
      });
    });
    const upstreamPort = await listen(upstream);
    closeAll.push(() => new Promise((r) => upstream.close(() => r())));

    const fwd = await startProxyForwarder({ server: `socks5://127.0.0.1:${upstreamPort}`, username: 'u', password: 'mala' });
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
