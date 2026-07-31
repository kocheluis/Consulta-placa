/* eslint-disable no-console */
import { spawn, execFile } from 'node:child_process';
import { platform } from 'node:os';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './chrome-path.js';
import { runInfogas, type OperatorSourceResult } from './sources.js';
import type { CaptchaSolver } from '../captcha/index.js';
import { atuEgressChain } from './atu-cdp.js';

/**
 * Infogas por HÍBRIDO CDP (Chrome REAL) — el Chromium headless queda atrapado en el interstitial
 * de Cloudflare ("Un momento…", validado con captura en el VPS 30-jul-2026) en TODOS los egresos.
 * Un Chrome real con perfil persistente pasa el challenge pasivo (como SUNARP/SIGM) y la clearance
 * queda en el perfil. Una vez pasado, se REUSA el runner headless (`runInfogas`) sobre la página
 * del Chrome real: mismo form (#inp_ck_plate + reCAPTCHA v2 CapSolver + .box_plate).
 *
 * Egresos: la MISMA cadena de ATU (directo → túnel sticky ENGINE_PROXY → explícito). El Chrome del
 * egreso ganador queda PARQUEADO (:9230) con la clearance caliente para la próxima placa.
 */
const URL = 'https://vh.infogas.com.pe/';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const RX_CF = /un momento|just a moment|attention required/i;

async function killChrome(port: number, log: (m: string) => void): Promise<void> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
    await b.close().catch(() => {});
  } catch { /* no conectó (puede seguir vivo igual) */ }
  // Backstop DETERMINISTA (Linux/VPS): el close por CDP a veces falla en silencio justo tras
  // desconectar Playwright → el siguiente egreso "reusaba" el Chrome viejo SIN su proxy. pkill
  // por patrón de puerto garantiza que el relanzamiento aplique el egreso nuevo.
  if (platform() === 'linux') { try { execFile('pkill', ['-f', `remote-debugging-port=${port}`], () => {}); } catch { /* */ } }
  await wait(1500);
  log(`Chrome :${port} cerrado (relanzo con el siguiente egreso)`);
}

export async function scrapeInfogasViaCdp(
  plate: string,
  solver: CaptchaSolver,
  shotPath: string,
  log: (m: string) => void,
): Promise<OperatorSourceResult> {
  const base = { source: 'INFOGAS_GNV', label: 'Infogas · Estado GNV / crédito (CDP)', category: 'GNV' };
  const chrome = findChrome();
  if (!chrome) return { ...base, status: 'ERROR', summary: 'No encontré chrome.exe', ms: 0 };
  const port = Number(process.env.CDP_INFOGAS_PORT ?? 9230);
  const profileDir = process.env.CDP_INFOGAS_PROFILE ?? `${process.cwd()}/.cdp-infogas-profile`;
  const chain = atuEgressChain(); // mismos egresos que ATU (directo → túnel sticky → explícito)
  let last: OperatorSourceResult = { ...base, status: 'ERROR', summary: 'sin egresos', ms: 0 };

  for (let i = 0; i < chain.length; i++) {
    const eg = chain[i]!;
    if (i > 0) log(`egreso ${i + 1}/${chain.length} → ${eg.label}`);
    let proxyArg = '';
    try { proxyArg = await eg.proxy(log); }
    catch (e) { log(`egreso "${eg.label}": no se pudo preparar (${(e as Error).message}) → salto`); continue; }

    let browser: Browser | null = null;
    try {
      try {
        browser = await chromium.connectOverCDP(`http://localhost:${port}`);
        log(`reusando Chrome CDP en :${port} (clearance Cloudflare persistida)`);
      } catch {
        log(`lanzando Chrome real (CDP :${port})${proxyArg ? ` vía ${proxyArg}` : ' — directo'}…`);
        const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...chromeFlags(), ...(proxyArg ? [`--proxy-server=${proxyArg}`] : []), URL], { detached: false, stdio: 'ignore' });
        proc.on('error', (e) => log(`spawn chrome: ${e.message}`));
        for (let k = 0; k < 20 && !browser; k++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${port}`); } catch { /* aún no */ } }
      }
      if (!browser) { last = { ...base, status: 'ERROR', summary: 'no conecté al Chrome CDP de Infogas', ms: 0 }; continue; }
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());

      // Esperar a que Cloudflare suelte el challenge PASIVO (Chrome real suele pasar en 5-20s):
      // listo cuando el form (#inp_ck_plate) está en el DOM o el título dejó de ser "Un momento…".
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      let cleared = false;
      for (let k = 0; k < 45; k++) {
        const title = await page.title().catch(() => '');
        const hasForm = await page.locator('#inp_ck_plate').count().catch(() => 0);
        if (hasForm > 0 || (title && !RX_CF.test(title))) { cleared = true; break; }
        await wait(1000);
      }
      if (!cleared) {
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        log(`egreso "${eg.label}": Cloudflare no soltó el challenge (~45s) → siguiente`);
        last = { ...base, status: 'ERROR', summary: 'Cloudflare no soltó el challenge (Chrome real)', ms: 0 };
        await browser.close().catch(() => {});
        browser = null;
        await killChrome(port, log);
        continue;
      }
      log('Cloudflare OK → corro el flujo del form (reCAPTCHA v2 + consulta)');
      // Reusa el runner probado sobre ESTA página (goto de nuevo es inocuo: la clearance persiste).
      // Tope de 150s: si el captcha/portal se atasca, pasamos al siguiente egreso.
      const t0 = Date.now();
      const r = await Promise.race([
        runInfogas(page, plate, solver, shotPath),
        new Promise<OperatorSourceResult>((res) => { setTimeout(() => res({ ...base, status: 'ERROR', summary: 'tope del egreso (150s)', ms: 150_000 }), 150_000); }),
      ]);
      if (r.status !== 'ERROR') return { ...r, label: base.label, ms: Date.now() - t0 }; // Chrome queda parqueado (clearance caliente)
      last = r;
      log(`egreso "${eg.label}" falló: ${r.summary}`);
      await browser.close().catch(() => {});
      browser = null;
      await killChrome(port, log);
    } catch (e) {
      last = { ...base, status: 'ERROR', summary: (e as Error).message, ms: 0 };
      log(`egreso "${eg.label}" reventó: ${(e as Error).message}`);
    } finally {
      if (browser) await browser.close().catch(() => {}); // solo desconecta CDP; el Chrome sigue parqueado
    }
  }
  return { ...last, summary: `${last.summary} · egresos agotados: ${chain.map((e) => e.label).join(' → ')}` };
}
