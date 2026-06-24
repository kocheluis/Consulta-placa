/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ocrImage } from './ocr/index.js';
import { parseSunarpOcr } from './sunarp/ocr-parser.js';
import { PORTAL_SELECTORS } from './selectors.js';

const S = PORTAL_SELECTORS.sunarp;

/**
 * HÍBRIDO REAL para SUNARP: lanza un **Chrome normal** (sin banderas de
 * automatización → Cloudflare NO lo detecta) con depuración remota, y Playwright
 * se CONECTA por CDP. El humano pasa el Turnstile en el Chrome limpio (sí pasa),
 * y Playwright solo ESCUCHA la red: captura la imagen de `getDatosVehiculo` → OCR.
 *
 * Uso: npx tsx packages/scrapers/src/probe-cdp-sunarp.ts BTF268
 */
const plate = (process.argv[2] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const PORT = 9222;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-chrome-profile';
const URL = 'https://consultavehicular.sunarp.gob.pe/';
const DATA_ENDPOINT = 'getDatosVehiculo';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
if (!CHROME) { console.error('No encontré chrome.exe. Instala Google Chrome.'); process.exit(1); }

console.log(`Lanzando Chrome REAL (limpio) con depuración remota…\n  ${CHROME}`);
const proc = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, // perfil separado → instancia nueva con el puerto
  '--no-first-run',
  '--no-default-browser-check',
  URL,
], { detached: false, stdio: 'ignore' });
proc.on('error', (e) => console.error('spawn chrome:', e.message));

await wait(5000); // dar tiempo a que abra el puerto

let dataImage: string | null = null;
try {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  console.log('Playwright conectado por CDP ✓ (no lanzó el navegador, solo se conectó)');
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  page.on('response', (resp) => {
    if (!resp.url().includes(DATA_ENDPOINT)) return;
    void resp.json().then((b: unknown) => {
      const img = (b as { model?: { imagen?: string } } | null)?.model?.imagen;
      if (img) { dataImage = img; console.log('📥 ¡Respuesta de datos capturada!'); }
    }).catch(() => {});
  });

  // ── PRUEBA CLAVE: ¿pasa el Turnstile PASIVO en Chrome limpio, y puedo conducir yo? ──
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); // estado fresco
  console.log('\nEsperando que el Turnstile pase PASIVO (Chrome limpio, sin clic)…');
  let token = '';
  for (let i = 0; i < 45 && !token; i++) {
    await wait(1000);
    token = await page.locator('input[name="cf-turnstile-response"]').first().inputValue().catch(() => '');
  }

  if (token) {
    console.log(`✓ Turnstile pasó PASIVO (${token.length} chars). Llenando placa + Buscar AUTOMÁTICO (sin intervención)…`);
    await page.locator(S.plateInput).first().fill(plate).catch((e) => console.warn('fill:', (e as Error).message));
    await wait(600);
    await page.locator(S.submit).first().click().catch((e) => console.warn('click:', (e as Error).message));
    console.log('   Búsqueda enviada por Playwright. Capturando datos…');
  } else {
    console.log('⚠️ El Turnstile NO pasó pasivo. Hazlo tú: placa ' + plate + ' + verificación + Buscar.');
  }

  for (let i = 0; i < 180 && !dataImage; i++) await wait(1000);

  if (!dataImage) {
    console.log('⏱️  No capturé datos (¿no se hizo la búsqueda?). El navegador queda abierto.');
  } else {
    const img: string = dataImage;
    console.log('Corriendo OCR sobre la imagen de SUNARP…');
    const text = await ocrImage(Buffer.from(img, 'base64'));
    const parsed = parseSunarpOcr(text, plate);
    writeFileSync(`${OUT}/sunarp-cdp.json`, JSON.stringify({ text, parsed }, null, 2), 'utf8');
    console.log('\n===== TEXTO OCR (recorte) =====\n', text.slice(0, 900));
    console.log('\n===== PARSEADO =====\n', JSON.stringify(parsed, null, 2).slice(0, 900));
    console.log(`\n✓ Guardado en ${OUT}/sunarp-cdp.json`);
  }
  await browser.close().catch(() => {}); // cierra la conexión CDP, NO mata Chrome
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  console.log('\n(El Chrome queda abierto para que valides; ciérralo cuando quieras.)');
  process.exit(0);
}
