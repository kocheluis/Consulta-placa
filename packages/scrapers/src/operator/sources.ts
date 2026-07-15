/* eslint-disable no-console */
import type { Page, Frame, Locator } from 'playwright';
import type { CaptchaSolver } from '../captcha/index.js';
import type { PapeletaDetalle } from '@app/shared';

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

// ── Semáforo GLOBAL del captcha-imagen ───────────────────────────────────────────────────────────
// Bajo paralelismo (motor continuo), varias fuentes leyendo+resolviendo captcha A LA VEZ saturaban:
// screenshots compitiendo por CPU (imagen sin pintar) + varias llamadas simultáneas a CapSolver →
// HTTP 400. Serializamos el READ+SOLVE de imagen a CAPTCHA_IMAGE_CONCURRENCY (default 1 = serial; súbelo
// si el proveedor/VPS aguantan). Está FUERA del critical path: en PRO el historial (~2-3min) domina, así
// que serializar ~10-15s de captcha no agrega tiempo al reporte; el resto de fuentes siguen en paralelo.
const IMG_CAP = Math.max(1, Number(process.env.CAPTCHA_IMAGE_CONCURRENCY ?? 1));
let capActive = 0;
const capWaiters: Array<() => void> = [];
async function acquireCap(): Promise<() => void> {
  if (capActive >= IMG_CAP) await new Promise<void>((r) => capWaiters.push(r)); // esperar → el slot se nos transfiere
  else capActive++;
  let released = false;
  return () => { if (released) return; released = true; const w = capWaiters.shift(); if (w) w(); else capActive--; };
}

/** Captura el <img> del captcha como PNG base64 y lo resuelve con CapSolver, SERIALIZADO por el semáforo
 *  global (evita el HTTP 400 por saturación) y esperando a que la imagen esté cargada (naturalWidth>0) y
 *  con bytes reales (>500) antes de mandarla — sale al toque cuando ya está lista. */
async function readCaptcha(solver: CaptchaSolver, img: Locator): Promise<string> {
  const release = await acquireCap();
  try {
    let buf: Uint8Array = Buffer.alloc(0);
    for (let i = 0; i < 12; i++) {
      const loaded = await img.evaluate((el) => !(el instanceof HTMLImageElement) || (el.complete && el.naturalWidth > 0)).catch(() => true);
      buf = await img.screenshot().catch(() => Buffer.alloc(0));
      if (loaded && buf.length > 500) break;
      await wait(300);
    }
    return (await solver.solveImage(Buffer.from(buf).toString('base64'))).trim();
  } finally {
    release();
  }
}

/**
 * El "código de seguridad" de Callao son 3 DÍGITOS sobre un fondo con ruido. CapSolver a veces
 * mete separadores/símbolos espurios ("9-8-3", "9 8 3", incluso "6-4=?"). Nos quedamos SOLO con
 * los dígitos: si el OCR leyó "9-8-3" recupera "983"; si leyó basura (2 o 4+ dígitos) el portal
 * la rechaza y el bucle reintenta con un captcha nuevo.
 */
export function cleanCallaoCaptcha(s: string): string {
  return s.replace(/\D/g, '');
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
    await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const img = page.locator('img.captcha_class').first();
    const plateInput = page.locator('#ctl00_cplPrincipal_txtPlaca');
    const capInput = page.locator('#ctl00_cplPrincipal_txtCaptcha');
    const submit = page.locator('#ctl00_cplPrincipal_CaptchaContinue');
    const RESULT = new RegExp(`el veh[ií]culo de placa\\s*${plate}[^]*?orden de captura[^.]*\\.`, 'i');
    const ERR = /c[oó]digo de seguridad incorrect/i;
    let cap = '';

    for (let i = 1; i <= 3; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }); await wait(800); }
      await plateInput.fill(plate);
      cap = await readCaptcha(solver, img);
      await capInput.fill(cap);
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), submit.click()]);
      let body = '';
      for (let k = 0; k < 25; k++) { await wait(400); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (RESULT.test(body) || ERR.test(body)) break; } // poll 400ms (antes 1000ms), mismo tope ~10s
      if (RESULT.test(body)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const line = body.match(RESULT)![0].replace(/\s+/g, ' ').trim();
        const tiene = /\bs[ií]\b.*orden|tiene orden de captura/i.test(line) && !/no tiene/i.test(line);
        return { ...base, status: tiene ? 'ENCONTRADO' : 'SIN_REGISTRO', summary: line, data: { ordenDeCaptura: tiene, detalle: line, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado tras varios intentos', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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
    await page.goto('https://pagopapeletascallao.pe/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#valor_busqueda').waitFor({ state: 'visible', timeout: 1500 }).catch(() => {}); // en vez de wait(1500) ciego
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
    // Robusto al mojibake del portal ("cÃ³digo de seguridad"): matchea solo el prefijo ASCII.
    const ERR = /error al ingresar/i;
    const NODATA = /no hay resultados para mostrar/i;
    let cap = '';

    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }); await wait(1500); }
      await selectPlaca();
      await valor.fill(plate);
      dialog = '';
      await capImg.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
      await wait(400);
      cap = cleanCallaoCaptcha(await readCaptcha(solver, capImg)); // 3 dígitos: solo dígitos
      await capInput.fill(cap);
      await page.locator('button:has-text("Buscar"), input[value*="Buscar" i]').first().click().catch(() => {});
      // En vez de wait(4500) ciego: sondea hasta el resultado (error, sin datos, o la tabla "Total"); cap 4500ms
      // + settle (Callao pinta la tabla por JS → asegura que la fila "Total" ya está antes de parsear).
      for (let k = 0; k < 14; k++) { const b = (await page.locator('body').innerText().catch(() => '')); if (ERR.test(b) || NODATA.test(b) || /Total\s*:/i.test(b) || /captcha|seguridad/i.test(dialog)) break; await wait(300); }
      await wait(300);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (ERR.test(body) || /captcha|seguridad/i.test(dialog)) continue;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      if (NODATA.test(body)) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin papeletas en Callao', data: { total: '0.00', count: 0, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      // Estructura real (tabla #dataTable): pie "Total : S/ <deuda> S/ <con beneficio>" +
      // "de un total de N registros" + encabezado "Beneficio hasta el dd/mm/aaaa". El 1er monto es
      // la deuda total; el 2º, lo que se paga con el beneficio de pronto pago (columna Beneficio).
      const money = (s: string): number => { const n = parseFloat(String(s).replace(/[^\d.,]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
      const totalM = body.match(/Total\s*:\s*S\/\.?\s*([\d.,]+)(?:\s*S\/\.?\s*([\d.,]+))?/i);
      const total = totalM ? money(totalM[1] ?? '') : 0;
      const benefit = totalM && totalM[2] ? money(totalM[2]) : 0;
      const count = Number(body.match(/total de\s*(\d+)\s*registros/i)?.[1] ?? 0);
      const benefitUntil = body.match(/beneficio\s+hasta\s+el\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
      return { ...base, status: 'ENCONTRADO',
        summary: `Papeletas en Callao: ${count || '?'} · S/ ${total.toFixed(2)}${benefit > 0 ? ` · beneficio S/ ${benefit.toFixed(2)}${benefitUntil ? ` hasta ${benefitUntil}` : ''}` : ''}`,
        data: { total: total > 0 ? total.toFixed(2) : null, count, benefit: benefit > 0 ? benefit : null, benefitUntil, captcha: cap },
        screenshot: shot, ms: Date.now() - t0 };
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado tras varios intentos', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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
    // El portal VIEJO (portal.mtc.gob.pe/reportedgtt/…frmConsultaCITV.aspx) MURIÓ (302 → cuelga 60s).
    // El NUEVO (rec.mtc.gob.pe/Citv/ArConsultaCitv) reusa los MISMOS IDs (#selBUS_Filtro, #texFiltro,
    // #imgCaptcha, #texCaptcha, #btnBuscar) y el MISMO formato de certificado; los errores de captcha
    // llegan por alert (dialog "El Código ingresado no es válido"). Validado en vivo (ADY067, jul-2026).
    await page.goto('https://rec.mtc.gob.pe/Citv/ArConsultaCitv', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const sel = page.locator('#selBUS_Filtro');
    await sel.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {}); // en vez de wait(1200) ciego
    const selectPlaca = async () => { if (await sel.count()) await sel.selectOption({ label: 'Placa' }).catch(() => {}); await wait(500); };
    const img = page.locator('#imgCaptcha');
    const capInput = page.locator('#texCaptcha');
    const plateInput = page.locator('#texFiltro');
    const buscar = page.locator('#btnBuscar');
    // Señal de RESULTADO REAL = un código de certificado CITV (C-AAAA-…). NO uses la cabecera de la
    // tabla ("NRO DE CERTIFICADO"): aparece aunque el resultado esté vacío → daría falso positivo.
    const OK = /\bC-\d{4}-\d/i;
    // "No se encontró información, Verifique." = el vehículo NO tiene CITV (auto nuevo / aún no
    // obligatorio) → SIN_REGISTRO, NO un error. ⚠️ Contiene "Verifique", por eso CAP_ERR ya NO
    // incluye "verifique" (antes lo confundía con captcha rechazado → devolvía ERROR falso).
    const NO_INFO = /no se encontr[oó]|sin informaci[oó]n|no existe/i;
    const CAP_ERR = /captcha|c[oó]digo ingresado|no es v[aá]lid/i;
    let cap = '';

    for (let i = 1; i <= 4; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }); await wait(1200); }
      await selectPlaca();
      await plateInput.fill(plate);
      dialog = '';
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(900); // el #imgCaptcha lo pone JS; deja que termine de renderizar
      cap = await readCaptcha(solver, img);
      await capInput.fill(cap);
      await buscar.click();
      let body = '';
      for (let k = 0; k < 30; k++) { await wait(400); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (OK.test(body) || dialog) break; } // poll 400ms (antes 1000ms), mismo tope ~12s
      // "No se encontró información" = sin CITV (auto nuevo / aún no obligatorio) → SIN_REGISTRO.
      if (NO_INFO.test(dialog)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        return { ...base, status: 'SIN_REGISTRO', summary: `Sin CITV registrado · MTC: "${dialog.trim().slice(0, 70)}"`, data: { mensaje: dialog.trim(), captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      }
      // Captcha rechazado (alert) → reintenta con uno nuevo.
      if (CAP_ERR.test(dialog)) continue;
      if (OK.test(body)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const certs = parseMtcCerts(body, plate);
        const vig = certs.find((c) => /VIGENTE/i.test(c.estado ?? ''));
        // "OBSERVACIONES" del CITV viene con el TIPO DE SERVICIO pegado adelante (ej. "PROVINCIAL
        // TRANSPORTE ESPECIAL DE PERSONAS - TAXI D.1.2-Frenos…"). La observación REAL arranca con un
        // código de defecto (X.N[.N]-). Separamos: tipoServicio (para detectar taxi) + observaciones limpias.
        const rawObs = body.match(/OBSERVACIONES\s+([^\n]{0,160})/i)?.[1]?.trim() ?? null;
        let tipoServicio: string | null = null;
        let observaciones: string | null = rawObs;
        if (rawObs) {
          const codeIdx = rawObs.search(/[A-Z]\.\d/);
          if (codeIdx > 0) {
            tipoServicio = rawObs.slice(0, codeIdx).replace(/[\s\-–]+$/, '').trim() || null;
            observaciones = rawObs.slice(codeIdx).trim() || null;
          } else if (codeIdx === -1 && /^(PARTICULAR|PROVINCIAL|NACIONAL|REGIONAL|DISTRITAL|TRANSPORTE|SERVICIO)/i.test(rawObs)) {
            tipoServicio = rawObs; // solo tipo de servicio, sin defecto observado
            observaciones = null;
          }
        }
        // Lunas polarizadas: el dato legítimo aparece (si aplica) en el CITV; no hay
        // consulta oficial por placa aparte (los sitios "PNP" son terceros no oficiales).
        const lunas = /lunas|polariza|oscurec/i.test(body) ? 'mención en CITV (revisar)' : 'sin mención en CITV';
        return { ...base, status: 'ENCONTRADO', summary: vig ? `CITV ${vig.estado} hasta ${vig.vigenteHasta}` : `${certs.length} certificado(s) CITV`, data: { certificados: certs, tipoServicio, observaciones, lunasPolarizadas: lunas, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      }
      // Captcha ACEPTADO (no hubo alert de captcha) pero SIN certificado → el vehículo no tiene CITV
      // (auto nuevo / aún no obligatorio). Es SIN_REGISTRO, no un error → no reintentes.
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const msg = dialog.trim();
      return { ...base, status: 'SIN_REGISTRO', summary: msg ? `Sin CITV registrado · MTC: "${msg.slice(0, 70)}"` : 'Sin CITV registrado', data: { mensaje: msg || null, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado tras varios intentos', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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

/* ───────────────── APESEG · SOAT en TIEMPO REAL (SPA + API JSON, captcha imagen) ───────────────── */
// El registro de la SBS está CONGELADO ("Información actualizada a: MAYO 2024") → no ve SOAT
// renovados después y los reporta como vencidos. APESEG (soat.com.pe) está al día. Su consulta
// carga un SPA (iframe webapp.apeseg.org.pe/consulta-soat) que llama una API JSON:
//   GET  /captcha-api/api/captcha            → { img (base64), key }
//   POST /captcha-api/api/captcha/verify     { captcha, key } → { valid } (marca la sesión por cookie)
//   POST /consulta-soat/api/login            (creds públicas del SPA) → { access_token }
//   GET  /consulta-soat/api/certificados/placa/{PLACA}  [Bearer]     → [ pólizas con Estado ]
// El captcha se valida por SESIÓN (cookies) y hay protección anti-bot (curl recibe 403), así que
// dejamos que el NAVEGADOR conduzca todo y solo CAPTURAMOS el JSON de la respuesta de `certificados`
// (sin scrapear el DOM). APESEG ya calcula `Estado` (VIGENTE/VENCIDO) por póliza.
export async function runApeseg(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'APESEG_SOAT', label: 'APESEG · SOAT (tiempo real)', category: 'SEGUROS' };
  const toTs = (d?: string): number => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d ?? ''); return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : 0; };
  try {
    // 'domcontentloaded' (NO 'networkidle'): soat.com.pe tiene tráfico de fondo perpetuo (analytics/chat)
    // → 'networkidle' se cuelga 60s aunque la página cargó. Abajo se espera el formulario real (placaInput).
    await page.goto('https://www.soat.com.pe/servicios-soat/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(2500);
    // frameLocator re-resuelve el iframe en cada uso (resiliente a recargas para pedir un captcha nuevo).
    const fl = page.frameLocator('iframe[src*="consulta-soat"], iframe[src*="webapp.apeseg"]');
    const placaInput = fl.locator('#placa, input[placeholder*="laca" i]').first();
    const capInput = fl.locator('#captcha, input[placeholder*="aptcha" i]').first();
    const img = fl.locator('img.captcha-img, img[class*="aptcha" i]').first();

    let certs: Array<Record<string, unknown>> | null = null;
    for (let i = 1; i <= 4 && !certs; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(2000); } // captcha nuevo
      await placaInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(500);
      await placaInput.fill(plate).catch(() => {});
      const cap = await readCaptcha(solver, img);
      await capInput.fill(cap).catch(() => {});
      // Si el captcha es válido, el SPA encadena verify→login→certificados. Capturamos ESA respuesta
      // (el JSON que queremos). Si el captcha falla, no se dispara y el waitForResponse expira → reintenta.
      const respP = page.waitForResponse((r) => /\/certificados\/placa\//i.test(r.url()), { timeout: 15000 }).catch(() => null);
      await fl.locator('button:has-text("Consultar"), button[type="submit"]').first().click().catch(() => {});
      const resp = await respP;
      if (resp && resp.status() === 200) {
        const j: unknown = await resp.json().catch(() => null);
        if (Array.isArray(j)) certs = j as Array<Record<string, unknown>>;
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (!certs) return { ...base, status: 'ERROR', summary: 'captcha/API sin respuesta (4 intentos)', screenshot: shot, ms: Date.now() - t0 };
    if (certs.length === 0) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin SOAT en APESEG', data: {}, screenshot: shot, ms: Date.now() - t0 };

    // APESEG ya marca `Estado`: preferimos la póliza VIGENTE; si no hay, la de fin de vigencia más reciente.
    const g = (c: Record<string, unknown>, k: string): string | null => (c[k] == null ? null : String(c[k]));
    const vig = certs.find((c) => /VIGENTE/i.test(String(c.Estado ?? ''))) ?? certs.slice().sort((a, b) => toTs(String(b.FechaFin)) - toTs(String(a.FechaFin)))[0]!;
    const data = {
      estado: g(vig, 'Estado'), compania: g(vig, 'NombreCompania'), inicio: g(vig, 'FechaInicio'), fin: g(vig, 'FechaFin'),
      certificado: g(vig, 'NumeroPoliza'), uso: g(vig, 'NombreUsoVehiculo'), clase: g(vig, 'NombreClaseVehiculo'), tipo: g(vig, 'TipoCertificado'),
      marca: g(vig, 'Marca'), modelo: g(vig, 'ModeloVehiculo'), asientos: g(vig, 'NumeroAsientos'), total: certs.length,
    };
    return { ...base, status: 'ENCONTRADO', summary: `SOAT ${data.estado ?? ''} · ${data.compania ?? ''} · vig. ${data.fin ?? ''}`.trim(), data, screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── SBS · SINIESTRALIDAD (3 tipos) + CAT taxis (reCAPTCHA v3) ───────────────── */
// El SOAT vigente lo da APESEG (tiempo real; la SBS está congelada en may-2024). De la SBS se usa:
//  (1) la SINIESTRALIDAD: N° de accidentes reportados POR PÓLIZA (con su periodo de vigencia), en los
//      TRES tipos que ofrece el portal — SOAT (_0), Seguro Vehicular (_1) y CAT (_2);
//  (2) el CAT vigente de los taxis (APESEG solo cubre SOAT de particulares).
// Cada tipo = 1 reCAPTCHA v3. Por eso esta fuente corre en PRO/ULTRA (no en la consulta gratis BASIC).
const SBS_SITEKEY = '6Ldq0D0hAAAAAJ2EfmS-gFvA1NprMh2MBcxtRLAL';
const SBS_TABLE_PARSER = `(function(){
  var norm=function(s){return (s||'').replace(/\\s+/g,' ').trim();};
  var tables=Array.prototype.slice.call(document.querySelectorAll('table'));
  for(var ti=0;ti<tables.length;ti++){
    var trs=Array.prototype.slice.call(tables[ti].querySelectorAll('tr'));
    var head=null;
    for(var hi=0;hi<trs.length;hi++){var tx=trs[hi].innerText||'';if(/certificado/i.test(tx)&&/(p[oó]liza|afocat|vigencia)/i.test(tx)){head=trs[hi];break;}}
    if(!head)continue;
    var hc=Array.prototype.slice.call(head.querySelectorAll('th,td')).map(function(c){return norm(c.textContent).toLowerCase();});
    var ix=function(re){for(var i=0;i<hc.length;i++){if(re.test(hc[i]))return i;}return -1;};
    var ci={compania:ix(/compa|afocat/),clase:ix(/clase/),uso:ix(/uso/),accidentes:ix(/accidente/),poliza:ix(/p[oó]liza/),certificado:ix(/certificado/),inicio:ix(/inicio/),fin:ix(/fin/)};
    var out=[];
    for(var ri=0;ri<trs.length;ri++){
      if(trs[ri]===head)continue;
      var cells=Array.prototype.slice.call(trs[ri].querySelectorAll('td')).map(function(c){return norm(c.textContent);});
      if(cells.length<4)continue;
      var g=function(i){return (i>=0&&i<cells.length)?cells[i]:'';};
      var row={compania:g(ci.compania),clase:g(ci.clase),uso:g(ci.uso),accidentes:g(ci.accidentes),poliza:g(ci.poliza),certificado:g(ci.certificado),inicio:g(ci.inicio),fin:g(ci.fin)};
      if(row.compania||row.poliza||row.certificado)out.push(row);
    }
    return out;
  }
  return [];
})()`;
export async function runSbs(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SBS_SOAT', label: 'SBS · siniestralidad (SOAT/Vehicular/CAT) + CAT taxis', category: 'SEGUROS' };
  const URL = 'https://servicios.sbs.gob.pe/reportesoat/';
  const toTs = (d?: string): number => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d ?? ''); return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : 0; };
  type Pol = { tipo: string; compania: string; clase: string; uso: string; accidentes: number; poliza: string; certificado: string; inicio: string; fin: string };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Los 3 tipos del portal. Se consultan TODOS (los siniestros pueden ir bajo cualquiera).
    const TIPOS = [
      { key: 'SOAT', radio: '#ctl00_MainBodyContent_rblOpcionesSeguros_0' },
      { key: 'VEHICULAR', radio: '#ctl00_MainBodyContent_rblOpcionesSeguros_1' },
      { key: 'CAT', radio: '#ctl00_MainBodyContent_rblOpcionesSeguros_2' },
    ];
    const OK = /resultado de (la )?b[uú]squeda|listado de p[oó]lizas|n[uú]mero de accidentes|no se encontr|no registra|no tiene informaci/i;
    const NODATA = /no tiene informaci[oó]n reportada/i;
    let attemptNo = 0;
    let respondedAny = false;
    const allPolizas: Pol[] = [];
    for (const tipo of TIPOS) {
      for (let i = 1; i <= 2; i++) {
        // Reset entre consultas con el enlace "Nueva consulta" del portal (SIN recargar → reCAPTCHA ya
        // inicializado, botón habilitado, sin overlay; un goto re-inicializa reCAPTCHA y bloquea el botón).
        if (attemptNo > 0) {
          const nueva = page.locator('a:has-text("Nueva consulta")').first();
          if (await nueva.count()) { await nueva.click().catch(() => {}); await page.waitForLoadState('domcontentloaded').catch(() => {}); await wait(800); }
          else { await page.goto(URL, { waitUntil: 'domcontentloaded' }); await wait(800); }
        }
        attemptNo++;
        await page.locator(tipo.radio).check().catch(() => {});
        await page.locator('#ctl00_MainBodyContent_txtPlaca').fill(plate);
        const token = await solver.solveRecaptchaV3(SBS_SITEKEY, URL, 'homepage');
        await page.evaluate(
          `(function(tok){function set(s){document.querySelectorAll(s).forEach(function(e){e.value=tok;});}set('#ctl00_MainBodyContent_hdnReCaptchaV3');set('[name="g-recaptcha-response"]');set('#g-recaptcha-response');})(${JSON.stringify(token)})`,
        );
        await page.evaluate("(function(){var b=document.querySelector('#ctl00_MainBodyContent_btnIngresarPla');if(b){b.classList.remove('disabled');b.click();}})()");
        // En vez de wait(5000) ciego (corre ×3 tipos → 15s fijos): la SBS es ASP.NET (postback renderiza
        // la tabla completa server-side), así que sondeamos la señal OK y salimos apenas llega; cap ~5s +
        // settle para asegurar la tabla pintada antes del SBS_TABLE_PARSER.
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        for (let k = 0; k < 16; k++) { const b = (await page.locator('body').innerText().catch(() => '')); if (OK.test(b)) break; await wait(300); }
        await wait(400);
        const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
        if (!OK.test(body)) continue; // reCAPTCHA rechazado / sin respuesta → reintenta este tipo
        respondedAny = true;
        if (NODATA.test(body)) break; // este tipo sin datos → siguiente tipo
        const rows = (await page.evaluate(SBS_TABLE_PARSER)) as Array<Record<string, string>>;
        for (const r of rows) allPolizas.push({ tipo: tipo.key, compania: r.compania ?? '', clase: r.clase ?? '', uso: r.uso ?? '', accidentes: parseInt((r.accidentes ?? '').replace(/\D/g, ''), 10) || 0, poliza: r.poliza ?? '', certificado: r.certificado ?? '', inicio: r.inicio ?? '', fin: r.fin ?? '' });
        break; // tipo resuelto → siguiente tipo
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (!respondedAny) return { ...base, status: 'ERROR', summary: 'reCAPTCHA v3 rechazado (sin respuesta)', screenshot: shot, ms: Date.now() - t0 };

    // Vigente por tipo (para la sección Seguros: CAT de taxis, y SOAT SBS de respaldo).
    const pick = (t: string): Pol | null => allPolizas.filter((p) => p.tipo === t).sort((a, b) => toTs(b.fin) - toTs(a.fin))[0] ?? null;
    const cat = pick('CAT'); const soat = pick('SOAT');
    const catVigente = cat ? toTs(cat.fin) >= Date.now() - 864e5 : false;
    const soatVigente = soat ? toTs(soat.fin) >= Date.now() - 864e5 : false;
    // Siniestralidad: pólizas con accidentes>0 → cada una es un PERIODO con N° de siniestros.
    const siniestros = allPolizas.filter((p) => p.accidentes > 0)
      .map((p) => ({ tipo: p.tipo, aseguradora: p.compania || null, desde: p.inicio || null, hasta: p.fin || null, cantidad: p.accidentes }))
      .sort((a, b) => toTs(b.hasta ?? undefined) - toTs(a.hasta ?? undefined));
    const totalSiniestros = allPolizas.reduce((s, p) => s + p.accidentes, 0);

    return {
      ...base,
      status: 'ENCONTRADO',
      summary: `${allPolizas.length} póliza(s) · ${totalSiniestros} siniestro(s)${catVigente ? ' · CAT vig.' : ''}${soatVigente ? ' · SOAT vig. (SBS)' : ''}`,
      data: {
        polizas: allPolizas, cat, soat, catVigente, soatVigente,
        totalSiniestros, siniestros, accidentes: totalSiniestros,
      },
      screenshot: shot,
      ms: Date.now() - t0,
    };
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
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(2000);
    const menuFrame = page.frames().find((f) => /bienvenida/i.test(f.url())) ?? page.mainFrame();
    const link = menuFrame.locator('a[href*="papeletas.aspx"]').first();
    if (await link.count()) { await link.click(); for (let k = 0; k < 12; k++) { if (await findFrameWith(page, '#tipoBusquedaPapeletas')) break; await wait(300); } } // en vez de wait(3500): sale al aparecer el form
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
    // En vez de wait(6000) ciego: sondea el frame de resultado hasta que aparezca la respuesta (SAT es
    // ASP.NET, postback server-side); cap 6000ms + settle antes de parsear las papeletas.
    for (let k = 0; k < 19; k++) {
      const rf = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
      const b = (await rf.locator('body').innerText().catch(() => ''));
      if (/no se encontraron papeletas|papeleta|infracci[oó]n|S\/\s*[0-9]/i.test(b)) break;
      await wait(300);
    }
    await wait(400);
    const resultFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
    const body = (await resultFrame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (new RegExp(`no se encontraron papeletas[^.]*${plate}`, 'i').test(body) || /no se encontraron papeletas/i.test(body)) {
      return { ...base, status: 'SIN_REGISTRO', summary: 'Sin papeletas pendientes en Lima', screenshot: shot, ms: Date.now() - t0 };
    }
    if (/papeleta|infracci[oó]n|S\/\s*[0-9]/i.test(body)) {
      const detalle = parseSatPapeletasItems(body);
      const { montoTotal: montoRx, count: countRx } = parseSatPapeletasMontos(body);
      // Prefiere la suma de los importes por papeleta (más fiable que sumar todo "S/ n" del texto,
      // que incluye descuentos/totales). Si el detalle no calzó, cae al regex antiguo.
      const montoItems = Math.round(detalle.reduce((a, d) => a + (d.monto ?? 0), 0) * 100) / 100;
      const montoTotal = montoItems > 0 ? montoItems : montoRx;
      const count = detalle.length || countRx;
      // SAT_DEBUG=1 → vuelca el HTML real del resultado (para fijar el parser de filas como fixture).
      if (process.env.SAT_DEBUG) {
        try { const { writeFileSync } = await import('node:fs'); writeFileSync(`sat-result-${plate}.html`, await resultFrame.content(), 'utf8'); } catch { /* noop */ }
      }
      const montoTxt = montoTotal > 0 ? ` · S/ ${montoTotal.toFixed(2)}` : '';
      return { ...base, status: 'ENCONTRADO', summary: `Papeletas pendientes en Lima${count ? ` (${count})` : ''}${montoTxt}`, data: { montoTotal, count, detalle, texto: body.slice(0, 6000) }, screenshot: shot, ms: Date.now() - t0 };
    }
    return { ...base, status: 'ERROR', summary: 'Respuesta no reconocida', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── ATU · Taxi/transporte (captcha imagen) ───────────────── */
// El portal migró a soluciones.atu.gob.pe (antes sistemas.atu.gob.pe). Form: placa +
// código de verificación (imagen) + "Buscar". Si la placa está habilitada, muestra
// modalidad, titular y tarjeta de circulación con vigencia. SELECTORES POR VALIDAR EN VIVO.
export async function runAtu(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'ATU', label: 'ATU · Taxi/transporte', category: 'TRANSPORTE' };
  const ATU_URL = 'https://soluciones.atu.gob.pe/ConsultaVehiculo';
  try {
    await page.goto(ATU_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1500);
    // Banner de cookies: si NO se acepta, el portal no deja escribir la placa.
    const acceptCookies = async (): Promise<void> => {
      await page.locator('button:has-text("Acepto cookies"), button:has-text("Aceptar"), button:has-text("Acepto"), a:has-text("Acepto cookies")').first().click({ timeout: 5000 }).catch(() => {});
    };
    await acceptCookies();
    await wait(600);
    let cap = '';
    const plateInput = page.locator('input#placa, input[name*="laca" i], input[placeholder*="laca" i], input[formcontrolname*="laca" i]').first();
    // ATU protege la consulta con reCAPTCHA (no captcha de imagen). Hay que resolverlo e
    // inyectar el token; si no, sale "Verificar re-captcha" y el form NO devuelve datos.
    // Detecta sitekey y TIPO (v3 = script api.js?render=KEY; v2 = data-sitekey o iframe ?k=KEY).
    const getRc = async (): Promise<{ key: string; type: string }> => {
      const raw = String((await page.evaluate(
        `(function(){var s='',t='';var scr=document.querySelector('script[src*="recaptcha/api.js?render="]');if(scr){var m=(scr.getAttribute('src')||'').match(/render=([^&]+)/);if(m&&m[1]&&m[1]!=='explicit'){s=m[1];t='v3';}}if(!s){var el=document.querySelector('[data-sitekey]');if(el){s=el.getAttribute('data-sitekey')||'';t='v2';}}if(!s){var ifr=document.querySelector('iframe[src*="recaptcha"]');var src=ifr?(ifr.getAttribute('src')||''):'';var mm=src.match(/[?&]k=([^&]+)/);if(mm){s=mm[1];t='v2';}}return s+'|'+t;})()`,
      ).catch(() => '')) || '|');
      const parts = raw.split('|');
      return { key: parts[0] || '', type: parts[1] || '' };
    };

    for (let i = 1; i <= 3; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }); await wait(1500); await acceptCookies(); await wait(400); }
      await plateInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await plateInput.fill(plate);
      const rc = await getRc();
      cap = rc.key ? `${rc.type || 'v?'}:${rc.key.slice(0, 6)}…` : 'sin-sitekey';
      if (rc.key) {
        try {
          const token = rc.type === 'v3'
            ? await solver.solveRecaptchaV3(rc.key, ATU_URL, 'consultar')
            : await solver.solveRecaptchaV2(rc.key, ATU_URL);
          // ATU usa reCAPTCHA v3/invisible: el form llama grecaptcha.execute() al enviar.
          // Stub-eamos execute/ready para devolver NUESTRO token + rellenamos el textarea.
          await page.evaluate(
            `(function(tok){document.querySelectorAll('textarea#g-recaptcha-response,textarea[name="g-recaptcha-response"]').forEach(function(e){e.value=tok;e.style.display='block';});try{window.grecaptcha=window.grecaptcha||{};window.grecaptcha.ready=function(cb){if(cb)cb();};window.grecaptcha.execute=function(){return Promise.resolve(tok);};if(window.grecaptcha.enterprise){window.grecaptcha.enterprise.ready=window.grecaptcha.ready;window.grecaptcha.enterprise.execute=window.grecaptcha.execute;}}catch(e){}window.__atuToken=tok;})(${JSON.stringify(token)})`,
          ).catch(() => {});
          cap += '+token';
        } catch { cap += '+solveERR'; /* saldrá "Verificar re-captcha" → reintenta */ }
      }
      await page.locator('button:has-text("Buscar"), button[type="submit"]').first().click().catch(() => {});
      await wait(6000);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      // Los campos del resultado son inputs readonly: sus valores NO salen en innerText.
      const fieldVals = String((await page.evaluate(
        `Array.from(document.querySelectorAll('input')).map(function(i){return i.value}).filter(function(v){return v&&v.trim()}).join(' | ')`,
      ).catch(() => '')) || '');
      const blob = `${body} | ${fieldVals}`;
      if (/verificar\s*re-?captcha/i.test(body)) continue; // reCAPTCHA no aceptado → reintenta
      const done = /consultar otra placa|fecha y hora de consulta/i.test(body); // la búsqueda se completó
      if (!done) continue;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      if (/no\s*registrad/i.test(blob)) {
        return { ...base, status: 'SIN_REGISTRO', summary: 'No figura como taxi/transporte (ATU: NO REGISTRADO)', data: { isPublicTransport: false, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      }
      const atu = parseAtuFields(fieldVals);
      return { ...base, status: 'ENCONTRADO', summary: `Habilitado: ${atu.modalidad ?? 'transporte'}`, data: { isPublicTransport: true, modalidad: atu.modalidad, estado: atu.estado, titular: atu.titular, detalleCampos: fieldVals, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'No se pudo resolver el reCAPTCHA de ATU (o respuesta no reconocida)', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

// Los campos del resultado ATU son inputs readonly; parseamos sus VALORES (unidos por ' | ').
// Ej. real: "SERVICIO DE TAXI EJECUTIVO", "Habilitado hasta 29/09/2026", "GESTIONES Y SERVICIOS … EIRL".
export function parseAtuFields(vals: string): {
  modalidad: string | null; estado: string | null; titular: string | null;
  documento: string | null; vigencia: string | null;
} {
  const arr = vals.split(' | ').map((s) => s.trim()).filter(Boolean);
  const find = (re: RegExp): string | null => arr.find((v) => re.test(v)) ?? null;
  const modalidad = find(/taxi|servicio de|transporte|colectivo|escolar|cuna|mercanc/i);
  // Estado = la frase del resultado ("El vehículo está habilitado…"); NO la vigencia (que también
  // dice "Habilitado …"). Por eso se busca la oración, no solo la palabra "habilitado".
  const estado = find(/veh[ií]culo est[aá]|no registrad|no figura|vencid|suspend|inhabilit/i)
    ?? find(/habilitado para prestar/i);
  const vigencia = find(/habilitado hasta|vigencia|vence/i);
  // Documento del titular: "DNI - 08701061", "RUC 20…".
  const docField = find(/\b(DNI|RUC|C\.?E\.?|CARN|PASAPORTE|PAS)\b\s*[-:]?\s*[0-9A-Z]/i);
  const docMatch = docField?.match(/\b(DNI|RUC|C\.?E\.?|CARN\w*|PASAPORTE|PAS)\b\s*[-:]?\s*([0-9A-Z]{6,})/i);
  const documento = docMatch ? `${docMatch[1]!.toUpperCase().replace(/[^A-Z]/g, '')} ${docMatch[2]}` : null;
  // Titular: empresa (patrón societario) o persona (nombre en MAYÚSCULAS, normalmente tras el doc).
  const empresa = arr.find((v) => /(E\.?I\.?R\.?L|S\.?A\.?C|S\.?R\.?L|SOCIEDAD|SERVICIOS|TRANSPORTES|GESTIONES|S\.?A\b)/i.test(v) && v !== modalidad) ?? null;
  let persona: string | null = null;
  if (docField) {
    const next = arr[arr.indexOf(docField) + 1];
    if (next && /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]{4,}$/.test(next) && !/(veh[ií]culo|habilitad|servicio|consulta)/i.test(next)) persona = next;
  }
  const titular = empresa ?? persona;
  return { modalidad, estado, titular, documento, vigencia };
}

/**
 * Extrae el monto pendiente de papeletas del texto del resultado de SAT Lima.
 * Best-effort: prefiere una línea "TOTAL S/ …" si el portal la muestra; si no,
 * suma todos los importes "S/ n" hallados. El dato es referencial (lo aclara el
 * disclaimer del reporte). `count` = n° de importes detectados.
 */
function parseSatPapeletasMontos(body: string): { montoTotal: number; count: number } {
  const toNum = (s: string): number => parseFloat(s.replace(/,/g, '')) || 0;
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const total = body.match(/TOTAL[^S]{0,20}S\/\.?\s*([0-9][0-9.,]*)/i);
  const montos = [...body.matchAll(/S\/\.?\s*([0-9][0-9.,]*)/gi)].map((m) => toNum(m[1] ?? '')).filter((n) => n > 0);
  if (total) return { montoTotal: round2(toNum(total[1] ?? '')), count: montos.length };
  return { montoTotal: round2(montos.reduce((a, b) => a + b, 0)), count: montos.length };
}

/**
 * Extrae papeletas INDIVIDUALES del texto del resultado de SAT Lima. El grid del portal
 * (`innerText`, con tabs→espacio y filas por salto de línea) tiene las columnas:
 *   Placa · Reglamento · Falta · N° Documento · Fecha Infracción · Importe · Gastos · Descuento · Deuda · Estado · …
 * Ej. real (CDK293): `CDK293 RNT M20a E3761377 25/07/2025 990.00 0.00 0.00 990.00 Pendiente …`.
 * ⚠️ El importe NO trae "S/" (es un decimal pelado). Se ancla cada fila por su **fecha de
 * infracción** (dd/mm/aaaa) seguida de ≥1 decimal `n.dd`; así se descartan cabeceras y la línea
 * "Fecha de consulta" (día de 1 dígito / sin importes). N° Documento / Falta / Reglamento salen
 * de las columnas ANTES de la fecha; el monto es la **Deuda** (4º decimal) o el Importe.
 */
export function parseSatPapeletasItems(bodyRaw: string): PapeletaDetalle[] {
  const toNum = (s: string): number => Math.round((parseFloat(String(s).replace(/,/g, '')) || 0) * 100) / 100;
  const RX_ESTADO = /(en cobranza coactiva|cobranza coactiva|pendiente|coactiv\w*|firme|reclamad\w*|impugnad\w*|fraccionad\w*|pagad\w*)/i;
  const rows: PapeletaDetalle[] = [];
  for (const raw of bodyRaw.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const tokens = line.split(' ');
    const di = tokens.findIndex((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t)); // fecha de infracción (2 dígitos día)
    if (di < 1) continue;
    const decimals = tokens.slice(di + 1).filter((t) => /^\d[\d,]*\.\d{2}$/.test(t)); // Importe·Gastos·Descuento·Deuda
    if (!decimals.length) continue; // sin importes → cabecera / "Fecha de consulta"
    const importe = toNum(decimals[0] ?? '0');
    const deuda = toNum(decimals[3] ?? decimals[decimals.length - 1] ?? decimals[0] ?? '0');
    const numero = (tokens[di - 1] || '').trim() || null;      // N° Documento (p. ej. E3761377)
    const falta = (tokens[di - 2] || '').trim() || null;       // código de Falta (M20a)
    const reglamento = tokens[di - 3] ?? '';                   // RNT, RNTV, etc.
    const infraccion = [/^[A-ZÑ]{2,6}$/.test(reglamento) ? reglamento : null, falta].filter(Boolean).join(' ') || null;
    const estado = RX_ESTADO.exec(line)?.[1] ?? null;
    rows.push({ numero, fecha: tokens[di]!, infraccion, monto: deuda || importe || null, estado });
  }
  return rows;
}
