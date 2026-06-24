/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page, type Browser } from 'playwright';

/**
 * Fuente SUPERBID (subastas de vehículos SINIESTRADOS / REMATADOS) — señal LEADING
 * de due-diligence (aparece ANTES que SUNARP: el siniestro recién llega al registro
 * cuando la aseguradora se adjudica el auto). EXPERIMENTAL — requiere validación en
 * vivo contra una subasta abierta (operador presente).
 *
 * Hallazgos del discovery (`probe-cdp-superbid.ts`):
 *  - SPA con API `offer-query.superbid.net/offers/?portalId=[21]&…` (portal Perú=21).
 *  - El listado NO trae los anexos; cada lote tiene una sección **"Anexos"** con la
 *    **BOLETA INFORMATIVA SUNARP** como PDF cuyo **nombre = la PLACA** (ej. `CFK854.pdf`),
 *    alojado en `s.superbid.net/attachment/<…>.pdf`. La placa va ENMASCARADA en el
 *    título/URL (`placa-4`) → el match fiable es por el nombre del anexo.
 *  - El nombre de la subasta clasifica el tipo: "SUBASTA RIMAC" → aseguradora/siniestro;
 *    "SUBASTA FINANCIERA …" → remate/financiera.
 *
 * Estrategia: enumerar lotes de autos → filtrar por marca+modelo+año+último dígito de
 * placa (del título) → abrir candidatos → "Anexos" → confirmar `<PLACA>.pdf` exacto →
 * clasificar la subasta + guardar la boleta. Vigencia: comparar el dueño de la boleta
 * vs el dueño actual de Consulta Vehicular (mismo = vigente; distinto = ya transferido).
 *
 * ⚠️ LIMITACIÓN del lookup por placa EN VIVO (validado 24-jun): la placa solo está en el
 * anexo de CADA lote, y hay ~191 lotes repartidos en varias categorías (autos, camiones…)
 * con paginación. Enumerar+abrir todos por cada consulta es caro (~30min) y la categoría
 * "autos-y-motos" no cubre camiones (ej. CFK854 = HINO baranda no aparece ahí).
 * ARQUITECTURA CORRECTA (pendiente): un JOB que escanea TODOS los lotes (offer-query API,
 * todas las categorías, paginado), abre cada uno, extrae la placa del anexo, y guarda un
 * ÍNDICE `placa → {subasta, loteUrl, boletaUrl, flags}` (Supabase/local). Así el lookup
 * por placa es instantáneo. Esta función `buscarSuperbid` queda como búsqueda best-effort
 * (sirve cuando el lote está en la categoría autos enumerada); el índice es el siguiente paso.
 */

const PORT = Number(process.env.CDP_SUPERBID_PORT ?? 9225);
const PROFILE = process.env.CDP_SUPERBID_PROFILE ?? join(process.cwd(), '.cdp-superbid-profile');
const BASE = 'https://www.superbid.com.pe';
const AUTOS = 'https://www.superbid.com.pe/categorias/autos-y-motos';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));

const RX_ASEG = /\b(RIMAC|R[IÍ]MAC|PAC[IÍ]FICO|LA POSITIVA|MAPFRE|INTERSEGURO|QU[AÁ]LITAS|SEGUROS|ASEGURADORA)\b/i;
const RX_REMATE = /\b(REMATE|SUBASTA|FINANCIERA|MARTILLER[OA]|ADJUDICACI[OÓ]N|BANCO|LEASING)\b/i;
const RX_SINIESTRO = /\b(SINIESTR|P[EÉ]RDIDA TOTAL|RECUPERAD)/i;

export interface SuperbidOptions {
  brand?: string;
  model?: string;
  year?: string | number;
  log?: (m: string) => void;
  outDir?: string;
}
export interface SuperbidResult {
  ok: boolean;          // corrió sin error
  found: boolean;       // la placa apareció en alguna subasta
  subasta?: string;     // nombre de la subasta (ej. "23º SUBASTA RIMAC")
  loteUrl?: string;
  boletaUrl?: string;   // URL del PDF de la boleta SUNARP (anexo)
  flags: { aseguradora: boolean; remate: boolean; siniestro: boolean };
  error?: string;
}

/** Normaliza un título de lote para clasificar la subasta cuando no hay nombre. */
function clasificar(texto: string): { aseguradora: boolean; remate: boolean; siniestro: boolean } {
  return { aseguradora: RX_ASEG.test(texto), remate: RX_REMATE.test(texto), siniestro: RX_SINIESTRO.test(texto) };
}

/**
 * Busca la placa en las subastas de Superbid. Si la encuentra, devuelve el lote +
 * la subasta + la URL de la boleta (anexo) + las banderas.
 */
export async function buscarSuperbid(plateRaw: string, opts: SuperbidOptions = {}): Promise<SuperbidResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lastDigit = plate.slice(-1);
  const brand = (opts.brand ?? '').toUpperCase();
  const model = (opts.model ?? '').toUpperCase().split(/\s+/)[0] ?? ''; // 1ª palabra del modelo
  const year = String(opts.year ?? '');
  const out: SuperbidResult = { ok: false, found: false, flags: { aseguradora: false, remate: false, siniestro: false } };
  if (!CHROME) return { ...out, error: 'No encontré chrome.exe.' };

  let browser: Browser | null = null;
  try {
    log(`Chrome Superbid (CDP :${PORT})…`);
    const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', AUTOS], { detached: false, stdio: 'ignore' });
    proc.on('error', (e) => log(`spawn: ${e.message}`));
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
    if (!browser) return { ...out, error: 'no conecté al Chrome Superbid' };
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // ── Enumerar lotes de autos (varias páginas si hace falta) ──
    await page.goto(AUTOS, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(5000);
    const lotes: Array<{ url: string; titulo: string }> = [];
    for (let pg = 0; pg < 4; pg++) {
      const nuevos = await page.$$eval('a[href*="/oferta/"]', (els) =>
        els.map((e) => ({ url: (e as HTMLAnchorElement).href, titulo: ((e.textContent || '') + ' ' + (e as HTMLAnchorElement).href).toUpperCase() })),
      ).catch(() => []);
      for (const n of nuevos) if (!lotes.some((l) => l.url === n.url)) lotes.push(n);
      // intentar paginar (scroll / botón siguiente)
      await page.mouse.wheel(0, 4000).catch(() => {});
      await wait(2500);
    }
    log(`lotes de autos enumerados: ${lotes.length}`);

    // ── Narrow: marca + último dígito de placa son lo fiable; modelo/año son SOFT
    // (el año del título puede ser fab o mod, y el modelo varía: "FD" vs "FD STANDARD"). ──
    const digito = (t: string) => new RegExp(`PLACA-${lastDigit}(?=[-/])`).test(t);
    const score = (l: { titulo: string; url: string }) => {
      const t = (l.titulo + ' ' + l.url).toUpperCase();
      let s = 0;
      if (brand && t.includes(brand)) s += 2;
      if (model && t.includes(model)) s += 1;
      if (year && t.includes(year)) s += 1;
      return s;
    };
    const candidatos = lotes
      .filter((l) => digito((l.titulo + ' ' + l.url).toUpperCase()) && (!brand || (l.titulo + ' ' + l.url).toUpperCase().includes(brand)))
      .sort((a, b) => score(b) - score(a));
    log(`candidatos tras narrow (marca ${brand || '—'} + placa…${lastDigit}): ${candidatos.length}`);
    const aRevisar = (candidatos.length ? candidatos : lotes.filter((l) => digito((l.titulo + ' ' + l.url).toUpperCase()))).slice(0, 15);

    // ── Abrir candidatos → "Anexos" → confirmar el anexo `<PLACA>.pdf` ──
    for (const l of aRevisar) {
      await page.goto(l.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await wait(4000);
      await page.locator('button:has-text("Anexos"), [role="tab"]:has-text("Anexos"), a:has-text("Anexos")').first().click({ timeout: 4000 }).catch(() => {});
      await wait(2500);
      // El anexo-boleta se llama `<PLACA>.pdf` → buscar ese patrón en TODO el texto del lote.
      const bodyTxt = (await page.locator('body').innerText().catch(() => '')).toUpperCase();
      const matchPdf = new RegExp(`\\b${plate}\\.PDF\\b`).test(bodyTxt.replace(/[^A-Z0-9.\s]/g, ''))
        ? `${plate}.pdf`
        : (await page.$$eval('a, button, span', (els) => els.map((e) => (e.textContent || '').trim()).filter((t) => /\.pdf$/i.test(t))).catch(() => []))
            .find((a) => a.toUpperCase().replace(/[^A-Z0-9.]/g, '').startsWith(plate + '.PDF'));
      if (matchPdf) {
        const subasta = (await page.locator('h1, h2, [class*="event" i], [class*="auction" i]').allInnerTexts().catch(() => []))
          .map((s) => s.trim()).find((s) => /SUBASTA|REMATE|RIMAC|FINANCIERA/i.test(s)) ?? l.titulo;
        const fl = clasificar(subasta + ' ' + l.titulo);
        // URL real del PDF (display name = placa; href = s.superbid.net/attachment/…)
        const boletaUrl = await page.locator(`a:has-text("${matchPdf}")`).first().getAttribute('href').catch(() => null);
        if (boletaUrl && opts.outDir) { writeFileSync(join(opts.outDir, '_superbid-lote.txt'), `${l.url}\n${boletaUrl}`, 'utf8'); }
        log(`✓ MATCH: ${plate} en "${subasta}"`);
        return { ok: true, found: true, subasta, loteUrl: l.url, boletaUrl: boletaUrl ?? undefined, flags: fl };
      }
    }

    log(`placa ${plate} no encontrada en ${aRevisar.length} lotes revisados`);
    return { ...out, ok: true, found: false };
  } catch (e) {
    return { ...out, error: (e as Error).message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
