/* eslint-disable no-console */
// Prueba de proxy residencial (iProyal) contra las páginas que fallan desde el VPS (datacenter).
//
// Uso (PC o VPS):
//   PROXY_URL='host:port:user:pass'  npx tsx packages/scrapers/src/probe-proxy.ts
//   # o whitelist de IP:  PROXY_URL='host:port'
//   # end-to-end (score v3 real):  PROXY_URL=... CAPSOLVER_API_KEY=... TEST_PLATE=ABC123 npx tsx ...
//
// Qué mide:
//  1) IP de salida directo vs proxy → confirma que el proxy es residencial y distinto del VPS.
//  2) Alcance de Infogas/FISE/ATU cargando la página (Infogas bloquea en la CARGA = Cloudflare;
//     FISE/ATU cargan igual, su problema es el SCORE del reCAPTCHA v3 que solo se ve al ENVIAR).
//  3) (opcional) FISE + Infogas END-TO-END por el proxy con CapSolver → la prueba real.
import { chromium, type Browser } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProxy } from './operator/proxy.js';

const OUT = 'validacion-fuentes/proxy-test';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const proxyRaw = process.env.PROXY_URL ?? process.env.ENGINE_PROXY ?? process.env.CDP_PROXY ?? process.env.ATU_PROXY ?? '';
const proxy = parseProxy(proxyRaw);

function launch(useProxy: boolean): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(useProxy && proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
  });
}

async function exitIp(useProxy: boolean): Promise<string> {
  const b = await launch(useProxy);
  try {
    const p = await (await b.newContext()).newPage();
    await p.goto('https://ipinfo.io/json', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const txt = await p.locator('body').innerText().catch(() => '');
    try { const j = JSON.parse(txt); return `${j.ip} · ${j.city ?? ''} ${j.region ?? ''} ${j.country ?? ''} · ${j.org ?? ''}`.replace(/\s+/g, ' ').trim(); }
    catch { return txt.slice(0, 140); }
  } catch (e) { return `ERROR ${(e as Error).message}`; }
  finally { await b.close().catch(() => {}); }
}

interface PageCheck { name: string; url: string; ok: string; }
const PAGES: PageCheck[] = [
  { name: 'Infogas', url: 'https://vh.infogas.com.pe/', ok: '#inp_ck_plate' },
  { name: 'FISE', url: 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio', ok: '#placaVehiculo' },
  { name: 'ATU', url: 'https://soluciones.atu.gob.pe/ConsultaVehiculo', ok: 'input' },
];

async function checkPage(b: Browser, c: PageCheck, tag: string): Promise<void> {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  let status = 0, blocked = false, okSel = false, err = '';
  try {
    const resp = await p.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp?.status() ?? 0;
    await wait(2500);
    const title = (await p.title().catch(() => '')) || '';
    const body = (await p.locator('body').innerText().catch(() => '')).slice(0, 4000);
    blocked = /just a moment|attention required|checking your browser|access denied|cf-browser|forbidden|verifica que eres/i.test(`${title} ${body}`);
    okSel = await p.locator(c.ok).first().isVisible().catch(() => false);
    await p.screenshot({ path: join(OUT, `${c.name}-${tag}.png`), fullPage: true }).catch(() => {});
  } catch (e) { err = (e as Error).message; }
  finally { await ctx.close().catch(() => {}); }
  const verdict = err ? 'ERROR' : blocked ? '⛔ BLOQUEADO' : okSel ? '✅ OK (form visible)' : (status === 200 ? '⚠ cargó sin form' : '⚠ dudoso');
  console.log(`     ${c.name.padEnd(9)} → ${verdict}   http ${status || '-'}${err ? ` · ${err.slice(0, 70)}` : ''}`);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  console.log('\n=== PRUEBA DE PROXY RESIDENCIAL (iProyal) ===\n');
  if (!proxyRaw) console.log('⚠ Sin proxy en env. Define PROXY_URL="host:port:user:pass" (o "host:port" si usas whitelist de IP).\n');
  else if (!proxy) console.log('⚠ No pude parsear el proxy (revisa el formato: host:port:user:pass o http://user:pass@host:port).\n');
  else console.log(`Proxy: ${proxy.server}${proxy.username ? ` · auth user:pass (user ${proxy.username.slice(0, 4)}…)` : ' · sin credenciales (whitelist de IP)'}\n`);

  console.log('1) IP de salida — debe cambiar y verse residencial vía proxy:');
  console.log(`     directo : ${await exitIp(false)}`);
  if (proxy) console.log(`     proxy   : ${await exitIp(true)}`);

  console.log(`\n2) Alcance de páginas (screenshots en ${OUT}/):`);
  const bDirect = await launch(false);
  console.log('   — DIRECTO (IP actual):');
  for (const c of PAGES) await checkPage(bDirect, c, 'directo');
  await bDirect.close().catch(() => {});
  if (proxy) {
    const bProxy = await launch(true);
    console.log('   — VÍA PROXY:');
    for (const c of PAGES) await checkPage(bProxy, c, 'proxy');
    await bProxy.close().catch(() => {});
  }
  console.log('\n   Nota: FISE y ATU CARGAN aun sin proxy — su bloqueo es el SCORE del reCAPTCHA v3 (solo se ve al');
  console.log('   ENVIAR). Infogas sí bloquea en la CARGA (Cloudflare): ahí directo⛔ vs proxy✅ es la prueba.');

  // 3) End-to-end real (FISE + Infogas con CapSolver, por el proxy).
  const capKey = process.env.CAPSOLVER_API_KEY ?? process.env.CAPTCHA_API_KEY ?? '';
  const testPlate = (process.env.TEST_PLATE ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (proxy && capKey && testPlate) {
    console.log(`\n3) END-TO-END vía proxy (placa ${testPlate}, con CapSolver) — la prueba real del score v3:`);
    const { createCaptchaSolver } = await import('./captcha/index.js');
    const { runFiseGnv, runInfogas } = await import('./operator/sources.js');
    const solver = createCaptchaSolver({ provider: 'capsolver', apiKey: capKey });
    const b = await launch(true);
    const ctx = await b.newContext({ ignoreHTTPSErrors: true });
    const runners: Array<[string, typeof runFiseGnv]> = [['FISE', runFiseGnv], ['Infogas', runInfogas]];
    for (const [name, fn] of runners) {
      const page = await ctx.newPage();
      try { const r = await fn(page, testPlate, solver, join(OUT, `e2e-${name}.png`)); console.log(`     ${name.padEnd(9)} → ${r.status} · ${r.summary} (${r.ms}ms)`); }
      catch (e) { console.log(`     ${name.padEnd(9)} → ERROR ${(e as Error).message}`); }
      finally { await page.close().catch(() => {}); }
    }
    await b.close().catch(() => {});
  } else {
    console.log('\n3) (End-to-end omitido) Para la prueba real de FISE/ATU/Infogas con envío:');
    console.log('   PROXY_URL=... CAPSOLVER_API_KEY=... TEST_PLATE=<placa a gas> npx tsx packages/scrapers/src/probe-proxy.ts');
  }
  console.log('');
  process.exit(0);
})();
