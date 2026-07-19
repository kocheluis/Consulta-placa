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

interface PageCheck { name: string; url: string; ok: string; grupo: string; }
// Todas las fuentes en uso. `grupo` marca cuáles DEBEN ir directo (IP peruana del VPS) vs las
// candidatas a proxy (anti-bot). Superbid no está: es un lookup en la DB local, no toca la red.
const PAGES: PageCheck[] = [
  // Directas — deberían pasar por la IP peruana del VPS (NO proxy):
  { name: 'SUNARP', grupo: 'directa', url: 'https://consultavehicular.sunarp.gob.pe/', ok: 'input' },
  { name: 'SPRL', grupo: 'directa', url: 'https://sprl.sunarp.gob.pe/', ok: 'input,button,a' },
  { name: 'SIGM', grupo: 'directa', url: 'https://sigm.sunarp.gob.pe/garantias-mobiliarias/inicio', ok: 'input,button' },
  { name: 'SAT-pap', grupo: 'directa', url: 'https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx', ok: 'body' },
  { name: 'SAT-capt', grupo: 'directa', url: 'https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx', ok: '#ctl00_cplPrincipal_txtPlaca' },
  { name: 'Callao', grupo: 'directa', url: 'https://pagopapeletascallao.pe/', ok: '#valor_busqueda' },
  { name: 'MTC-CITV', grupo: 'directa', url: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv', ok: '#selBUS_Filtro' },
  { name: 'APESEG', grupo: 'directa', url: 'https://www.soat.com.pe/servicios-soat/', ok: 'iframe' },
  { name: 'SBS', grupo: 'directa', url: 'https://servicios.sbs.gob.pe/reportesoat/', ok: '#ctl00_MainBodyContent_txtPlaca' },
  // Anti-bot — candidatas a salir por el proxy residencial:
  { name: 'ATU', grupo: 'proxy', url: 'https://soluciones.atu.gob.pe/ConsultaVehiculo', ok: 'input' },
  { name: 'FISE', grupo: 'proxy', url: 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio', ok: '#placaVehiculo' },
  { name: 'Infogas', grupo: 'proxy', url: 'https://vh.infogas.com.pe/', ok: '#inp_ck_plate' },
];

async function checkPage(b: Browser, c: PageCheck, tag: string): Promise<void> {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  let status = 0, blocked = false, okSel = false, err = '';
  try {
    const resp = await p.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = resp?.status() ?? 0;
    await wait(2000);
    const title = (await p.title().catch(() => '')) || '';
    const body = (await p.locator('body').innerText().catch(() => '')).slice(0, 4000);
    blocked = /just a moment|attention required|checking your browser|access denied|cf-browser|forbidden|verifica que eres/i.test(`${title} ${body}`);
    okSel = await p.locator(c.ok).first().isVisible().catch(() => false);
    await p.screenshot({ path: join(OUT, `${c.name}-${tag}.png`), fullPage: true }).catch(() => {});
  } catch (e) { err = (e as Error).message; }
  finally { await ctx.close().catch(() => {}); }
  const verdict = err ? 'ERROR' : blocked ? '⛔ BLOQUEADO' : okSel ? '✅ OK (form visible)' : (status === 200 ? '⚠ cargó sin form' : '⚠ dudoso');
  console.log(`     ${c.name.padEnd(10)} → ${verdict}   http ${status || '-'}${err ? ` · ${err.slice(0, 70)}` : ''}`);
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
  console.log('\n   Notas:');
  console.log('   • Superbid no se prueba: es un lookup en la DB local, no toca la red.');
  console.log('   • Las "directas" deben salir por la IP peruana del VPS (directo), NO por proxy.');
  console.log('   • FISE/ATU CARGAN aun sin proxy — su bloqueo es el SCORE del reCAPTCHA v3 (solo se ve al ENVIAR,');
  console.log('     por eso el bloque 3 end-to-end es la prueba real). Infogas bloquea en la CARGA (Cloudflare).');
  console.log('   • FISE usa el puerto :23308 → los proxies residenciales (iProyal) solo tunelizan 80/443 →');
  console.log('     ERR_TUNNEL_CONNECTION_FAILED por proxy. FISE necesita otra vía (ver con el equipo).');

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
      try { const r = await fn(page, testPlate, solver, join(OUT, `e2e-${name}.png`)); console.log(`     ${name.padEnd(10)} → ${r.status} · ${r.summary} (${r.ms}ms)`); }
      catch (e) { console.log(`     ${name.padEnd(10)} → ERROR ${(e as Error).message}`); }
      finally { await page.close().catch(() => {}); }
    }
    await b.close().catch(() => {});
  } else {
    console.log('\n3) (FISE/Infogas end-to-end omitido) Requiere PROXY_URL + CAPSOLVER_API_KEY + TEST_PLATE (placa a gas).');
  }

  // 4) ATU end-to-end (CDP nativo, score reCAPTCHA v3). NO usa CapSolver ni el proxy Playwright:
  // corre su propio Chrome real y sale por ATU_PROXY (ponlo al forwarder gost). CUALQUIER placa sirve
  // (no necesita ser a gas). Es la prueba que de verdad importa: ¿la IP residencial pasa el score v3?
  if (testPlate) {
    const atuProxy = process.env.ATU_PROXY ?? process.env.CDP_PROXY ?? '';
    console.log(`\n4) ATU END-TO-END (CDP · placa ${testPlate}) — la prueba real del score v3 · ATU_PROXY=${atuProxy || '(directo, sin proxy)'}:`);
    try {
      const { scrapeAtuViaCdp } = await import('./operator/atu-cdp.js');
      const r = await scrapeAtuViaCdp(testPlate, { shotPath: join(OUT, 'e2e-ATU.png') });
      console.log(`     ATU        → ${r.status}${r.error ? ` · ${r.error.slice(0, 110)}` : (r.data ? ` · ${JSON.stringify(r.data).slice(0, 90)}` : '')}`);
      console.log(r.status === 'ERROR' ? '     ⛔ score v3 sigue rechazando (o sin proxy = baseline). Con proxy residencial debería pasar.'
        : '     ✅ el score v3 PASÓ — la IP residencial sirve para ATU.');
    } catch (e) { console.log(`     ATU        → ERROR ${(e as Error).message} (¿choca con el motor? pausa el operador)`); }
  } else {
    console.log('\n4) (ATU end-to-end omitido) Corre con TEST_PLATE=<cualquier placa> y ATU_PROXY apuntando al proxy.');
  }
  console.log('');
  process.exit(0);
})();
