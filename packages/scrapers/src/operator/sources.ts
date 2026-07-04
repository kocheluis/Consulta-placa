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
    await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx', { waitUntil: 'networkidle', timeout: 60000 });
    const img = page.locator('img.captcha_class').first();
    const plateInput = page.locator('#ctl00_cplPrincipal_txtPlaca');
    const capInput = page.locator('#ctl00_cplPrincipal_txtCaptcha');
    const submit = page.locator('#ctl00_cplPrincipal_CaptchaContinue');
    const RESULT = new RegExp(`el veh[ií]culo de placa\\s*${plate}[^]*?orden de captura[^.]*\\.`, 'i');
    const ERR = /c[oó]digo de seguridad incorrect/i;
    let cap = '';

    for (let i = 1; i <= 3; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(800); }
      await plateInput.fill(plate);
      cap = await readCaptcha(solver, img);
      await capInput.fill(cap);
      await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), submit.click()]);
      let body = '';
      for (let k = 0; k < 10; k++) { await wait(1000); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (RESULT.test(body) || ERR.test(body)) break; }
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
    // Robusto al mojibake del portal ("cÃ³digo de seguridad"): matchea solo el prefijo ASCII.
    const ERR = /error al ingresar/i;
    const NODATA = /no hay resultados para mostrar/i;
    let cap = '';

    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(1500); }
      await selectPlaca();
      await valor.fill(plate);
      dialog = '';
      await capImg.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
      await wait(400);
      cap = cleanCallaoCaptcha(await readCaptcha(solver, capImg)); // 3 dígitos: solo dígitos
      await capInput.fill(cap);
      await page.locator('button:has-text("Buscar"), input[value*="Buscar" i]').first().click().catch(() => {});
      await wait(4500);
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
    await wait(1200);
    const sel = page.locator('#selBUS_Filtro');
    const selectPlaca = async () => { if (await sel.count()) await sel.selectOption({ label: 'Placa' }).catch(() => {}); await wait(500); };
    const img = page.locator('#imgCaptcha');
    const capInput = page.locator('#texCaptcha');
    const plateInput = page.locator('#texFiltro');
    const buscar = page.locator('#btnBuscar');
    // Señal de RESULTADO REAL = un código de certificado CITV (C-AAAA-…). NO uses la cabecera de la
    // tabla ("NRO DE CERTIFICADO"): aparece aunque el resultado esté vacío → daría falso positivo.
    const OK = /\bC-\d{4}-\d/i;
    const CAP_ERR = /captcha|c[oó]digo ingresado|no es v[aá]lid|verifique/i;
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
      for (let k = 0; k < 12; k++) { await wait(1000); body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' '); if (OK.test(body) || dialog) break; }
      // Captcha rechazado (alert) → reintenta con uno nuevo.
      if (CAP_ERR.test(dialog)) continue;
      if (OK.test(body)) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const certs = parseMtcCerts(body, plate);
        const vig = certs.find((c) => /VIGENTE/i.test(c.estado ?? ''));
        const observaciones = body.match(/OBSERVACIONES\s+([^\n]{0,80})/i)?.[1]?.trim() ?? null;
        // Lunas polarizadas: el dato legítimo aparece (si aplica) en el CITV; no hay
        // consulta oficial por placa aparte (los sitios "PNP" son terceros no oficiales).
        const lunas = /lunas|polariza|oscurec/i.test(body) ? 'mención en CITV (revisar)' : 'sin mención en CITV';
        return { ...base, status: 'ENCONTRADO', summary: vig ? `CITV ${vig.estado} hasta ${vig.vigenteHasta}` : `${certs.length} certificado(s) CITV`, data: { certificados: certs, observaciones, lunasPolarizadas: lunas, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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
    let cap = '';

    for (let i = 1; i <= 5; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(2500); }
      await plateInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(400);
      await plateInput.fill(plate);
      cap = await readCaptcha(solver, img);
      await capInput.fill(cap);
      await fl.locator('button:has-text("Consultar"), button[type="submit"]').first().click().catch(() => {});
      await wait(5000);
      const body = (await fl.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      const err = /(c[oó]digo|captcha)[^]{0,40}(incorrect|inv[aá]lid)/i.test(body);
      if (err) continue;
      const soat = parseApesegSoat(body);
      const noData = /no\s+(se\s+)?(encontr|registr|existe|cuenta)/i.test(body);
      if (Object.keys(soat).length >= 2 || noData) {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        if (noData && Object.keys(soat).length < 2) return { ...base, status: 'SIN_REGISTRO', summary: 'Sin SOAT registrado', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
        return { ...base, status: 'ENCONTRADO', summary: `SOAT ${soat.estado ?? ''} · ${soat.compania ?? ''}`.trim(), data: { ...soat, captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
      }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return { ...base, status: 'ERROR', summary: 'Captcha rechazado o sin datos tras varios intentos', data: { captcha: cap }, screenshot: shot, ms: Date.now() - t0 };
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
  const base = { source: 'SBS_SOAT', label: 'SBS · SOAT/CAT y siniestralidad', category: 'SEGUROS' };
  const URL = 'https://servicios.sbs.gob.pe/reportesoat/';
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    // El portal SBS tiene 3 tipos (radios): SOAT (_0), Vehicular (_1), CAT (_2). Los taxis NO tienen
    // SOAT (usan CAT) → si SOAT sale VACÍO, consultamos CAT. Cada consulta cuesta 1 reCAPTCHA v3.
    const TIPOS = [{ key: 'SOAT', radio: '#ctl00_MainBodyContent_rblOpcionesSeguros_0' }, { key: 'CAT', radio: '#ctl00_MainBodyContent_rblOpcionesSeguros_2' }];
    const OK = /resultado de (la )?b[uú]squeda|listado de p[oó]lizas|n[uú]mero de accidentes|no se encontr|no registra|no tiene informaci/i;
    const NODATA = /no tiene informaci[oó]n reportada/i;
    let attemptNo = 0;
    let respondedAny = false;
    for (const tipo of TIPOS) {
    for (let i = 1; i <= 2; i++) {
      // goto (no reload): tras una búsqueda la página queda en la vista de resultados; hay que
      // volver al formulario fresco para consultar el siguiente tipo (SOAT→CAT) o reintentar.
      if (attemptNo > 0) { await page.goto(URL, { waitUntil: 'networkidle' }); await wait(800); }
      attemptNo++;
      await page.locator(tipo.radio).check().catch(() => {});
      await page.locator('#ctl00_MainBodyContent_txtPlaca').fill(plate);
      const token = await solver.solveRecaptchaV3(SBS_SITEKEY, URL, 'homepage');
      await page.evaluate(
        `(function(tok){function set(s){document.querySelectorAll(s).forEach(function(e){e.value=tok;});}set('#ctl00_MainBodyContent_hdnReCaptchaV3');set('[name="g-recaptcha-response"]');set('#g-recaptcha-response');})(${JSON.stringify(token)})`,
      );
      // El botón "Consultar" arranca con clase "disabled" y, tras un goto (2º tipo = CAT), un overlay
      // (.align-center) intercepta el clic. Lo habilitamos y disparamos su onclick por JS (string-eval
      // por el bug __name de esbuild/tsx con funciones flecha en page.evaluate).
      await page.evaluate("(function(){var b=document.querySelector('#ctl00_MainBodyContent_btnIngresarPla');if(b){b.classList.remove('disabled');b.click();}})()");
      await wait(5000);
      await page.waitForLoadState('networkidle').catch(() => {});
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (!OK.test(body)) continue; // reCAPTCHA rechazado / sin respuesta → reintenta este tipo
      respondedAny = true; // el portal respondió (con o sin datos)
      if (NODATA.test(body)) break; // respondió pero SIN datos para este tipo → pasa al siguiente (CAT)
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const accidentes = body.match(/[uú]ltimos 5 a[nñ]os:\s*(\d+)/i)?.[1] ?? null;
      // Tabla "Listado de pólizas SOAT contratadas": extrae cada póliza mapeando por
      // encabezado (robusto al orden de columnas). String-eval (no función flecha) por
      // el bug __name de esbuild/tsx al serializar funciones a page.evaluate.
      const polizas = (await page.evaluate(`(function(){
        var norm=function(s){return (s||'').replace(/\\s+/g,' ').trim();};
        var tables=Array.prototype.slice.call(document.querySelectorAll('table'));
        for(var ti=0;ti<tables.length;ti++){
          var trs=Array.prototype.slice.call(tables[ti].querySelectorAll('tr'));
          var head=null;
          for(var hi=0;hi<trs.length;hi++){var tx=trs[hi].innerText||'';if(/p[oó]liza/i.test(tx)&&/certificado/i.test(tx)){head=trs[hi];break;}}
          if(!head)continue;
          var hc=Array.prototype.slice.call(head.querySelectorAll('th,td')).map(function(c){return norm(c.textContent).toLowerCase();});
          var ix=function(re){for(var i=0;i<hc.length;i++){if(re.test(hc[i]))return i;}return -1;};
          var ci={compania:ix(/compa/),clase:ix(/clase/),uso:ix(/uso/),poliza:ix(/p[oó]liza/),certificado:ix(/certificado/),inicio:ix(/inicio/),fin:ix(/fin/)};
          var out=[];
          for(var ri=0;ri<trs.length;ri++){
            if(trs[ri]===head)continue;
            var cells=Array.prototype.slice.call(trs[ri].querySelectorAll('td')).map(function(c){return norm(c.textContent);});
            if(cells.length<4)continue;
            var g=function(i){return (i>=0&&i<cells.length)?cells[i]:'';};
            var row={compania:g(ci.compania),clase:g(ci.clase),uso:g(ci.uso),poliza:g(ci.poliza),certificado:g(ci.certificado),inicio:g(ci.inicio),fin:g(ci.fin)};
            if(row.compania||row.poliza)out.push(row);
          }
          return out;
        }
        return [];
      })()`)) as Array<Record<string, string>>;
      // Vigente = póliza con "fin de vigencia" más reciente (≥ hoy = activa).
      const toTs = (d?: string): number => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d ?? ''); return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : 0; };
      const soat = polizas.slice().sort((a, b) => toTs(b.fin) - toTs(a.fin))[0] ?? null;
      const vigente = soat ? toTs(soat.fin) >= Date.now() - 864e5 : false;
      const compania = soat?.compania ?? body.match(/(R[ií]mac|La Positiva|Pac[ií]fico|Mapfre|Interseguro|Crecer Seguros|Protecta|Qualitas|Vivir|Insur|HDI)[^\n]{0,30}/i)?.[0]?.trim() ?? null;
      return {
        ...base,
        status: 'ENCONTRADO',
        summary: `${tipo.key} ${compania ?? 's/d'}${soat?.fin ? ` vig. ${soat.fin}` : ''} · ${accidentes ?? '?'} accid. 5añ`,
        data: { tipo: tipo.key, accidentes, compania, soat, vigente, polizas, detalle: body.slice(body.search(/resultado de (la )?b[uú]squeda/i), body.search(/resultado de (la )?b[uú]squeda/i) + 600) },
        screenshot: shot,
        ms: Date.now() - t0,
      };
    }
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    // El portal RESPONDIÓ (SOAT/CAT sin registro) → "no tiene seguro" es un dato definitivo: sección
    // disponible con hasActiveSoat=false (NO error). Solo es ERROR si el reCAPTCHA nunca pasó.
    if (respondedAny) {
      return { ...base, status: 'ENCONTRADO', summary: 'Sin SOAT ni CAT vigente', data: { tipo: null, accidentes: null, compania: null, soat: null, vigente: false, polizas: [] }, screenshot: shot, ms: Date.now() - t0 };
    }
    return { ...base, status: 'ERROR', summary: 'reCAPTCHA v3 rechazado (sin respuesta)', screenshot: shot, ms: Date.now() - t0 };
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
      const { montoTotal, count } = parseSatPapeletasMontos(body);
      const montoTxt = montoTotal > 0 ? ` · S/ ${montoTotal.toFixed(2)}` : '';
      return { ...base, status: 'ENCONTRADO', summary: `Papeletas pendientes en Lima${count ? ` (${count})` : ''}${montoTxt}`, data: { montoTotal, count, texto: body.slice(0, 800) }, screenshot: shot, ms: Date.now() - t0 };
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
    await page.goto(ATU_URL, { waitUntil: 'networkidle', timeout: 60000 });
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
      if (i > 1) { await page.reload({ waitUntil: 'networkidle' }); await wait(1500); await acceptCookies(); await wait(400); }
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
