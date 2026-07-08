/* eslint-disable no-console */
/**
 * PROBE INTERACTIVO del JNE (multas electorales) — el operador resuelve el captcha a mano para
 * (1) lograr una consulta EXITOSA y ver el formato del resultado + la API (armar el parser), y
 * (2) dejar una referencia CapSolver-vs-correcto (para decidir el solver automático).
 *
 * Flujo: abre Chrome real (patchright, pasa Imperva), llena el DNI, guarda el captcha en un PNG,
 * y ESPERA a que escribas el código (lo lees del PNG). Luego marca términos, envía y captura todo.
 *
 *   VPS:  set -a; . /root/placape.env; set +a; DISPLAY=:99 \
 *         npx tsx packages/scrapers/src/probe-onpe-manual.ts 41097147
 *   Mientras espera "escribe el código", bájate el PNG (WinSCP/scp) y léelo. Corre varias veces
 *   (DNIs con y sin multas) para ver ambos formatos.
 */
import { chromium } from 'patchright';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createCaptchaSolver } from './captcha/index.js';

const DNI = (process.argv[2] ?? '41097147').replace(/\D/g, '');
const URL = 'https://multas.jne.gob.pe/';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'onpe', '__captured__');
const profile = join(here, '..', '.cdp-onpe-profile');
mkdirSync(outDir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));
const KEY = process.env.CAPTCHA_API_KEY ?? '';
const ask = (q: string): Promise<string> =>
  new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });

(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, channel: 'chrome', viewport: null });
  const captured: Array<{ url: string; ct: string; body: string }> = [];
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('response', (resp) => {
      const u = resp.url();
      if (/\.(js|css|png|jpe?g|svg|gif|woff2?|ico|map)(\?|$)/i.test(u) || /Incapsula|imperva|gtag|google|clarity/i.test(u)) return;
      void resp.text().then((t) => { if (t && t.length > 2) captured.push({ url: u, ct: resp.headers()['content-type'] ?? '', body: t.slice(0, 3000) }); }).catch(() => {});
    });

    console.log(`JNE multas · DNI ${DNI} · Chrome real (patchright)`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', (e as Error).message));
    for (let i = 0; i < 35; i++) { await wait(1000); if (await page.locator('input:visible').first().isVisible().catch(() => false)) break; }
    await wait(1500);
    const bodyTxt = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
    if (/access denied|error 17|blocked by our security/i.test(bodyTxt)) { console.log('❌ BLOQUEADO por Imperva. No reintentar seguido.'); await page.screenshot({ path: join(outDir, 'manual-bloqueado.png') }).catch(() => {}); return; }

    // DNI
    console.log(`Llenando DNI ${DNI}…`);
    const dniInput = page.locator('input[formcontrolname="Dni"], input.cod_dni, input[placeholder*="DNI" i]').first();
    await dniInput.click().catch(() => {}); await dniInput.fill('').catch(() => {});
    for (const ch of DNI) await page.keyboard.type(ch, { delay: rnd(90, 180) });

    // Captcha: referencia de CapSolver + guardar PNG para lectura manual
    const capImg = page.locator('img').nth(1);
    let guess = '';
    if (KEY) {
      const b64 = (await capImg.screenshot().catch(() => null))?.toString('base64');
      if (b64) guess = (await createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: KEY }).solveImage(b64).catch(() => '')).replace(/\D/g, '');
    }
    const capPng = join(outDir, 'manual-captcha.png');
    await capImg.screenshot({ path: capPng }).catch(() => {});
    await page.screenshot({ path: join(outDir, 'manual-01-form.png'), fullPage: true }).catch(() => {});
    console.log(`\n📷 Captcha guardado en: ${capPng}`);
    console.log(`   (también la página completa en manual-01-form.png)`);
    console.log(`   CapSolver leyó: "${guess || '—'}"`);

    const code = (await ask('\n➜ Lee el captcha del PNG y escribe el código (ENTER = usar el de CapSolver): ')) || guess;
    if (!code) { console.log('sin código, salgo'); return; }
    console.log(`Usando código: ${code}`);
    // Referencia CapSolver-vs-correcto (para tunear el solver).
    appendFileSync(join(outDir, 'captcha-referencia.csv'), `${new Date().toISOString()};${guess};${code};${guess === code ? 'OK' : 'DIFF'}\n`);

    await page.locator('#inpcaptcha').click().catch(() => {});
    for (const ch of code) await page.keyboard.type(ch, { delay: rnd(80, 150) });

    // Términos + enviar
    await page.locator('#ckbtermino').check({ force: true }).catch(() => {});
    await wait(400);
    console.log('términos:', await page.locator('#ckbtermino').isChecked().catch(() => false) ? 'marcado ✓' : 'NO');
    captured.length = 0;
    await page.locator('button:has-text("Consultar"), button[type="submit"]').first().click().catch(() => {});
    await wait(7000);
    await page.screenshot({ path: join(outDir, 'manual-02-resultado.png'), fullPage: true }).catch(() => {});
    writeFileSync(join(outDir, 'manual-result.html'), await page.content(), 'utf8');

    const resultTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log('\n=== RESULTADO (texto) ===\n', resultTxt.slice(0, 900));
    console.log(`\n=== RESPUESTAS DE RED tras Consultar (${captured.length}) ===`);
    for (const r of captured.slice(0, 15)) console.log(`\n  ${r.ct} · ${r.url}\n    ${r.body.slice(0, 700)}`);
    console.log(`\n✓ manual-02-resultado.png + manual-result.html en ${outDir}`);
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await ctx.close().catch(() => {}); process.exit(0); }
})();
