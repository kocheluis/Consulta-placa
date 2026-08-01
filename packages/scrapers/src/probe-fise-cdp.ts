/* eslint-disable no-console */
// Probe VISUAL de FISE con Chrome REAL (CDP) — para correr EN EL VPS.
// Objetivo: EVIDENCIA VISUAL de qué ve Chrome al entrar al link de FISE
// (fise.minem.gob.pe:23308). Recorre la MISMA cadena de egresos de ATU
// (directo IP del VPS → túnel local ENGINE_PROXY → proxy explícito) y, por
// CADA egreso, lanza un Chrome real, navega al portal y GUARDA UN SCREENSHOT
// de lo que aparece: el formulario "Consulta de pagos" (cargó) o la página de
// error de Chrome ("No se puede acceder… ERR_CONNECTION_TIMED_OUT" = la IP no
// alcanza el :23308, bloqueo de red — no es el captcha).
//
//   cd ~/Proyecto_Consulta_placa && npx tsx packages/scrapers/src/probe-fise-cdp.ts
//
// Deja los .png en el directorio actual (fise-cdp-e1.png, fise-cdp-e2.png, …).
import { spawn, execFile } from 'node:child_process';
import { platform } from 'node:os';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { atuEgressChain } from './operator/atu-cdp.js';

const FISE_URL = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio';
const PORT = Number(process.env.CDP_FISE_PROBE_PORT ?? 9231);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function killChrome(port: number): Promise<void> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
    await b.close().catch(() => {});
  } catch { /* no estaba */ }
  if (platform() === 'linux') { try { execFile('pkill', ['-f', `remote-debugging-port=${port}`], () => {}); } catch { /* */ } }
  await wait(1500);
}

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.error('No encontré chrome.exe / google-chrome. Instala Chrome.'); process.exit(1); }
  console.log(`FISE-CDP (Chrome real) → ${FISE_URL}`);
  console.log(`chrome: ${chrome}`);
  const chain = atuEgressChain();
  console.log(`egresos a probar: ${chain.map((e) => e.label).join('  →  ')}\n`);

  for (let i = 0; i < chain.length; i++) {
    const eg = chain[i]!;
    const shot = `fise-cdp-e${i + 1}.png`;
    const tag = `[egreso ${i + 1}/${chain.length}] ${eg.label}`;
    console.log(`\n──────── ${tag} ────────`);
    let proxyArg = '';
    try { proxyArg = await eg.proxy((m) => console.log('   ·', m)); }
    catch (e) { console.log(`   ✗ no se pudo preparar el egreso: ${(e as Error).message} → salto`); continue; }

    let browser: Browser | null = null;
    try {
      console.log(`   lanzando Chrome (CDP :${PORT})${proxyArg ? ` vía ${proxyArg}` : ' — directo (IP del VPS)'}…`);
      const proc = spawn(
        chrome,
        [`--remote-debugging-port=${PORT}`, `--user-data-dir=${process.cwd()}/.cdp-fise-probe-e${i + 1}`, ...chromeFlags(), ...(proxyArg ? [`--proxy-server=${proxyArg}`] : []), 'about:blank'],
        { detached: false, stdio: 'ignore' },
      );
      proc.on('error', (e) => console.log(`   spawn chrome: ${e.message}`));
      for (let k = 0; k < 20 && !browser; k++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* aún no */ } }
      if (!browser) { console.log('   ✗ no conecté al Chrome CDP'); await killChrome(PORT); continue; }

      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());

      // IP de salida (host distinto a FISE → responde aunque FISE esté bloqueado): confirma por
      // dónde sale este egreso.
      const ip = String(await page.evaluate(
        `fetch('https://api.ipify.org?format=text').then(function(r){return r.text()}).catch(function(){return '?'})`,
      ).catch(() => '?')).trim().slice(0, 45);
      console.log(`   IP de salida: ${ip}`);

      // Navegación al portal FISE. Si la IP no alcanza el :23308, aquí revienta con ERR_TIMED_OUT /
      // ERR_CONNECTION_TIMED_OUT tras el timeout — pero la CAPTURA igual retrata la página de error.
      const t0 = Date.now();
      let navErr = '';
      await page.goto(FISE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch((e) => { navErr = (e as Error).message; });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);

      // Deja que pinte (formulario o página de error) y sondea señales del portal real.
      await wait(2500);
      const title = await page.title().catch(() => '');
      const url = page.url();
      const hasForm = await page.locator('#consultaId, input[formcontrolname*="laca" i], input[name*="laca" i], #placaVehiculo').count().catch(() => 0);
      const bodyTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);

      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(`   navegación: ${dt}s${navErr ? `  ⚠ ${(/net::\S+/.exec(navErr)?.[0] ?? navErr).slice(0, 60)}` : ''}`);
      console.log(`   title : "${title}"`);
      console.log(`   url   : ${url}`);
      console.log(`   form FISE presente: ${hasForm > 0 ? 'SÍ ✅ (el portal CARGÓ)' : 'no ❌'}`);
      console.log(`   body  : "${bodyTxt}"`);
      console.log(`   📸 screenshot: ${process.cwd()}/${shot}`);
      if (hasForm > 0) console.log('   →→ FISE ALCANZABLE desde este egreso. Se puede scrapear.');
      else console.log('   →→ FISE NO cargó por este egreso (revisa la captura: error de red vs otra cosa).');
    } catch (e) {
      console.log(`   ✗ excepción: ${(e as Error).message}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      await killChrome(PORT);
    }
  }
  console.log('\nListo. Revisa los fise-cdp-e*.png (uno por egreso).');
  process.exit(0);
})();
