/* eslint-disable no-console */
import type { Page, Frame, Locator, Response } from 'playwright';
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
    // Si tras los reintentos la imagen sigue vacía/mínima, NO la mandes a CapSolver (daría un 400
    // engañoso "HTTP 400"): lanza un error CLARO que dice que el portal no sirvió la imagen. Así el
    // log distingue "imagen no cargó" (lado nuestro/portal) de "CapSolver rechazó una imagen válida".
    if (buf.length <= 500) throw new Error(`imagen de captcha vacía/no cargó (${buf.length} bytes) — el portal no la sirvió`);
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

    let sawForm = false;
    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(1500); }
      // El portal a ratos sirve la página SIN el formulario (caído/lento del lado del server): si el
      // input no aparece, recarga y reintenta DENTRO del bucle. Antes el fill lanzaba su timeout de 30s
      // y mataba la fuente al primer golpe sin usar los 5 reintentos (CWC611, 12-ago-2026 — el portal
      // estaba vivo minutos después con el mismo DOM).
      const visible = await valor.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      if (!visible) continue;
      sawForm = true;
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
    // Mensaje honesto según lo que pasó: formulario nunca cargó (portal caído) ≠ captcha rechazado.
    return { ...base, status: 'ERROR',
      summary: sawForm ? 'Captcha rechazado tras varios intentos' : 'El formulario del portal de Callao no cargó (portal caído o lento) — reintentar más tarde',
      data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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

    // INSTRUMENTACIÓN: el SPA encadena captcha(imagen)→verify→login→certificados, PERO desde ago-2026
    // exige además un **Cloudflare Turnstile** ("Complete la validación de seguridad"): sin su token el
    // verify del captcha de imagen puede pasar (valid:true) y aun así NO se dispara login/certificados
    // (validado local, IP residencial → NO es bloqueo de IP). Por eso resolvemos el Turnstile con CapSolver
    // (igual que SUNARP), inyectamos `cf-turnstile-response` y reciclamos ese token entre reintentos del
    // captcha de imagen (la imagen se refresca sola tras "Captcha incorrecto"; el token sobrevive al fallo).
    const api: Record<string, number> = {};
    const onResp = (r: Response): void => {
      const u = r.url();
      const k = /captcha\/verify/i.test(u) ? 'verify'
        : /\/certificados\/placa\//i.test(u) ? 'certs'
          : /consulta-soat\/api\/login/i.test(u) ? 'login'
            : /captcha-api\/api\/captcha/i.test(u) ? 'captcha' : '';
      if (k) api[k] = r.status();
    };
    page.on('response', onResp);

    // Localiza el frame del SPA (webapp.apeseg) y el sitekey del Turnstile (del iframe de Cloudflare).
    const findSpa = async (): Promise<Frame | null> => {
      for (let k = 0; k < 24; k++) { const f = page.frames().find((fr) => /consulta-soat|webapp\.apeseg/i.test(fr.url())); if (f) return f; await wait(500); }
      return null;
    };
    const findSitekey = async (): Promise<string | null> => {
      for (let k = 0; k < 24; k++) { const f = page.frames().find((fr) => /challenges\.cloudflare\.com/i.test(fr.url())); const m = f && /\/(0x[A-Za-z0-9_]+)\//.exec(f.url()); if (m) return m[1]!; await wait(500); }
      return null;
    };
    // Turnstile con tope de tiempo (el poll de CapSolver puede llegar a 120s; lo acotamos a ~55s).
    const solveTsCapped = (sitekey: string, url: string): Promise<string> => Promise.race([
      solver.solveTurnstile(sitekey, url).catch(() => ''),
      new Promise<string>((res) => setTimeout(() => res(''), 55000)),
    ]);

    const diag: string[] = [];
    let capErr = '';
    let tsDiag = '';
    let certs: Array<Record<string, unknown>> | null = null;

    // Hasta 2 RONDAS: cada ronda = (re)carga + Turnstile fresco. Dentro, varios intentos del captcha de
    // imagen SIN recargar (reusando el token). La 1ª ronda usa la carga inicial; la 2ª recarga (fallback).
    for (let round = 1; round <= 2 && !certs; round++) {
      if (round > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(2500); }
      const spa = await findSpa();
      if (!spa) { diag.push(`r${round}[sin-frame-spa]`); continue; }
      const placaInput = spa.locator('#placa, input[placeholder*="laca" i]').first();
      const capInput = spa.locator('#captcha, input[placeholder*="aptcha" i]').first();
      const img = spa.locator('img.captcha-img, img[class*="aptcha" i], img[src*="captcha" i]').first();
      const btn = spa.locator('button:has-text("Consultar"), button[type="submit"]').first();
      const pv = await placaInput.waitFor({ state: 'visible', timeout: 20000 }).then(() => 1).catch(() => 0);
      await placaInput.fill(plate).catch(() => {});

      // Resuelve el Turnstile de esta ronda e inyecta el token en el hidden del SPA.
      const sitekey = await findSitekey();
      let token = '';
      if (sitekey) { token = await solveTsCapped(sitekey, spa.url()); }
      tsDiag = `ts=${sitekey ? (token ? `ok(${token.length})` : 'sin-token') : 'sin-sitekey'}`;
      const injectTs = (): Promise<void> => token
        ? spa.evaluate((tk) => { document.querySelectorAll('input[name="cf-turnstile-response"],textarea[name="cf-turnstile-response"]').forEach((el) => { (el as HTMLInputElement).value = tk; }); }, token).catch(() => {})
        : Promise.resolve();

      for (let i = 1; i <= 4 && !certs; i++) {
        const iv = await img.waitFor({ state: 'visible', timeout: 15000 }).then(() => 1).catch(() => 0);
        await wait(400);
        // readCaptcha LANZA si la imagen no cargó → lo atrapamos por intento (antes abortaba todo).
        let cap = '';
        try { cap = await readCaptcha(solver, img); } catch (e) { capErr = (e as Error).message; }
        await capInput.fill('').catch(() => {});
        await capInput.fill(cap).catch(() => {});
        await injectTs(); // re-inyecta el token JUSTO antes del clic (el widget puede pisarlo)
        // Con captcha válido + Turnstile presente el SPA encadena verify→login→certificados: capturamos ESA
        // respuesta. Si el captcha falla, no se dispara y el waitForResponse expira → la imagen se refresca.
        const respP = page.waitForResponse((r) => /\/certificados\/placa\//i.test(r.url()), { timeout: 15000 }).catch(() => null);
        await btn.click().catch(() => {});
        const resp = await respP;
        diag.push(`r${round}a${i}[pv=${pv} iv=${iv} cap="${cap}"(${cap.length}) certs=${resp ? resp.status() : 'none'}]`);
        if (resp && resp.status() === 200) {
          const j: unknown = await resp.json().catch(() => null);
          if (Array.isArray(j)) certs = j as Array<Record<string, unknown>>;
        } else { await wait(1500); } // deja al SPA refrescar la imagen de captcha
      }
    }
    page.off('response', onResp);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (!certs) {
      const detail = `${diag.join(' ')} · ${tsDiag} · api:${JSON.stringify(api)}${capErr ? ` · capErr:${capErr}` : ''}`;
      return { ...base, status: 'ERROR', summary: `captcha/Turnstile/API sin respuesta · ${detail}`, screenshot: shot, ms: Date.now() - t0 };
    }
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

/* ─────── SAT Lima · Impuesto vehicular (VALIDA el pago, POR PLACA) ─────── */
// Capa B del impuesto vehicular: confirma cuánto se pagó / queda pendiente (la Capa A solo estima).
// Flujo REAL (probe `probe-sat-impuesto.ts`, ago-2026): entrar por un módulo → redirige a principal.aspx
// con `mysession`; de la reja se toma el link "Tributo detalles" (tributosRef.aspx?tri=V = Vehicular) que
// trae la sesión → form ASP.NET: select `#tipoBusqueda`=`divBuscaPlaca` + placa + captcha imagen (CapSolver)
// → grid `grdAdministrados` con los CONTRIBUYENTES de esa placa (puede haber >1: dueños distintos). Se
// clica cada uno → pantalla de cuotas (`grdEstadoCuenta`); el filtro `ddlEstado` (1=Pendiente, 2=Cancelado,
// NO hay "Todos") se consulta en ambos + Actualizar. Se filtran las filas por la placa (col Referencia).
// PII: NO se exponen los nombres de los contribuyentes (terceros) — solo las cuotas por placa.
export interface SatCuota { year: number; cuota: string; total: number; pagado: number; deuda: number; vencimiento: string | null; estado: 'pendiente' | 'pagado'; tipo: 'impuesto' | 'multa' }
const impMoney = (s: unknown): number => { const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };

export async function runSatImpuesto(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SAT_IMPUESTO', label: 'SAT Lima · Impuesto vehicular', category: 'IMPUESTO' };
  // Lee una tabla ASP.NET por id → matriz de celdas (sin helpers nombrados dentro del evaluate: __name).
  const readGrid = (id: string): Promise<string[][]> => page.evaluate((tid) => {
    const t = document.getElementById(tid);
    if (!t) return [] as string[][];
    return Array.from(t.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()));
  }, id).catch(() => [] as string[][]);
  try {
    // freshSession: entra por BusquedaTributario.aspx → principal.aspx (mint de un mysession NUEVO) → toma
    // el link "Tributo detalles" (tributosRef.aspx?tri=V con ESE mysession) y navega al form. Se llama por
    // CADA contribuyente: el mysession es de UN SOLO USO (re-visitar la misma URL tras abrir cuotas da form
    // vacío — visto en CHU444 c1) → cada contribuyente necesita una sesión fresca.
    const freshSession = async (): Promise<boolean> => {
      await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      for (const fr of page.frames()) {
        const href = await fr.locator('a[href*="tributosRef.aspx?tri=V"]').first().getAttribute('href').catch(() => null);
        if (href) { await page.goto(new URL(href, fr.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); return true; }
      }
      return false;
    };

    // fillSearch: sobre el FORM YA cargado (freshSession). Elige "por placa", resuelve captcha y Buscar → grid.
    const fillSearch = async (): Promise<{ ok: boolean; contribs: number; cap: string; diag: string }> => {
      await page.locator('#tipoBusqueda').selectOption('divBuscaPlaca').catch(() => {});
      await wait(700);
      // Espera ACOTADA del captcha: si el elemento no aparece, NO llamamos readCaptcha (que colgaría
      // ~30s por llamada esperando el elemento → los 823s vistos). Diagnóstico de por qué no cargó.
      const capImg = page.locator('img.captcha_class').first();
      const hasCap = await capImg.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
      if (!hasCap) {
        const nSel = await page.locator('#tipoBusqueda').count().catch(() => 0);
        const nPla = await page.locator('#ctl00_cplPrincipal_txtPlaca').count().catch(() => 0);
        const nImg = await page.locator('img.captcha_class').count().catch(() => 0);
        return { ok: false, contribs: 0, cap: '', diag: `sin captcha · url=${page.url().slice(0, 100)} sel=${nSel} placa=${nPla} img=${nImg} frames=${page.frames().length}` };
      }
      await page.locator('#ctl00_cplPrincipal_txtPlaca').fill(plate).catch(() => {});
      let cap = '';
      try { cap = await readCaptcha(solver, capImg); } catch (e) { return { ok: false, contribs: 0, cap: '', diag: `readCaptcha: ${(e as Error).message}` }; }
      await page.locator('#ctl00_cplPrincipal_txtCaptcha').fill(cap).catch(() => {});
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), page.locator('#ctl00_cplPrincipal_CaptchaContinue').click().catch(() => {})]);
      let body = '';
      for (let k = 0; k < 25; k++) { await wait(400); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); const rows = await readGrid('ctl00_cplPrincipal_grdAdministrados'); if (rows.length > 1 || /c[oó]digo de seguridad incorrect|no se (ha\s+)?encontr|no existe/i.test(body)) break; }
      if (/c[oó]digo de seguridad incorrect/i.test(body)) return { ok: false, contribs: 0, cap, diag: 'captcha incorrecto' };
      const rows = await readGrid('ctl00_cplPrincipal_grdAdministrados');
      return { ok: true, contribs: Math.max(0, rows.length - 1), cap, diag: '' };
    };

    // readCuotas: en la pantalla de cuotas, filtra por estado (1=Pendiente, 2=Cancelado) + Actualizar y parsea
    // grdEstadoCuenta. Columnas: 0 Año · 1 Cuota · 3 Total Deuda · 6 Pagado · 7/8 Deuda · 9 Vencimiento · 16 Referencia.
    const readCuotas = async (estado: '1' | '2'): Promise<SatCuota[]> => {
      await page.locator('#ctl00_cplPrincipal_ddlEstado').selectOption(estado).catch(() => {});
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), page.locator('#ctl00_cplPrincipal_btnBuscar').click().catch(() => {})]);
      await wait(1200);
      const out: SatCuota[] = [];
      // La grilla PAGINA (visto en CHU444: los pagos caen en 2 páginas). Recorremos las páginas del GridView
      // vía __doPostBack('...grdEstadoCuenta','Page$N') hasta que no exista el enlace de la siguiente página.
      for (let pageNo = 1; pageNo <= 12; pageNo++) {
        for (const r of (await readGrid('ctl00_cplPrincipal_grdEstadoCuenta')).slice(1)) {
          const ref = r[16] ?? r[r.length - 1] ?? '';
          if (!ref.includes(plate)) continue;
          const year = parseInt(r[0] ?? '', 10);
          if (!Number.isFinite(year)) continue;
          // La Referencia distingue el concepto: "Placa - Motor: ..." = cuota del impuesto;
          // "Multa : 406 - Imp. Vehicular ... No presentar las declaraciones" = sanción por omiso.
          const tipo: 'impuesto' | 'multa' = /multa/i.test(ref) ? 'multa' : 'impuesto';
          out.push({ year, cuota: r[1] ?? '', total: impMoney(r[3]), pagado: impMoney(r[6]), deuda: impMoney(r[7]) || impMoney(r[8]), vencimiento: r[9] || null, estado: estado === '1' ? 'pendiente' : 'pagado', tipo });
        }
        // ¿Hay enlace a la página siguiente en el pager del grid? Si sí, postback y seguimos; si no, cortamos.
        const advanced = await page.evaluate((next) => {
          const grid = document.getElementById('ctl00_cplPrincipal_grdEstadoCuenta');
          if (!grid) return false;
          const l = Array.from(grid.querySelectorAll('a')).find((a) => (a.getAttribute('href') || '').includes('Page$' + next));
          if (!l) return false;
          const m = /__doPostBack\('([^']+)','([^']+)'\)/.exec(l.getAttribute('href') || '');
          const w = window as unknown as { __doPostBack?: (t: string, a: string) => void };
          if (m && m[1] && m[2] && typeof w.__doPostBack === 'function') { w.__doPostBack(m[1], m[2]); return true; }
          (l as HTMLElement).click(); return true;
        }, pageNo + 1).catch(() => false);
        if (!advanced) break;
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await wait(900);
      }
      return out;
    };

    // 2. Sesión fresca + Buscar. Reintenta el captcha en el MISMO form; si el form no carga, sesión nueva.
    if (!(await freshSession())) return { ...base, status: 'ERROR', summary: 'no se estableció la sesión del SAT', ms: Date.now() - t0 };
    let search = await fillSearch();
    for (let i = 0; i < 3 && !search.ok; i++) { if (search.diag.startsWith('sin captcha')) await freshSession(); search = await fillSearch(); }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (!search.ok) return { ...base, status: 'ERROR', summary: `SAT impuesto no disponible · ${search.diag}`, data: { captcha: search.cap }, screenshot: shot, ms: Date.now() - t0 };
    if (search.contribs === 0) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin registro de impuesto vehicular en SAT Lima', data: { found: false }, screenshot: shot, ms: Date.now() - t0 };

    // 3. Iterar contribuyentes (cada uno cuesta 1 captcha por el re-search): cuotas pendientes + canceladas.
    const N = Math.min(search.contribs, 5);
    const all: SatCuota[] = [];
    const diag: string[] = [`contribs=${search.contribs}`];
    for (let i = 0; i < N; i++) {
      if (i > 0) {
        // Sesión FRESCA por contribuyente (el mysession es de un solo uso; re-visitar la URL da form vacío).
        if (!(await freshSession())) { diag.push(`c${i}:no-session`); break; }
        const s = await fillSearch();
        if (!s.ok || s.contribs <= i) { diag.push(`c${i}:research-fail(ok=${s.ok} contribs=${s.contribs} ${s.diag})`); break; }
      }
      const ctl = `ctl${String(i + 2).padStart(2, '0')}`;
      const link = page.locator(`#ctl00_cplPrincipal_grdAdministrados_${ctl}_lnkNombre`);
      const linkN = await link.count().catch(() => 0);
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), link.click().catch(() => {})]);
      await wait(1000);
      const p1 = await readCuotas('1');
      const p2 = await readCuotas('2');
      const rawRows = (await readGrid('ctl00_cplPrincipal_grdEstadoCuenta')).length;
      diag.push(`c${i}(${ctl}):link=${linkN} rows=${rawRows} pend=${p1.length} pag=${p2.length}`);
      all.push(...p1, ...p2);
    }
    // Dedupe por (año, cuota, estado, TIPO) — un contribuyente puede repetirse entre re-búsquedas, y una
    // MULTA puede compartir año+cuota con la cuota del impuesto (CHU444: 2024-1 impuesto S/119.44 y multa
    // S/261.44) → sin el tipo en la clave se perdería una de las dos filas.
    const seen = new Set<string>();
    const dedup = all.filter((c) => { const k = `${c.year}-${c.cuota}-${c.estado}-${c.tipo}`; if (seen.has(k)) return false; seen.add(k); return true; });
    // Separar el IMPUESTO (cuotas) de las MULTAS (sanción por omiso): se reportan por separado.
    const impuesto = dedup.filter((c) => c.tipo === 'impuesto');
    const multas = dedup.filter((c) => c.tipo === 'multa');
    // La "CuotaÚnica" (cuota "0") es el AGREGADO de las cuotas impagas del año (pagar todo de una): si el
    // mismo año/estado trae cuotas individuales, se DESCARTA para NO duplicar el monto (193.96 = 96.98×2).
    const hasIndiv = new Set(impuesto.filter((c) => c.cuota !== '0').map((c) => `${c.year}-${c.estado}`));
    const cuotas = impuesto.filter((c) => c.cuota !== '0' || !hasIndiv.has(`${c.year}-${c.estado}`));
    const pending = cuotas.filter((c) => c.estado === 'pendiente');
    const paid = cuotas.filter((c) => c.estado === 'pagado');
    const pendingTotal = Math.round(pending.reduce((s, c) => s + (c.deuda || c.total), 0) * 100) / 100;
    // Total YA pagado: el SAT expone el monto abonado por cuota cancelada (col. Pagado; cae al Total si viene 0).
    const paidTotal = Math.round(paid.reduce((s, c) => s + (c.pagado || c.total), 0) * 100) / 100;
    const paidYears = [...new Set(paid.map((c) => c.year))].sort((a, b) => a - b);
    const pendingYears = [...new Set(pending.map((c) => c.year))].sort((a, b) => a - b);
    // Multa (declaración extemporánea / omiso): totales pagado y pendiente por separado del impuesto.
    const multaPaidTotal = Math.round(multas.filter((c) => c.estado === 'pagado').reduce((s, c) => s + (c.pagado || c.total), 0) * 100) / 100;
    const multaPendingTotal = Math.round(multas.filter((c) => c.estado === 'pendiente').reduce((s, c) => s + (c.deuda || c.total), 0) * 100) / 100;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return {
      ...base, status: 'ENCONTRADO',
      summary: pending.length
        ? `Impuesto vehicular SAT: S/ ${pendingTotal.toFixed(2)} pendiente · ${pending.length} cuota(s) · años ${pendingYears.join(', ')}${paid.length ? ` · pagado S/ ${paidTotal.toFixed(2)}` : ''}${multaPendingTotal > 0 ? ` · multa pend. S/ ${multaPendingTotal.toFixed(2)}` : ''}`
        : (cuotas.length ? `Impuesto vehicular SAT: al día · pagado S/ ${paidTotal.toFixed(2)} en ${paid.length} cuota(s)${multaPaidTotal > 0 ? ` · multa pagada S/ ${multaPaidTotal.toFixed(2)}` : ''}` : 'Impuesto vehicular SAT: sin cuotas registradas'),
      data: { found: true, cuotas, pendingTotal, pendingCount: pending.length, paidTotal, paidCount: paid.length, paidYears, pendingYears, multaPaidTotal, multaPendingTotal, diag: diag.join(' ') },
      screenshot: shot, ms: Date.now() - t0,
    };
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
    // Elegir "por placa" revela el input, pero en SAT eso dispara un POSTBACK ASP.NET que re-renderiza el
    // frame (la referencia vieja queda obsoleta y el input aparece OCULTO un instante). Esperamos a que el
    // input esté VISIBLE re-resolviendo el frame, con un re-intento de la selección; si nunca aparece,
    // diagnosticamos las opciones reales — en vez del fill ciego que quemaba 30s con "element is not visible".
    let plateFrame = formFrame;
    let visible = false;
    for (let attempt = 0; attempt < 2 && !visible; attempt++) {
      if (attempt > 0) await (await findFrameWith(page, '#tipoBusquedaPapeletas'))?.selectOption('#tipoBusquedaPapeletas', 'busqPlaca').catch(() => {});
      for (let k = 0; k < 20; k++) {
        plateFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
        if (await plateFrame.locator('#ctl00_cplPrincipal_txtPlaca').isVisible().catch(() => false)) { visible = true; break; }
        await wait(300);
      }
    }
    if (!visible) {
      const opts = await formFrame.evaluate(`(function(){var s=document.getElementById('tipoBusquedaPapeletas');return s?Array.prototype.map.call(s.options,function(o){return o.value}).join('|'):'';})()`).catch(() => '');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      return { ...base, status: 'ERROR', summary: `SAT papeletas: el input de placa no se hizo visible tras elegir "por placa" (opciones=${opts || '?'})`, screenshot: shot, ms: Date.now() - t0 };
    }
    await plateFrame.locator('#ctl00_cplPrincipal_txtPlaca').fill(plate);
    const token = await solver.solveRecaptchaV2(SAT_PAPELETAS_SITEKEY, PAGE_URL);
    await plateFrame.evaluate(
      `(function(){var els=document.querySelectorAll('#g-recaptcha-response,[name=g-recaptcha-response]');els.forEach(function(e){e.value=${JSON.stringify(token)};e.style.display='block';});})()`,
    );
    await plateFrame.locator('#ctl00_cplPrincipal_CaptchaContinue').click();
    // Sondea el frame de resultado hasta que el RESULTADO real renderice (SAT es ASP.NET, postback
    // server-side). El grid trae filas "…dd/mm/aaaa <importe decimal>…"; el negativo dice "no se
    // encontraron papeletas". ⚠️ NO rompas con el rótulo estático "Papeletas"/"Infracción" del
    // encabezado: aparece ANTES del postback → lectura prematura del grid vacío → ENCONTRADO sin
    // monto ni detalle → el reporte solo puede decir "revisar en el portal".
    const hasResult = (b: string): boolean =>
      /no se encontraron papeletas/i.test(b) || /\b\d{2}\/\d{2}\/\d{4}\b[\s\S]{0,80}?\b\d[\d,]*\.\d{2}\b/.test(b);
    for (let k = 0; k < 30; k++) {
      const rf = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
      if (hasResult(await rf.locator('body').innerText().catch(() => ''))) break;
      await wait(300);
    }
    await wait(500);
    let resultFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
    let body = (await resultFrame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    // Servidor lento: si el marcador de resultado aún no está, un último respiro y re-lectura (evita el
    // falso "ENCONTRADO vacío" que mandaba a "revisar en el portal" con la grilla a medio pintar).
    if (!hasResult(body)) {
      await wait(1500);
      resultFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
      body = (await resultFrame.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    }
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

/* ───────────────── SATT Trujillo · Récord de papeletas por placa (SIN captcha) ───────────────── */
// satt.gob.pe/servicios/record-de-infracciones = wrapper Joomla → iframe ASP clásico en
// digital.satt.gob.pe. Flujo real (validado 13-ago-2026, EGU-257):
//  (1) registro.asp: form GET {txtdni, txtcelular, txtcorreo} → inserta_datos.asp (captura de datos
//      del portal; NO valida nada contra la placa) → auto-submit JS a papeletas.html.
//      ⚠ El input DNI trae un onChange que auto-submitea a OTRO .asp → se navega DIRECTO a
//      inserta_datos.asp por URL (mismo efecto, sin la mina).
//  (2) papeletas.html: form frmPLACA {txtdescripcion: placa CON GUION (el JS lo exige), CboBusqueda 03}
//      → POST KM_WEB_Record.asp = "RECORD DE PAPELETAS POR PLACA" (tabla Afecta·Fecha·Papeleta·Inf.·
//      Estado·Obligado·Total; sin papeletas = "El propietario de la placa en consulta no presenta
//      papeletas" + "Total de Papeletas 0 · S/. 0.00"). La CAPTURA de esa página es la evidencia.
// Identidad del registro: dueño PERSONA NATURAL → un DNI del historial (gate en index.ts); dueño
// EMPRESA o sin historial → SATT_DNI del env. SATT_CELULAR/SATT_CORREO del env o generados.
// ⚠ PII: NO se hardcodea ningún DNI/correo real en el repo (es público) — todo por env (placape.env).
const SATT_BASE = 'https://digital.satt.gob.pe/sigo/servicios/Record%20de%20Infracciones';

/** Placa en el formato del SATT (exige guion): ABC123→ABC-123, AC2399→AC-2399 (motos 2+4). */
export function formatPlacaSatt(plate: string): string {
  const p = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (/^[A-Z]{2}\d{4}$/.test(p)) return `${p.slice(0, 2)}-${p.slice(2)}`;
  return p.length > 3 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

/** Parsea el texto (innerText) del resultado KM_WEB_Record.asp. Filas ancladas por fecha dd/mm/aaaa
 *  + un decimal al final (así se descarta el pie "Emitido el : dd/mm/aaaa", sin importes). */
export function parseSattRecord(bodyRaw: string): { none: boolean; count: number; total: number; detalle: PapeletaDetalle[] } {
  const body = bodyRaw.replace(/[ \t]+/g, ' ');
  const toNum = (s: string): number => Math.round((parseFloat(String(s).replace(/,/g, '')) || 0) * 100) / 100;
  const none = /no presenta papeletas/i.test(body);
  const count = Number(body.match(/Total de Papeletas\s*:?\s*(\d+)/i)?.[1] ?? 0);
  const total = toNum(body.match(/Total de Papeletas\s*:?\s*\d+[\s\S]{0,120}?S\/\.?\s*([\d.,]+)/i)?.[1] ?? '0');
  const RX_ESTADO = /(pendiente|cancelad\w*|coactiv\w*|anulad\w*|fraccionad\w*|pagad\w*)/i;
  const detalle: PapeletaDetalle[] = [];
  for (const raw of bodyRaw.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const tokens = line.split(' ');
    const di = tokens.findIndex((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
    if (di < 0) continue;
    const decimals = tokens.slice(di + 1).filter((t) => /^\d[\d,]*\.\d{2}$/.test(t));
    if (!decimals.length) continue; // cabecera / "Emitido el" — sin importes
    const papeleta = (tokens[di + 1] || '').trim() || null;            // N° de papeleta
    const inf = tokens[di + 2] && !/^\d[\d,]*\.\d{2}$/.test(tokens[di + 2]!) ? tokens[di + 2]! : null; // código Inf.
    detalle.push({ numero: papeleta, fecha: tokens[di]!, infraccion: inf, monto: toNum(decimals[decimals.length - 1] ?? '0') || null, estado: RX_ESTADO.exec(line)?.[1] ?? null });
  }
  return { none, count, total, detalle };
}

export async function runSattPapeletas(
  page: Page,
  plate: string,
  _solver: CaptchaSolver,
  shot: string,
  registroDni?: string | null,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SATT_PAPELETAS', label: 'SATT Trujillo · Papeletas', category: 'PAPELETAS' };
  try {
    const dni = (registroDni && /^\d{8}$/.test(registroDni) ? registroDni : null) ?? process.env.SATT_DNI ?? null;
    if (!dni) {
      return { ...base, status: 'ERROR', summary: 'Sin DNI para el registro del SATT (dueño empresa o sin historial, y SATT_DNI no está en el env)', ms: Date.now() - t0 };
    }
    const celular = process.env.SATT_CELULAR ?? `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const correo = process.env.SATT_CORREO ?? `consulta_${dni}@example.com`;
    // (1) Registro (GET por URL): mismo efecto que llenar el form, sin el onChange traicionero.
    const qs = new URLSearchParams({ txtdni: dni, txtcelular: celular, txtcorreo: correo, B1: 'CONSULTAR RECORD DE PAPELETA' });
    await page.goto(`${SATT_BASE}/inserta_datos.asp?${qs.toString()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // inserta_datos.asp auto-submitea (JS) a papeletas.html → espera el form de búsqueda.
    const placaInput = page.locator('form[name="frmPLACA"] input[name="txtdescripcion"]');
    await placaInput.waitFor({ state: 'visible', timeout: 15000 });
    // (2) Búsqueda por placa (solo placa — el documento NO es necesario para el resultado).
    await placaInput.fill(formatPlacaSatt(plate));
    await page.locator('form[name="frmPLACA"] input[type="submit"]').click();
    // Resultado (POST server-side): sondea hasta que la página del récord esté pintada.
    for (let k = 0; k < 20; k++) {
      const b = await page.locator('body').innerText().catch(() => '');
      if (/RECORD DE PAPELETAS|no presenta papeletas|Total de Papeletas/i.test(b)) break;
      await wait(300);
    }
    const body = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); // evidencia = página del récord
    const r = parseSattRecord(body);
    const dniMasked = `${dni.slice(0, 3)}*****`; // trazabilidad sin exponer el DNI completo
    if (r.none || (/Total de Papeletas/i.test(body) && r.count === 0)) {
      return { ...base, status: 'SIN_REGISTRO', summary: 'Sin papeletas en Trujillo (SATT)', data: { total: 0, count: 0, registroDni: dniMasked }, screenshot: shot, ms: Date.now() - t0 };
    }
    if (r.count > 0 || r.detalle.length > 0) {
      const count = r.count || r.detalle.length;
      const total = r.total || Math.round(r.detalle.reduce((a, d) => a + (d.monto ?? 0), 0) * 100) / 100;
      return { ...base, status: 'ENCONTRADO', summary: `Papeletas en Trujillo (${count}) · S/ ${total.toFixed(2)}`,
        data: { total, count, detalle: r.detalle, registroDni: dniMasked, texto: body.slice(0, 4000) }, screenshot: shot, ms: Date.now() - t0 };
    }
    return { ...base, status: 'ERROR', summary: 'Respuesta no reconocida del SATT', screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/** DNI de una PERSONA NATURAL en el historial (para el registro del SATT): primer "DNI ########" en
 *  los participantes del timeline. Dueño EMPRESA (solo RUC) o historial caído → null → identidad del
 *  env. Dato crudo del motor (la máscara del reporte vive en report-transform). */
export function histDniSignal(
  result: { timeline?: Array<{ participantes?: string }> } | null | undefined,
): string | null {
  for (const t of result?.timeline ?? []) {
    const m = /\bDNI\s*:?\s*(\d{8})\b/i.exec(String(t?.participantes ?? ''));
    if (m) return m[1]!;
  }
  return null;
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

/**
 * ¿El vehículo es a gas? Las fuentes GNV (FISE/Infogas) SOLO tienen sentido si el vehículo fue
 * convertido a gas — dato que sale de la característica del asiento SPRL (`VehicleSpecs.fuel`,
 * p. ej. "BI-COMBUSTIBLE GNV", "GAS NATURAL"). El motor usa esto para NO gastar captcha en un
 * vehículo que no es a gas. `\bGAS\b` no matchea "GASOLINA" (no hay frontera de palabra tras "GAS").
 */
export function isGasVehicle(fuel: string | null | undefined): boolean {
  return !!fuel && /\bGNV\b|GAS\s*NATURAL|\bGLP\b|BI[\s-]*COMBUSTIBLE|DUAL|\bGAS\b/i.test(fuel);
}

/* ───────────────── FISE · Deuda del crédito de conversión GNV (reCAPTCHA v3, API JSON) ───────────────── */
// "AhorroGNV/FISE" financia la conversión a GNV (bono S/1000-2000). Su portal "Consulta tus pagos"
// (fise.minem.gob.pe:23308) revela si el vehículo ARRASTRA DEUDA de ese crédito — dato que SUNARP NO
// da (SUNARP solo muestra que el vehículo ya es GNV). Endpoint real (visto en consultaTaller.js →
// buscarSaldos): POST /consulta-taller/pages/consultaTaller/buscarSaldo (JSON)
//   { placaVehiculo, consultaId, codigoVerificacion:<reCAPTCHA v3 token>, tiempoSession, countBusqueda }
//   → { status:0, rows:[{ numeroDocumento, costoFinanciamiento, montoPagado, montoPendiente,
//        montoDeudaVencido, montoCuotasTeorico, esPerdidaDescuentoProvincia('S'/'N'), recaudos[] }] }
// numeroDocumento null = el vehículo NO tuvo crédito de conversión (SIN_REGISTRO). El reCAPTCHA es v3
// (score): desde IP datacenter puede rechazar (como ATU) → status!=0; se reintenta y, si persiste, error.
export const FISE_SITEKEY = '6LcSA7wUAAAAANXcrpjhO3zy5UPsRYWlWGPRk5w1';
export const FISE_PAGE_URL = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio';
export const FISE_ENDPOINT = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/buscarSaldo';

/** Interpreta la fila de `buscarSaldo` → resultado de la fuente. COMPARTIDO entre el runner
 *  headless (abajo) y el relay residencial (fise-relay.ts): misma respuesta, mismo parseo. */
export function parseFiseSaldo(
  row: Record<string, unknown> | null,
  base: { source: string; label: string; category: string },
  t0: number,
  shot?: string,
): OperatorSourceResult {
  const money = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const extra = shot ? { screenshot: shot } : {};
  // numeroDocumento null = el vehículo no figura con crédito de conversión GNV.
  if (!row || row.numeroDocumento == null) {
    return { ...base, status: 'SIN_REGISTRO', summary: 'Sin crédito de conversión GNV (no figura financiamiento)', data: {}, ...extra, ms: Date.now() - t0 };
  }
  const pendiente = money(row.montoPendiente);
  const vencido = money(row.montoDeudaVencido);
  const financiamiento = money(row.costoFinanciamiento);
  const pagado = money(row.montoPagado);
  const perdioDescuento = String(row.esPerdidaDescuentoProvincia ?? '').toUpperCase() === 'S';
  const tieneDeuda = pendiente > 0;
  const summary = tieneDeuda
    ? `Deuda de conversión GNV: S/ ${pendiente.toFixed(2)} pendiente${vencido > 0 ? ` · S/ ${vencido.toFixed(2)} vencido` : ''}`
    : `Crédito de conversión GNV cancelado (financiado S/ ${financiamiento.toFixed(2)})`;
  return {
    ...base, status: 'ENCONTRADO', summary,
    data: { tieneDeuda, financiamiento, pagado, pendiente, vencido, montoCuotasTeorico: money(row.montoCuotasTeorico), perdioDescuento, recaudos: Array.isArray(row.recaudos) ? row.recaudos.length : 0 },
    ...extra, ms: Date.now() - t0,
  };
}

export async function runFiseGnv(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'FISE_GNV', label: 'FISE · Deuda de conversión GNV', category: 'GNV' };
  const PAGE_URL = FISE_PAGE_URL;
  const ENDPOINT = FISE_ENDPOINT;
  try {
    // goto 25s (no 60): desde IP datacenter el :23308 a veces NI RESPONDE (filtrado) — cortar rápido
    // deja tiempo para que la cadena de egresos pruebe el túnel/SOCKS dentro de su presupuesto.
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // consultaId es un hidden que el servidor pinta; lo reenviamos tal cual (puede ir vacío).
    const consultaId = await page.locator('#consultaId').inputValue().catch(() => '');
    let row: Record<string, unknown> | null = null;
    let responded = false;
    for (let i = 1; i <= 3 && !responded; i++) {
      const token = await solver.solveRecaptchaV3(FISE_SITEKEY, PAGE_URL, 'consulta');
      // Posteamos el JSON DESDE la página (mismo origen → conserva cookies/jsession) y capturamos la respuesta.
      const res = await page.evaluate(async ({ url, body }: { url: string; body: Record<string, unknown> }) => {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include', body: JSON.stringify(body) });
          return { status: r.status, text: await r.text() };
        } catch (e) { return { status: 0, text: String(e) }; }
      }, { url: ENDPOINT, body: { placaVehiculo: plate, consultaId, codigoVerificacion: token, tiempoSession: 8, countBusqueda: i } });
      let j: { status?: number; rows?: Array<Record<string, unknown>> } | null = null;
      try { j = JSON.parse(res.text); } catch { /* no-JSON (reCAPTCHA/HTML) → reintenta */ }
      if (j && j.status === 0 && Array.isArray(j.rows)) { responded = true; row = j.rows[0] ?? null; }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (!responded) return { ...base, status: 'ERROR', summary: 'reCAPTCHA v3 rechazado / sin respuesta (3 intentos)', screenshot: shot, ms: Date.now() - t0 };
    return parseFiseSaldo(row, base, t0, shot);
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/* ───────────────── Infogas · Estado GNV + ¿tiene crédito? (reCAPTCHA v2) ───────────────── */
// vh.infogas.com.pe (el iframe embebido en infogas.com.pe). Form #placa-form: input name=n_placa
// (#inp_ck_plate) + reCAPTCHA v2 (data-sitekey 6Lctj…, callback 'vcc') + botón #btn_ck_plate.
// Resultado en .box_plate: .plate_item_havc = "¿Tiene crédito?" · .plate_item_esgnv = combustible ·
// .plate_item_pvci = venc. cilindro · .plate_item_pran = venc. revisión anual · .plate_item_vhab =
// habilitado para consumir. Error → .error_plate ("no ha podido ser encontrado"). Confirma que el
// vehículo ES GNV y si arrastra crédito; el MONTO exacto de la deuda lo da FISE. ⚠ Cloudflare delante:
// si el Chromium headless es bloqueado (interstitial), migrar a CDP (Chrome real) como SUNARP.
const INFOGAS_SITEKEY = '6LctjAQoAAAAAKxodrxo3QPm033HbyDrLf9N7x7P';
export async function runInfogas(
  page: Page,
  plate: string,
  solver: CaptchaSolver,
  shot: string,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'INFOGAS_GNV', label: 'Infogas · Estado GNV / crédito', category: 'GNV' };
  const URL = 'https://vh.infogas.com.pe/';
  try {
    // goto SIN throw: vh.infogas.com.pe deja recursos colgando y su domcontentloaded puede no
    // disparar NUNCA (visto en VPS: el form ya estaba visible y el goto igual venció a los 60s).
    // La señal real de "listo" es el input de placa, no el evento de carga.
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000, referer: 'https://infogas.com.pe/' }).catch(() => {});
    const plateInput = page.locator('#inp_ck_plate');
    await plateInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    for (let i = 1; i <= 3; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(1200); }
      await plateInput.fill(plate).catch(() => {});
      const token = await solver.solveRecaptchaV2(INFOGAS_SITEKEY, URL);
      // Inyecta el token en el textarea g-recaptcha-response y dispara el callback 'vcc' (habilita el envío).
      await page.evaluate((tok: string) => {
        document.querySelectorAll('textarea#g-recaptcha-response,textarea[name="g-recaptcha-response"]').forEach((e) => {
          (e as HTMLTextAreaElement).value = tok; (e as HTMLElement).style.display = 'block';
        });
        try { const w = window as unknown as { vcc?: (t: string) => void }; if (w.vcc) w.vcc(tok); } catch { /* noop */ }
      }, token).catch(() => {});
      await page.locator('#btn_ck_plate').click().catch(() => {});
      // Sondea el RESULTADO por CONTENIDO, no por clase: Infogas cambió el DOM y `.box_plate`/
      // `.plate_item_*` ya no matchean aunque el resultado SÍ se pinta (visto en BRA514 1-ago-2026:
      // la página mostraba GNV-C / venc. cilindro / ¿crédito? completos pero el scraper timeouteaba).
      // "listo" = aparece el encabezado "Placa de vehículo" + una etiqueta conocida; error = texto de
      // "no encontrado" o el `.error_plate` clásico.
      let state = '';
      for (let k = 0; k < 30; k++) {
        state = await page.evaluate(() => {
          const body = (document.body.innerText || '').replace(/\s+/g, ' ');
          if (/placa de veh[ií]culo/i.test(body) && /(tipo de combustible|habilitado para consumir|tiene\s+cr[eé]dito)/i.test(body)) return 'ok';
          if (/no ha podido ser encontrad|no se (ha\s+)?encontr|no figura|placa no v[aá]lida|no es un veh[ií]culo/i.test(body)) return 'err';
          const errBox = document.querySelector('.error_plate') as HTMLElement | null;
          if (errBox && errBox.offsetParent !== null) return 'err';
          return '';
        }).catch(() => '');
        if (state) break;
        await wait(500);
      }
      if (state === 'err') {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        return { ...base, status: 'SIN_REGISTRO', summary: 'No figura como vehículo GNV en Infogas', data: {}, screenshot: shot, ms: Date.now() - t0 };
      }
      if (state === 'ok') {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        // Extracción por las clases estables .plate_item_* (confirmadas en el DOM real de BRA514,
        // 1-ago-2026: <p>etiqueta</p><h5><span class="plate_item_*">valor</span></h5>). Usa
        // textContent, NO innerText: innerText depende del layout y en el Chrome CDP en background a
        // veces vuelve vacío aunque el valor esté en el DOM (era la causa del "todo vacío"). byLabel
        // queda de respaldo por si alguna clase desapareciera; salta nodos ocultos para NO filtrar el
        // bloque .d-none con .plate_item_ip (IP interna del server) mal-rotulado "Vencimiento…".
        type Gnv = { esgnv: string; havc: string; pvci: string; pran: string; vhab: string; _diag: string };
        // Extracción por clase .plate_item_* (textContent), TODO INLINE — SIN funciones-helper con
        // nombre. tsx/esbuild (keepNames) envuelve cada `const fn = () => …` en `__name(fn,"fn")`, y
        // `__name` NO existe en el navegador → el evaluate reventaba con "__name is not defined" y el
        // .catch lo disfrazaba de "todo vacío" (causa raíz confirmada en BRA514, 1-ago-2026, vía DIAG).
        // Respaldo por etiqueta (<p>Etiqueta</p> + <h5>valor</h5>), también inline y saltando nodos
        // ocultos, por si alguna clase se fuera (evita el bloque .d-none con .plate_item_ip = IP interna).
        const grab = (): Promise<Gnv> => page.evaluate(() => {
          const out: Gnv = { esgnv: '', havc: '', pvci: '', pran: '', vhab: '', _diag: '' };
          try {
            out.esgnv = (document.querySelector('.plate_item_esgnv')?.textContent || '').replace(/\s+/g, ' ').trim();
            out.havc = (document.querySelector('.plate_item_havc')?.textContent || '').replace(/\s+/g, ' ').trim();
            out.pvci = (document.querySelector('.plate_item_pvci')?.textContent || '').replace(/\s+/g, ' ').trim();
            out.pran = (document.querySelector('.plate_item_pran')?.textContent || '').replace(/\s+/g, ' ').trim();
            out.vhab = (document.querySelector('.plate_item_vhab')?.textContent || '').replace(/\s+/g, ' ').trim();
            if (!out.esgnv || !out.havc || !out.pvci || !out.pran || !out.vhab) {
              const ps = Array.from(document.querySelectorAll('.box_plate p')) as HTMLElement[];
              for (const p of ps) {
                if (p.querySelector('*') || p.offsetParent === null) continue; // hoja visible (salta .d-none)
                const label = (p.textContent || '').replace(/\s+/g, ' ').trim();
                let sib = p.nextElementSibling as HTMLElement | null;
                while (sib && !(sib.textContent || '').trim()) sib = sib.nextElementSibling as HTMLElement | null;
                const val = sib ? (sib.textContent || '').replace(/\s+/g, ' ').trim() : '';
                if (!val || val.length >= 40) continue;
                if (!out.esgnv && /tipo de combustible|es gnv/i.test(label)) out.esgnv = val;
                else if (!out.havc && /tiene\s+cr[eé]dito/i.test(label)) out.havc = val;
                else if (!out.pvci && /vencimiento de cilindro/i.test(label)) out.pvci = val;
                else if (!out.pran && /vencimiento de revisi[oó]n/i.test(label)) out.pran = val;
                else if (!out.vhab && /habilitado para consumir/i.test(label)) out.vhab = val;
              }
            }
            const el = document.querySelector('.plate_item_esgnv') as HTMLElement | null;
            out._diag = 'box=' + document.querySelectorAll('.box_plate').length
              + ' items=' + document.querySelectorAll('[class*="plate_item_"]').length
              + ' frames=' + window.length + ' esgnv=' + (el ? '"' + (el.textContent || '').trim() + '"' : 'null');
          } catch (e) { out._diag = 'THREW:' + String((e as Error)?.message || e); }
          return out;
        }).catch((e: unknown) => ({ esgnv: '', havc: '', pvci: '', pran: '', vhab: '', _diag: 'REJECT:' + String((e as Error)?.message || e) } as Gnv));
        const allEmpty = (f: Gnv): boolean => !f.esgnv && !f.havc && !f.pvci && !f.pran && !f.vhab;
        // Reintenta ante vacío: el primer evaluate puede correr en la micro-ventana en que el contexto
        // se recreó o el AJAX aún no pintó los <span> (antes reventaba y caía al .catch → todo vacío).
        let fields = await grab();
        for (let k = 0; k < 4 && allEmpty(fields); k++) { await wait(700); fields = await grab(); }
        const { esgnv, havc, pvci, pran, vhab } = fields;
        // Si TRAS los reintentos sigue todo vacío → el DOM cambió de verdad: VUELCA el HTML real del
        // contenedor de resultados al summary para fijar el selector correcto de una vez (red de
        // seguridad; fue lo que reveló que las clases .plate_item_* seguían vigentes).
        if (allEmpty(fields)) {
          const dom = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            let best: HTMLElement | null = null; let bestLen = Infinity;
            for (const el of all) {
              const t = (el.innerText || '').replace(/\s+/g, ' ');
              if (/placa de veh[ií]culo/i.test(t) && /(combustible|habilitado|cr[eé]dito|cilindro|revisi[oó]n)/i.test(t)) {
                const h = el.outerHTML || '';
                if (h.length < bestLen) { best = el; bestLen = h.length; }
              }
            }
            const src = best ? best.outerHTML : document.body.innerHTML;
            return (src || '').replace(/\s+/g, ' ').slice(0, 1800);
          }).catch(() => '');
          return {
            ...base, status: 'ENCONTRADO',
            summary: `ENCONTRADO pero extracción vacía · DIAG: ${fields._diag} · DUMP: ${dom.slice(0, 900)}`,
            data: {}, screenshot: shot, ms: Date.now() - t0,
          };
        }
        const tieneCredito = /^s[ií]/i.test(havc.trim());
        return {
          ...base, status: 'ENCONTRADO',
          summary: `GNV: ${esgnv || '—'} · ¿crédito?: ${havc || '—'}${vhab ? ` · habilitado: ${vhab}` : ''}`,
          data: { combustible: esgnv || null, tieneCredito, credito: havc || null, vencimientoCilindro: pvci || null, vencimientoRevision: pran || null, habilitado: vhab || null },
          screenshot: shot, ms: Date.now() - t0,
        };
      }
      // ni resultado ni error → reCAPTCHA rechazado o Cloudflare → reintenta con captcha nuevo
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    // Diagnóstico si vuelve a fallar: deja el texto visible de la página (por si el DOM cambió otra vez).
    const dump = (await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '')) || '';
    return { ...base, status: 'ERROR', summary: `Sin resultado (captcha/Cloudflare) tras 3 intentos${dump ? ` · página: "${dump.slice(0, 160)}"` : ''}`, screenshot: shot, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}
