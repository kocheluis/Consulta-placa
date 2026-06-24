/* eslint-disable no-console */
import type { Page, Frame, Locator } from 'playwright';
import type { CaptchaSolver } from '../captcha/index.js';

/** Resultado uniforme por fuente para la consola del operador. */
export type OperatorStatus = 'ENCONTRADO' | 'SIN_REGISTRO' | 'ERROR' | 'REQUIERE_DNI';
export interface OperatorSourceResult {
  source: string;
  label: string;
  category: string;
  status: OperatorStatus;
  summary: string;
  data?: Record<string, unknown>;
  screenshot?: string;
  ms: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Captura el <img> del captcha como PNG base64 y lo resuelve con CapSolver. */
async function readCaptcha(solver: CaptchaSolver, img: Locator): Promise<string> {
  const b64 = (await img.screenshot()).toString('base64');
  return (await solver.solveImage(b64)).trim();
}

async function findFrameWith(page: Page, selector: string): Promise<Frame | null> {
  for (const f of page.frames()) if (await f.locator(selector).count().catch(() => 0)) return f;
  return null;
}

/* ───────────────── SAT Lima · Orden de captura (captcha imagen) ───────────────── */
export async function runSatCaptura(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SAT_CAPTURA', label: 'SAT Lima · Orden de captura', category: 'CAPTURA' };
  try {
    await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx', { waitUntil: 'networkidle', timeout: 60000 });
    const img = page.locator('img.captcha_class').first();
    const plateInput = page.locator('#ctl00_cplPrincipal_txtPlaca');
    const capInput = page.locator('#ctl00_cplPrincipal_txtCaptcha');
    const submit = page.locator('#ctl00_cplPrincipal_CaptchaContinue');
    const RESULT = new RegExp(`el veh[ií]culo de placa\\s*${plate}[^]*?orden de captura[^.]*\\.`, 'i');
    const ERR = /c[oó]digo de seguridad incorrect/i;

    for (let i = 1; i <= 3; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(800); }
      await plateInput.fill(plate);
      await capInput.fill(await readCaptcha(solver, img));
      await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), submit.click()]);
      let body = '';
      for (let k = 0; k < 10; k++) { await wait(1000); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (RESULT.test(body) || ERR.test(body)) break; }
      if (RESULT.test(body)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const line = body.match(RESULT)![0].replace(/\s+/g, ' ').trim();
        const tiene = /\bs[ií]\b.*orden|tiene orden de captura/i.test(line) && !/no tiene/i.test(line);
        return { ...base, status: tiene ? 'ENCONTRADO' : 'SIN_REGISTRO', summary: line, data: { ordenDeCaptura: tiene, detalle: line }, screenshot: shot, ms: Date.now() - t0 };
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado tras varios intentos', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── Callao · Papeletas (captcha imagen inline) ───────────────── */
export async function runCallao(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'CALLAO_PAPELETAS', label: 'Callao · Papeletas', category: 'PAPELETAS' };
  try {
    let dialog = '';
    page.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
    await page.goto('https://pagopapeletascallao.pe/', { waitUntil: 'networkidle', timeout: 60000 });
    await wait(1500);
    const tipo = page.locator('#tipo_busqueda');
    const selectPlaca = async () => {
      if (await tipo.count()) {
        const opts = await tipo.locator('option').allTextContents();
        const po = opts.find((o) => /placa/i.test(o));
        if (po) await tipo.selectOption({ label: po }).catch(() => {});
      }
      await wait(400);
    };
    const valor = page.locator('#valor_busqueda');
    const capInput = page.locator('#captcha');
    const capImg = page.locator('img[src^="data:image"]').first();
    const ERR = /error al ingresar el c[oó]digo de seguridad/i;
    const NODATA = /no hay resultados para mostrar/i;

    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(1500); }
      await selectPlaca();
      await valor.fill(plate);
      dialog = '';
      await capImg.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
      await wait(400);
      await capInput.fill(await readCaptcha(solver, capImg));
      await page.locator('button:has-text("Buscar"), input[value*="Buscar" i]').first().click().catch(() => {});
      await wait(4500);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (ERR.test(body) || /captcha|seguridad/i.test(dialog)) continue;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const total = body.match(/TOTAL:\s*S\/\.?\s*([0-9.,]+)/i)?.[1] ?? null;
      if (NODATA.test(body)) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin papeletas en Callao', data: { total: total ?? '0.00' }, screenshot: shot, ms: Date.now() - t0 };
      return { ...base, status: 'ENCONTRADO', summary: `Papeletas en Callao (TOTAL S/ ${total ?? '?'})`, data: { total }, screenshot: shot, ms: Date.now() - t0 };
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado tras varios intentos', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── MTC · CITV (captcha imagen, responde por alert) ───────────────── */
export async function runMtcCitv(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'MTC_CITV', label: 'MTC · Revisión técnica (CITV)', category: 'REVISION_TECNICA' };
  try {
    let dialog = '';
    page.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
    await page.goto('https://portal.mtc.gob.pe/reportedgtt/form/frmConsultaCITV.aspx', { waitUntil: 'networkidle', timeout: 60000 });
    await wait(1200);
    const sel = page.locator('#selBUS_Filtro');
    const selectPlaca = async () => { if (await sel.count()) await sel.selectOption({ label: 'Placa' }).catch(() => {}); await wait(500); };
    const img = page.locator('#imgCaptcha');
    const capInput = page.locator('#texCaptcha');
    const plateInput = page.locator('#texFiltro');
    const buscar = page.locator('#btnBuscar');
    const OK = /ÚLTIMO DOCUMENTO|ultimo documento|NRO DE CERTIFICADO|certificad/i;

    for (let i = 1; i <= 4; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(1000); }
      await selectPlaca();
      await plateInput.fill(plate);
      dialog = '';
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(500); // el #imgCaptcha es base64 puesto por JS; deja que termine
      await capInput.fill(await readCaptcha(solver, img));
      await buscar.click();
      let body = '';
      for (let k = 0; k < 10; k++) { await wait(1000); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (OK.test(body) || dialog) break; }
      if (/captcha|c[oó]digo ingresado/i.test(dialog)) continue;
      if (OK.test(body)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const certs = parseMtcCerts(body, plate);
        const vig = certs.find((c) => /VIGENTE/i.test(c.estado ?? ''));
        const observaciones = body.match(/OBSERVACIONES\s+([^\n]{0,80})/i)?.[1]?.trim() ?? null;
        // Lunas polarizadas: el dato legítimo aparece (si aplica) en el CITV; no hay
        // consulta oficial por placa aparte (los sitios "PNP" son terceros no oficiales).
        const lunas = /lunas|polariza|oscurec/i.test(body) ? 'mención en CITV (revisar)' : 'sin mención en CITV';
        return { ...base, status: 'ENCONTRADO', summary: vig ? `CITV ${vig.estado} hasta ${vig.vigenteHasta}` : `${certs.length} certificado(s) CITV`, data: { certificados: certs, observaciones, lunasPolarizadas: lunas }, screenshot: shot, ms: Date.now() - t0 };
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado o sin datos tras varios intentos', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

function parseMtcCerts(body: string, plate: string): Array<Record<string, string>> {
  // Filas tipo: BTF268 C-2026-013-153-006784 06/04/2026 06/04/2027 APROBADO VIGENTE
  const re = new RegExp(`${plate}\\s+(C-[0-9-]+)\\s+([0-9/]{8,10})\\s+([0-9/]{8,10})\\s+(\\w+)\\s+(VIGENTE|VENCIDO)`, 'gi');
  const out: Array<Record<string, string>> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ nroCertificado: m[1] ?? '', vigenteDesde: m[2] ?? '', vigenteHasta: m[3] ?? '', resultado: m[4] ?? '', estado: (m[5] ?? '').toUpperCase() });
  return out;
}

/* ───────────────── APESEG · SOAT (iframe, captcha imagen) ───────────────── */
export async function runApeseg(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'APESEG_SOAT', label: 'APESEG · SOAT', category: 'SEGUROS' };
  try {
    await page.goto('https://www.apeseg.org.pe/consultas-soat/', { waitUntil: 'networkidle', timeout: 60000 });
    await wait(2500);
    // frameLocator re-resuelve el iframe en cada uso (resiliente a que se desprenda).
    const fl = page.frameLocator('iframe[src*="webapp.apeseg"]');
    const plateInput = fl.locator('#placa, input[id*="laca" i]').first();
    const capInput = fl.locator('#captcha, input[id*="aptcha" i]').first();
    const img = fl.locator('img.captcha-img, img[class*="aptcha" i]').first();

    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(2500); }
      await plateInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(400);
      await plateInput.fill(plate);
      await capInput.fill(await readCaptcha(solver, img));
      await fl.locator('button:has-text("Consultar"), button[type="submit"]').first().click().catch(() => {});
      await wait(5000);
      const body = (await fl.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      const err = /(c[oó]digo|captcha)[^]{0,40}(incorrect|inv[aá]lid)/i.test(body);
      if (err) continue;
      const soat = parseApesegSoat(body);
      const noData = /no\s+(se\s+)?(encontr|registr|existe|cuenta)/i.test(body);
      if (Object.keys(soat).length >= 2 || noData) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        if (noData && Object.keys(soat).length < 2) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin SOAT registrado', screenshot: shot, ms: Date.now() - t0 };
        return { ...base, status: 'ENCONTRADO', summary: `SOAT ${soat.estado ?? ''} · ${soat.compania ?? ''}`.trim(), data: soat, screenshot: shot, ms: Date.now() - t0 };
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado o sin datos tras varios intentos', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

function parseApesegSoat(body: string): Record<string, string> {
  const grab = (label: string) => body.match(new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+?)(?=\\s{2,}|Estado|Inicio|Fin|Placa|Certificado|Uso|Clase|Tipo|Compañía|Compania|$)`, 'i'))?.[1]?.trim();
  const out: Record<string, string> = {};
  const fields: Array<[string, string]> = [['compania', 'Compañía|Compania'], ['estado', 'Estado'], ['inicio', 'Inicio'], ['fin', 'Fin'], ['certificado', 'Certificado'], ['uso', 'Uso'], ['clase', 'Clase'], ['tipo', 'Tipo']];
  for (const [k, lbl] of fields) { const v = grab(lbl); if (v) out[k] = v; }
  return out;
}

/* ───────────────── SBS · SOAT + siniestralidad (reCAPTCHA v3) ───────────────── */
const SBS_SITEKEY = '6Ldq0D0hAAAAAJ2EfmS-gFvA1NprMh2MBcxtRLAL';
export async function runSbs(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SBS_SOAT', label: 'SBS · SOAT y siniestralidad', category: 'SEGUROS' };
  const URL = 'https://servicios.sbs.gob.pe/reportesoat/';
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    const OK = /resultado de (la )?b[uú]squeda|listado de p[oó]lizas|n[uú]mero de accidentes|no se encontr|no registra/i;
    for (let i = 1; i <= 2; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(1000); }
      await page.locator('#ctl00_MainBodyContent_rblOpcionesSeguros_0').check().catch(() => {});
      await page.locator('#ctl00_MainBodyContent_txtPlaca').fill(plate);
      const token = await solver.solveRecaptchaV3(SBS_SITEKEY, URL, 'homepage');
      await page.evaluate(
        `(function(tok){function set(s){document.querySelectorAll(s).forEach(function(e){e.value=tok;});}set('#ctl00_MainBodyContent_hdnReCaptchaV3');set('[name="g-recaptcha-response"]');set('#g-recaptcha-response');})(${JSON.stringify(token)})`,
      );
      await page.locator('#ctl00_MainBodyContent_btnIngresarPla').click();
      await wait(5000);
      await page.waitForLoadState('networkidle').catch(() => {});
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (!OK.test(body)) continue;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const accidentes = body.match(/[uú]ltimos 5 a[nñ]os:\s*(\d+)/i)?.[1] ?? null;
      const compania = body.match(/(R[ií]mac|La Positiva|Pac[ií]fico|Mapfre|Interseguro|Crecer Seguros|Protecta|Qualitas|Vivir|Insur|HDI)[^\n]{0,30}/i)?.[0]?.trim() ?? null;
      return {
        ...base,
        status: 'ENCONTRADO',
        summary: `${accidentes ?? '?'} accidente(s) SOAT en 5 años · ${compania ?? 'aseguradora s/d'}`,
        data: { accidentes, compania, detalle: body.slice(body.search(/resultado de (la )?b[uú]squeda/i), body.search(/resultado de (la )?b[uú]squeda/i) + 600) },
        screenshot: shot,
        ms: Date.now() - t0,
      };
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'reCAPTCHA v3 rechazado o sin datos', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── SAT Lima · Papeletas (reCAPTCHA v2) ───────────────── */
const SAT_PAPELETAS_SITEKEY = '6Ldy_wsTAAAAAGYM08RRQAMvF96g9O_SNQ9_hFIJ';
export async function runSatPapeletas(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SAT_PAPELETAS', label: 'SAT Lima · Papeletas', category: 'PAPELETAS' };
  const PAGE_URL = 'https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx';
  try {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await wait(2000);
    const menuFrame = page.frames().find((f) => /bienvenida/i.test(f.url())) ?? page.mainFrame();
    const link = menuFrame.locator('a[href*="papeletas.aspx"]').first();
    if (await link.count()) { await link.click(); await wait(3500); }
    const formFrame = await findFrameWith(page, '#tipoBusquedaPapeletas');
    if (!formFrame) return { ...base, status: 'ERROR', summary: 'No se encontró el formulario de papeletas', ms: Date.now() - t0 };
    await formFrame.selectOption('#tipoBusquedaPapeletas', 'busqPlaca').catch(() => {});
    await wait(1000);
    await formFrame.locator('#ctl00_cplPrincipal_txtPlaca').fill(plate);
    const token = await solver.solveRecaptchaV2(SAT_PAPELETAS_SITEKEY, PAGE_URL);
    await formFrame.evaluate(
      `(function(){var els=document.querySelectorAll('#g-recaptcha-response,[name=g-recaptcha-response]');els.forEach(function(e){e.value=${JSON.stringify(token)};e.style.display='block';});})()`,
    );
    await formFrame.locator('#ctl00_cplPrincipal_CaptchaContinue').click();
    await wait(6000);
    const resultFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
    const body = (await resultFrame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (new RegExp(`no se encontraron papeletas[^.]*${plate}`, 'i').test(body) || /no se encontraron papeletas/i.test(body)) {
      return { ...base, status: 'SIN_REGISTRO', summary: 'Sin papeletas pendientes en Lima', screenshot: shot, ms: Date.now() - t0 };
    }
    if (/papeleta|infracci[oó]n|S\/\s*[0-9]/i.test(body)) {
      return { ...base, status: 'ENCONTRADO', summary: 'Papeletas pendientes en Lima (revisar detalle)', data: { texto: body.slice(0, 600) }, screenshot: shot, ms: Date.now() - t0 };
    }
    return { ...base, status: 'ERROR', summary: 'Respuesta no reconocida', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}
