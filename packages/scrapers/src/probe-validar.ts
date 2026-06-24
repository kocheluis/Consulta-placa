/* eslint-disable no-console */
import { chromium, type Frame, type Page, type Locator } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCaptchaSolver } from './captcha/index.js';

/**
 * RE-VALIDACIÓN HONESTA de las fuentes con CAPTCHA de imagen (SAT captura,
 * MTC CITV, APESEG SOAT). Para CADA fuente:
 *   1. Resuelve el captcha con CapSolver (screenshot del <img> → base64).
 *   2. Envía y LEE el texto del resultado (no asume; imprime lo que ve).
 *   3. Reintenta hasta 3 veces si el captcha es rechazado.
 *   4. Hace un CONTROL con captcha ERRÓNEO para distinguir éxito real de falso.
 *
 * Uso:  npx tsx packages/scrapers/src/probe-validar.ts BTF268
 */

const plate = (process.argv[2] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const onlySite = (process.argv[3] ?? '').toLowerCase(); // sat|mtc|apeseg|'' (todas)
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) {
  console.error('Falta CAPTCHA_API_KEY (CapSolver) en el entorno.');
  process.exit(1);
}
const provider = process.env.CAPTCHA_PROVIDER ?? 'capsolver';
const solver = createCaptchaSolver({ provider, apiKey: key });

const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
mkdirSync(OUT, { recursive: true });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Captura el <img> del captcha como PNG base64 y lo resuelve con CapSolver. */
async function solveImgCaptcha(img: Locator, label: string): Promise<string> {
  const buf = await img.screenshot();
  const b64 = buf.toString('base64');
  const text = await solver.solveImage(b64);
  console.log(`   [${label}] CapSolver leyó: "${text}"`);
  return text.trim();
}

async function findFrameWith(page: Page, selector: string): Promise<Frame | null> {
  for (const f of page.frames()) {
    if (await f.locator(selector).count().catch(() => 0)) return f;
  }
  return null;
}

/* ───────────────────────── SAT · Orden de captura ───────────────────────── */
async function probeSat(page: Page): Promise<void> {
  console.log('\n========== SAT · Captura de vehículo ==========');
  const URL = 'https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx';
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await wait(1500);

  // Selectores reales (capturados del DOM, ASP.NET WebForms).
  const frame = page.mainFrame();
  const img = frame.locator('img.captcha_class').first();
  const plateInput = frame.locator('#ctl00_cplPrincipal_txtPlaca');
  const capInput = frame.locator('#ctl00_cplPrincipal_txtCaptcha');
  const submit = frame.locator('#ctl00_cplPrincipal_CaptchaContinue');
  if (!(await img.count())) {
    writeFileSync(`${OUT}/sat-rev-debug.html`, await frame.content(), 'utf8');
    console.log('   ⚠️ no se halló el captcha; volqué sat-rev-debug.html');
    return;
  }

  // El RESULTADO real es la frase "El vehículo de placa <PLACA> ... orden de captura"
  // o "Informe actualizado al". NO confundir con la instrucción "Para ver si su
  // vehículo tiene orden de captura...". Devolvemos {body, result, error}.
  const RESULT_RE = new RegExp(`el veh[ií]culo de placa\\s*${plate}[^]*?(orden de captura[^.]*\\.)`, 'i');
  const ERR_RE = /(c[oó]digo|captcha|seguridad)[^.]{0,40}(incorrect|no es correcto|inv[aá]lid|errado|err[oó]ne)/i;
  const trySubmit = async (captchaText: string, tag: string) => {
    await plateInput.fill(plate);
    const got = await plateInput.inputValue();
    if (got !== plate) console.log(`   ⚠️ placa quedó como "${got}" (el campo filtra caracteres)`);
    await capInput.fill(captchaText);
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      submit.click(),
    ]);
    // El resultado aparece tras el postback; espera hasta ~12s a que salga algo.
    let body = '';
    for (let k = 0; k < 12; k++) {
      await wait(1000);
      body = (await frame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ').trim();
      if (RESULT_RE.test(body) || ERR_RE.test(body)) break;
    }
    writeFileSync(`${OUT}/sat-rev-${tag}.txt`, body, 'utf8');
    const result = body.match(RESULT_RE)?.[0]?.replace(/\s+/g, ' ').trim() ?? null;
    const error = body.match(ERR_RE)?.[0] ?? null;
    return { result, error };
  };

  // CONTROL: captcha deliberadamente erróneo → así sé cómo se ve un fallo.
  console.log('   ── CONTROL (captcha errado "0000") ──');
  const ctrl = await trySubmit('0000', 'control');
  console.log(`   control → result:${ctrl.result ? `"${ctrl.result}"` : 'NINGUNO'}  error:${ctrl.error ?? 'ninguno'}`);
  await page.screenshot({ path: `${OUT}/sat-rev-control.png`, fullPage: true });
  const controlGivesResult = !!ctrl.result;
  if (controlGivesResult) {
    console.log('   ⚠️ OJO: el captcha ERRÓNEO también devolvió resultado → SAT NO valida el captcha,');
    console.log('      o el resultado no depende de él. El "éxito" no prueba que CapSolver acertara.');
  }

  // REAL: con CapSolver, hasta 3 intentos.
  for (let i = 1; i <= 3; i++) {
    console.log(`   ── REAL intento ${i}/3 ──`);
    await page.reload({ waitUntil: 'networkidle' });
    await wait(1200);
    const sol = await solveImgCaptcha(img, 'SAT');
    const { result, error } = await trySubmit(sol, `real${i}`);
    console.log(`   result:${result ? `"${result}"` : 'NINGUNO'}  error:${error ?? 'ninguno'}`);
    if (result && !error) {
      await page.screenshot({ path: `${OUT}/sat-rev-ok.png`, fullPage: true });
      console.log(
        controlGivesResult
          ? '   ⚠️ SAT devolvió dato, PERO el control también → no se prueba que el captcha se resolviera.'
          : '   ✅ SAT: resultado real y el control (captcha errado) NO daba dato → captcha resuelto de verdad.',
      );
      return;
    }
    console.log('   captcha rechazado o sin dato; reintento…');
  }
  await page.screenshot({ path: `${OUT}/sat-rev-fail.png`, fullPage: true });
  console.log('   ❌ SAT: no se obtuvo dato tras 3 intentos.');
}

/* ───────────────────────── MTC · CITV ───────────────────────── */
async function probeMtc(page: Page): Promise<void> {
  console.log('\n========== MTC · Inspección Técnica (CITV) ==========');
  const URL = 'https://portal.mtc.gob.pe/reportedgtt/form/frmConsultaCITV.aspx';
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await wait(1500);

  const frame = page.mainFrame();
  const sel = frame.locator('#selBUS_Filtro');
  const img = frame.locator('#imgCaptcha');
  const capInput = frame.locator('#texCaptcha');
  const plateInput = frame.locator('#texFiltro');
  const buscar = frame.locator('#btnBuscar');

  // MTC suele responder por alert()/confirm(); Playwright los auto-cierra → captúralos.
  let lastDialog = '';
  page.on('dialog', (d) => {
    lastDialog = d.message();
    d.accept().catch(() => {});
  });
  const selectPlaca = async () => {
    if (await sel.count()) await sel.selectOption({ label: 'Placa' }).catch(() => {});
    await wait(600);
  };
  await selectPlaca();
  if (!(await img.count())) {
    writeFileSync(`${OUT}/mtc-rev-debug.html`, await frame.content(), 'utf8');
    console.log('   ⚠️ captcha no hallado; volqué mtc-rev-debug.html');
    return;
  }

  // Marcadores: resultado real = tabla con "CITV"/fechas o "no se encontr...".
  const OK_RE = /(no se encontr|no se hallaron|no existe|no registra|n[º°]?\s*certificad|fecha de inspecci|resultado de la b[uú]squeda|planta de revisi|vigente|apto)/i;
  const ERR_RE = /(c[oó]digo|captcha)[^]{0,40}(incorrect|no es correcto|inv[aá]lid|errado|err[oó]ne)/i;
  const trySubmit = async (captchaText: string, tag: string) => {
    lastDialog = '';
    await plateInput.fill(plate);
    const got = await plateInput.inputValue();
    if (got !== plate) console.log(`   ⚠️ placa quedó como "${got}"`);
    await capInput.fill(captchaText);
    await buscar.click();
    let body = '';
    for (let k = 0; k < 12; k++) {
      await wait(1000);
      body = (await frame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ').trim();
      if (OK_RE.test(body) || lastDialog) break;
    }
    writeFileSync(`${OUT}/mtc-rev-${tag}.txt`, `DIALOG: ${lastDialog}\n\n${body}`, 'utf8');
    const dialogErr = ERR_RE.test(lastDialog) ? lastDialog : null;
    return {
      ok: body.match(OK_RE)?.[0] ?? null,
      err: dialogErr ?? (body.match(ERR_RE)?.[0] ?? null),
      dialog: lastDialog,
      body,
    };
  };

  // CONTROL: captcha errado.
  console.log('   ── CONTROL (captcha errado "000000") ──');
  const ctrl = await trySubmit('000000', 'control');
  console.log(`   control → ok:${ctrl.ok ?? 'NINGUNO'}  dialog:${ctrl.dialog || 'ninguno'}`);
  await page.screenshot({ path: `${OUT}/mtc-rev-control.png`, fullPage: true });
  const controlGivesResult = !!ctrl.ok && !ctrl.err;

  for (let i = 1; i <= 3; i++) {
    console.log(`   ── REAL intento ${i}/3 ──`);
    await page.reload({ waitUntil: 'networkidle' });
    await wait(1000);
    await selectPlaca();
    const sol = await solveImgCaptcha(img, 'MTC');
    const { ok, err, dialog, body } = await trySubmit(sol, `real${i}`);
    console.log(`   ok:${ok ?? 'NINGUNO'}  dialog:${dialog || 'ninguno'}${!ok && !dialog ? '  body:' + body.slice(0, 160) : ''}`);
    await page.screenshot({ path: `${OUT}/mtc-rev-${i}.png`, fullPage: true });
    if (ok && !err) {
      console.log(
        controlGivesResult
          ? '   ⚠️ MTC dio respuesta, PERO el control también → no prueba que el captcha se resolviera.'
          : '   ✅ MTC: respuesta real y el control (captcha errado) NO la daba → captcha resuelto.',
      );
      return;
    }
  }
  console.log('   ❌ MTC: no se obtuvo respuesta clara tras 3 intentos.');
}

/* ───────────────────────── APESEG · SOAT ───────────────────────── */
async function probeApeseg(page: Page): Promise<void> {
  console.log('\n========== APESEG · SOAT ==========');
  await page.goto('https://www.apeseg.org.pe/consultas-soat/', { waitUntil: 'networkidle', timeout: 60000 });
  await wait(2500);
  const frame = await findFrameWith(page, '#placa, input[id*="laca" i], img[class*="aptcha" i]');
  if (!frame) {
    console.log('   ⚠️ no se encontró el iframe del formulario APESEG.');
    return;
  }
  console.log(`   frame: ${frame.url()}`);
  const plateInput = frame.locator('#placa, input[id*="laca" i]').first();
  const capInput = frame.locator('#captcha, input[id*="aptcha" i]').first();
  const img = frame.locator('img.captcha-img, img[class*="aptcha" i], img[src*="aptcha" i]').first();
  console.log(`   placa:${await plateInput.count()} cap:${await capInput.count()} img:${await img.count()}`);
  if (!(await plateInput.count()) || !(await img.count())) {
    writeFileSync(`${OUT}/apeseg-rev-debug.html`, await frame.content(), 'utf8');
    console.log('   ⚠️ campos no hallados; volqué apeseg-rev-debug.html');
    return;
  }

  for (let i = 1; i <= 3; i++) {
    console.log(`   ── intento ${i}/3 ──`);
    if (i > 1) {
      await page.reload({ waitUntil: 'networkidle' });
      await wait(2500);
    }
    const sol = await solveImgCaptcha(img, 'APESEG');
    await plateInput.fill(plate);
    await capInput.fill(sol);
    await frame.locator('button:has-text("Consultar"), button[type="submit"]').first().click();
    await wait(5000);
    const txt = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    // ¿Aparecen campos propios de un SOAT real?
    const fields = ['aseguradora', 'p[oó]liza', 'vigencia', 'inicio', 'fin', 'cobertura', 'certificado'];
    const found = fields.filter((f) => new RegExp(f, 'i').test(txt));
    const err = txt.match(/(c[oó]digo|captcha)[^.]*(incorrect|no es correcto|inv[aá]lid|err)[^.]*\.?/i)?.[0];
    const noData = /no\s+(se\s+)?(encontr|registr|existe|cuenta)/i.test(txt);
    console.log(`   campos SOAT detectados: [${found.join(', ') || 'ninguno'}]`);
    console.log(`   ${err ? 'error captcha: ' + err : noData ? 'mensaje: sin registro SOAT' : 'texto: ' + txt.slice(0, 220)}`);
    await page.screenshot({ path: `${OUT}/apeseg-rev-${i}.png`, fullPage: true });
    if ((found.length >= 2 || noData) && !err) {
      console.log('   ✅ APESEG: respuesta real (datos SOAT o "sin registro"), captcha aceptado.');
      return;
    }
  }
  console.log('   ❌ APESEG: no se obtuvo respuesta clara tras 3 intentos.');
}

/* ───────────────────────── main ───────────────────────── */
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  console.log(`Placa de prueba: ${plate}  ·  proveedor captcha: ${provider}`);

  if (!onlySite || onlySite === 'sat') await probeSat(page).catch((e) => console.error('SAT ERROR:', (e as Error).message));
  if (!onlySite || onlySite === 'mtc') await probeMtc(page).catch((e) => console.error('MTC ERROR:', (e as Error).message));
  if (!onlySite || onlySite === 'apeseg') await probeApeseg(page).catch((e) => console.error('APESEG ERROR:', (e as Error).message));
} finally {
  await browser.close();
  console.log('\nListo. Screenshots en validacion-fuentes/ (sat-rev-*, mtc-rev-*, apeseg-rev-*).');
  process.exit(0);
}
