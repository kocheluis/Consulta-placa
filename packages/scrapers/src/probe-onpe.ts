/* eslint-disable no-console */
/**
 * PROBE de la consulta de multas electorales del JNE (multas.jne.gob.pe), tras Imperva Incapsula.
 * Diseñado para correr en el VPS (IP distinta a la PC que quedó bloqueada), con Chrome REAL +
 * comportamiento humano (patchright stealth, tipeo con delays, mouse, esperas). UNA sola consulta.
 *
 * Captura screenshots en cada etapa + las respuestas de red (para construir el parser real luego).
 * NO reintenta en bucle (cada intento contra Incapsula arriesga bloquear la IP).
 *
 *   VPS:  set -a; . /root/placape.env; set +a; DISPLAY=:99 \
 *         npx tsx packages/scrapers/src/probe-onpe.ts 41097147
 *   (el DNI de prueba es el titular actual de CDK293, dato público; cámbialo si quieres.)
 */
import { chromium } from 'patchright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

// Estructura del formulario (evaluate como STRING para no chocar con el helper __name de tsx).
const FORM_EVAL = `(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const d = (el) => [el.tagName.toLowerCase(), el.id&&('#'+el.id), el.getAttribute('formcontrolname')&&('fcn='+el.getAttribute('formcontrolname')), el.getAttribute('type')&&('type='+el.getAttribute('type')), el.getAttribute('placeholder')&&('ph='+el.getAttribute('placeholder')), el.getAttribute('maxlength')&&('max='+el.getAttribute('maxlength'))].filter(Boolean).join(' ');
  return {
    inputs: q('input').map(d),
    buttons: q('button,input[type=submit]').map((b)=>((b.innerText||'').trim()||d(b))).filter(Boolean),
    checkboxes: q('input[type=checkbox],mat-checkbox').map(d),
    captchaImgs: q('img').map((i)=>i.src).filter((s)=>/captcha|codigo|code|base64|data:image/i.test(s)),
    recaptcha: q('[data-sitekey],iframe[src*=recaptcha],.g-recaptcha').map((e)=>e.getAttribute&&e.getAttribute('data-sitekey')||'recaptcha'),
    body: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,500)
  };
})()`;

(async () => {
  const shots: string[] = [];
  const shot = async (page: import('patchright').Page, name: string): Promise<void> => {
    const p = join(outDir, `vps-${name}.png`);
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    shots.push(p);
    console.log(`  · screenshot ${name}`);
  };

  const ctx = await chromium.launchPersistentContext(profile, { headless: false, channel: 'chrome', viewport: null });
  const captured: Array<{ url: string; ct: string; body: string }> = [];
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('response', (resp) => {
      const u = resp.url();
      if (/\.(js|css|png|jpe?g|svg|gif|woff2?|ico|map)(\?|$)/i.test(u) || /Incapsula|imperva|gtag|google|clarity/i.test(u)) return;
      void resp.text().then((t) => { if (t && t.length > 2) captured.push({ url: u, ct: resp.headers()['content-type'] ?? '', body: t.slice(0, 2000) }); }).catch(() => {});
    });

    console.log(`JNE multas · DNI ${DNI} · Chrome real (patchright, canal chrome)`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', (e as Error).message));

    // Espera humana a que Incapsula pase + Angular renderice el formulario.
    let formReady = false;
    for (let i = 0; i < 35 && !formReady; i++) {
      await wait(1000);
      if (i === 3 || i === 12) { await page.mouse.move(rnd(200, 900), rnd(150, 600), { steps: rnd(6, 14) }).catch(() => {}); await page.mouse.wheel(0, rnd(100, 400)).catch(() => {}); }
      formReady = await page.locator('input:visible').first().isVisible().catch(() => false);
    }
    await wait(1500);
    await shot(page, '01-cargado');

    const bodyTxt = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
    if (/access denied|error 17|blocked by our security|request unsuccessful/i.test(bodyTxt)) {
      console.log('\n❌ BLOQUEADO por Imperva (Access denied). La IP del VPS también está marcada o el');
      console.log('   fingerprint no pasó. NO reintentar seguido. Body:', bodyTxt.replace(/\s+/g, ' ').slice(0, 160));
      await shot(page, '99-bloqueado');
      return;
    }

    const info = await page.evaluate(FORM_EVAL).catch((e) => ({ err: (e as Error).message })) as Record<string, unknown>;
    console.log('\n=== FORMULARIO ===');
    console.log(JSON.stringify(info, null, 1));
    if (!Array.isArray(info.inputs) || !info.inputs.length) { console.log('\n⚠️ No apareció el formulario (¿Incapsula silencioso?). Revisa vps-01-cargado.png.'); return; }

    // ── DNI: primer input plausible (maxlength 8 / formcontrolname o placeholder con dni/documento / text) ──
    console.log(`\nLlenando DNI ${DNI}…`);
    const dniInput = page.locator(
      'input[maxlength="8"], input[formcontrolname*="dni" i], input[formcontrolname*="doc" i], input[placeholder*="DNI" i], input[placeholder*="documento" i], input[type="text"]:visible, input[type="number"]:visible',
    ).first();
    await dniInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.mouse.move(rnd(300, 700), rnd(250, 450), { steps: rnd(5, 12) }).catch(() => {});
    await dniInput.click().catch(() => {});
    for (const ch of DNI) { await page.keyboard.type(ch, { delay: rnd(90, 200) }); }
    await wait(rnd(500, 1200));

    // ── Términos: marcar el checkbox si existe ──
    const term = page.locator('mat-checkbox, input[type="checkbox"]').first();
    if (await term.isVisible().catch(() => false)) { await term.click().catch(() => {}); console.log('  · términos aceptados'); await wait(rnd(400, 900)); }

    // ── Captcha: imagen (código a tipear) o reCAPTCHA ──
    const capImg = page.locator('img[src*="captcha" i], img[src^="data:image"], img[src*="codigo" i]').first();
    const hasImg = await capImg.isVisible().catch(() => false);
    const hasRecaptcha = Array.isArray(info.recaptcha) && info.recaptcha.length > 0;
    if (hasImg && KEY) {
      console.log('  · captcha de IMAGEN → resolviendo con CapSolver…');
      const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: KEY });
      const b64 = (await capImg.screenshot().catch(() => null))?.toString('base64');
      if (b64) {
        const code = (await solver.solveImage(b64).catch(() => '')).trim();
        console.log(`  · código captcha: "${code}"`);
        const capInput = page.locator('input[formcontrolname*="captcha" i], input[placeholder*="código" i], input[placeholder*="captcha" i], input[maxlength="4"], input[maxlength="5"], input[maxlength="6"]').first();
        if (code && await capInput.isVisible().catch(() => false)) { await capInput.click().catch(() => {}); for (const ch of code) await page.keyboard.type(ch, { delay: rnd(90, 180) }); }
      }
    } else if (hasRecaptcha && KEY) {
      console.log('  · reCAPTCHA detectado (solver de imagen no aplica aquí; requiere sitekey — ver dump).');
    } else {
      console.log(`  · captcha: ${hasImg ? 'imagen sin CAPTCHA_API_KEY' : 'no detecté imagen'} · recaptcha=${hasRecaptcha}`);
    }
    await shot(page, '02-lleno');

    // ── Consultar ──
    const btn = page.locator('button:has-text("Consultar"), button:has-text("Buscar"), button[type="submit"], input[type="submit"]').first();
    if (await btn.isVisible().catch(() => false)) {
      console.log('  · clic en Consultar…');
      await page.mouse.move(rnd(400, 800), rnd(400, 600), { steps: rnd(6, 12) }).catch(() => {});
      captured.length = 0;
      await btn.click().catch(() => {});
      await wait(7000);
    } else { console.log('  ⚠️ no encontré el botón Consultar'); }
    await shot(page, '03-resultado');

    const resultTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log('\n=== RESULTADO (texto) ===\n', resultTxt.slice(0, 700));
    console.log(`\n=== RESPUESTAS DE RED tras Consultar (${captured.length}) ===`);
    for (const r of captured.slice(0, 12)) console.log(`  ${r.ct} · ${r.url}\n    ${r.body.slice(0, 400)}`);
    writeFileSync(join(outDir, 'vps-result.html'), await page.content(), 'utf8');
    console.log(`\n✓ Screenshots + vps-result.html en ${outDir}`);
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await ctx.close().catch(() => {}); process.exit(0); }
})();
