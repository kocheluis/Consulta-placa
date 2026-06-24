/* eslint-disable no-console */
import { chromium as stealth, type Page } from 'patchright';
import { writeFileSync } from 'node:fs';
import { createCaptchaSolver } from './captcha/index.js';

/**
 * DESCUBRIMIENTO de Síguelo Plus (SUNARP) — servicio gratuito que, dado
 * oficina+año+título, muestra el "Asiento de inscripción" con el PRECIO de la
 * transacción del último propietario. Protegido por Cloudflare Turnstile.
 *
 * Objetivo: ver si desde esta IP pasa el Turnstile, descubrir selectores reales,
 * e interceptar la API `siguelo/asientoinscripcion` para saber si va cifrada.
 *
 * Uso: npx tsx packages/scrapers/src/probe-siguelo.ts LIMA 2020 02305829
 */
const oficina = (process.argv[2] ?? 'LIMA').toUpperCase();
const anio = process.argv[3] ?? '2020';
const titulo = process.argv[4] ?? '02305829';
const key = process.env.CAPTCHA_API_KEY ?? '';
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const URL = 'https://sigueloplus.sunarp.gob.pe/siguelo/';
const SITEKEY = '0x4AAAAAABjHwQpFgHGVKCei';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let detectedSitekey: string | null = null;
const apiResponses: Array<{ url: string; body: string }> = [];

async function dumpForm(page: Page) {
  const selects = await page.$$eval('select', (els) => els.map((e) => ({ id: e.id, name: (e as HTMLSelectElement).name, opts: Array.from((e as HTMLSelectElement).options).map((o) => o.text).slice(0, 6) }))).catch(() => []);
  const inputs = await page.$$eval('input', (els) => els.filter((e) => (e as HTMLInputElement).type !== 'hidden').map((e) => ({ id: e.id, type: (e as HTMLInputElement).type, ph: (e as HTMLInputElement).placeholder || '', name: (e as HTMLInputElement).name }))).catch(() => []);
  const btns = await page.$$eval('button', (els) => els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 12)).catch(() => []);
  console.log('SELECTS:', JSON.stringify(selects));
  console.log('INPUTS :', JSON.stringify(inputs));
  console.log('BUTTONS:', JSON.stringify(btns));
}

const ctx = await stealth.launchPersistentContext('.stealth-profile', { channel: 'chrome', headless: false, viewport: null, locale: 'es-PE' }).catch(() => null);
if (!ctx) { console.error('No se pudo lanzar Chrome stealth (¿instalado?).'); process.exit(1); }
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
// Hook del Turnstile (Angular): captura el/los callback(s) para dispararlos con el token resuelto.
await page.addInitScript(() => {
  const w = globalThis as Record<string, unknown>;
  const cbs: Array<(t: string) => void> = [];
  w.__cfCallbacks = cbs;
  let real: { render?: (c: unknown, p: unknown) => unknown } | undefined;
  try {
    Object.defineProperty(w, 'turnstile', {
      configurable: true,
      get: () => real,
      set: (v: { render?: (c: unknown, p: unknown) => unknown }) => {
        real = v;
        if (v && typeof v.render === 'function') {
          const orig = v.render.bind(v);
          v.render = (c: unknown, p: unknown) => {
            const params = p as { callback?: (t: string) => void } | undefined;
            if (params && typeof params.callback === 'function') cbs.push(params.callback);
            return orig(c, p);
          };
        }
      },
    });
  } catch { /* ignore */ }
});
page.on('request', (r) => { if (!detectedSitekey && r.url().includes('challenges.cloudflare.com')) { const m = r.url().match(/0x4[A-Za-z0-9_-]{18,}/); if (m) detectedSitekey = m[0]; } });
page.on('response', (resp) => {
  if (/siguelo\/(asientoinscripcion|siguelo-tracking|GetTituloInscripcion)/i.test(resp.url())) {
    resp.text().then((b) => { apiResponses.push({ url: resp.url(), body: b.slice(0, 4000) }); }).catch(() => {});
  }
});

try {
  console.log(`Síguelo Plus · ${oficina} ${anio} ${titulo}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(7000); // Turnstile pasivo
  // Aceptar cookies/consentimiento si aparece.
  await page.locator('button:has-text("Acepto")').first().click({ timeout: 3000 }).catch(() => {});
  await wait(500);
  console.log('1) Estructura del formulario:');
  await dumpForm(page);

  // Token Turnstile: pasivo o CapSolver + disparar callback Angular.
  let token = await page.locator('input[name="cf-turnstile-response"]').first().inputValue().catch(() => '');
  console.log(`2) Turnstile pasivo: ${token ? 'PASÓ (' + token.length + ')' : 'NO pasó'} · sitekey=${detectedSitekey ?? SITEKEY}`);
  if (!token && key) {
    console.log('   CapSolver Turnstile…');
    token = await solver.solveTurnstile(detectedSitekey ?? SITEKEY, URL).catch((e) => { console.warn('   CapSolver:', (e as Error).message); return ''; });
    if (token) {
      await page.evaluate((t) => { document.querySelectorAll('input[name="cf-turnstile-response"]').forEach((e) => { (e as HTMLInputElement).value = t; }); }, token).catch(() => {});
      await page.evaluate((t) => { const w = globalThis as Record<string, unknown>; const cbs = (w.__cfCallbacks as Array<(x: string) => void>) ?? []; cbs.forEach((cb) => { try { cb(t); } catch { /**/ } }); }, token).catch(() => {});
      console.log('   token CapSolver inyectado + callback disparado (' + token.length + ')');
    }
  }

  // 3) Rellenar el formulario (selectores reales descubiertos).
  console.log('3) Rellenando: Título · ' + oficina + ' · ' + anio + ' · ' + titulo);
  await page.locator('input[name="optradio"]').first().check().catch(() => {});
  await page.selectOption('#cboOficina', { label: oficina }).catch((e) => console.warn('   oficina:', (e as Error).message));
  await page.selectOption('#cboAnio', { label: anio }).catch((e) => console.warn('   año:', (e as Error).message));
  await page.locator('input[name="numeroTitulo"]').fill(titulo).catch(() => {});
  await wait(800);
  await page.screenshot({ path: `${OUT}/siguelo-1-form.png`, fullPage: true }).catch(() => {});

  // 4) BUSCAR. Si está disabled (Turnstile no validó por Angular), forzamos para
  //    PROBAR si el servidor acepta el token de CapSolver y ver la respuesta API.
  const buscar = page.locator('button:has-text("BUSCAR")').first();
  const disabled = await buscar.isDisabled().catch(() => true);
  console.log(`4) BUSCAR ${disabled ? 'DESHABILITADO → forzando para probar API' : 'habilitado'}…`);
  if (disabled) {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /buscar/i.test(x.textContent || ''));
      if (b) { b.removeAttribute('disabled'); (b as HTMLButtonElement).disabled = false; (b as HTMLButtonElement).click(); }
    }).catch(() => {});
  } else {
    await buscar.click().catch(() => {});
  }
  await wait(8000);
  await page.screenshot({ path: `${OUT}/siguelo-2-resultado.png`, fullPage: true }).catch(() => {});

  // 5) ¿Qué salió? Dump del estado nuevo + texto visible + API.
  console.log('5) Estado tras BUSCAR:');
  await dumpForm(page);
  const txt = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
  const robot = /no se pudo validar|verificaci[oó]n|captcha|robot|challenge/i.test(txt);
  console.log('   ¿bloqueo Turnstile/robot?', robot ? 'POSIBLE' : 'no aparente');
  console.log('   texto (recorte):', txt.replace(/\n+/g, ' | ').slice(0, 400));
  console.log('   API capturadas:', apiResponses.length);
  for (const r of apiResponses) console.log('   →', r.url, '\n     ', r.body.slice(0, 220));
} catch (e) {
  console.error('ERROR:', (e as Error).message);
  await page.screenshot({ path: `${OUT}/siguelo-error.png`, fullPage: true }).catch(() => {});
} finally {
  if (apiResponses.length) writeFileSync(`${OUT}/siguelo-api.json`, JSON.stringify(apiResponses, null, 2), 'utf8');
  await ctx.close().catch(() => {});
  process.exit(0);
}
