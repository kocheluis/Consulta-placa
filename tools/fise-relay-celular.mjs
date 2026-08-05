#!/usr/bin/env node
/* eslint-disable no-console */
// Worker RESIDENCIAL de FISE para el celular (Termux/Android) — PlacaPe.
//
// El portal FISE (fise.minem.gob.pe:23308) solo responde a IPs residenciales peruanas (el MINEM
// filtra las IPs datacenter y los proxies comerciales no permiten ese puerto). Este worker corre
// en el celular del operador (Wi-Fi de casa o datos móviles), hace POLLING al VPS por trabajos,
// ejecuta la consulta y devuelve el JSON crudo. CERO dependencias (Node ≥ 18: fetch nativo) y
// CERO secretos aparte del token del relay (el captcha lo resuelve el VPS).
//
// INSTALACIÓN (Termux en Android, una sola vez):
//   pkg install nodejs-lts
//   curl -O https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools/fise-relay-celular.mjs
//
// USO:
//   node fise-relay-celular.mjs http://IP-DEL-VPS:3011 EL_TOKEN
//   (el token debe coincidir con FISE_RELAY_TOKEN en /root/placape.env del VPS)
//   ⚠ Puerto 3011 = listener PÚBLICO del relay (el 3010 es la consola, solo loopback/túnel SSH).
//
// MANTENERLO VIVO:
//   - termux-wake-lock   (evita que Android duerma a Termux)
//   - Ajustes Android → Batería → Termux → "Sin restricciones" / excluir de optimización
//   - Celular enchufado al cargador; ideal: uno viejo dedicado en el Wi-Fi de casa.

import { request as httpsRequest } from 'node:https';
import { spawn } from 'node:child_process';

const [, , BASE_RAW, TOKEN] = process.argv;

const PAGE = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio';
const ENDPOINT = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/buscarSaldo';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);

// Toma el wake-lock de Termux para que Android NO congele el proceso en Doze (la causa #1 de que el
// relay "deje de latir"). Best-effort: si no existe el binario (no es Termux / falta termux-api) se
// ignora. El supervisor fise-relay-boot.sh también lo toma; esto protege además los arranques manuales.
function acquireWakeLock() {
  try { spawn('termux-wake-lock', { stdio: 'ignore' }).on('error', () => {}); } catch { /* no-termux */ }
}
// Un error suelto NUNCA debe tumbar el worker: log y seguir (el bucle principal es autocontenido y se
// re-encarga en el próximo giro). Así una red rara o un throw inesperado no matan el relay.
process.on('uncaughtException', (e) => console.error(`[${ts()}] uncaught (sigo vivo): ${e?.message ?? e}`));
process.on('unhandledRejection', (e) => console.error(`[${ts()}] unhandled (sigo vivo): ${e?.message ?? e}`));

// HTTP hacia FISE con node:https y `rejectUnauthorized: false` EXPLÍCITO: el servidor del MINEM
// manda su certificado SIN la cadena intermedia (los navegadores la resuelven solos, por eso el
// portal "carga" en Chrome; Node estricto rechaza con UNABLE_TO_VERIFY_LEAF_SIGNATURE — visto en
// Termux 31-jul-2026). Solo aplica a FISE (el VPS va por http plano) y la data es pública.
function fiseFetch(url, { method = 'GET', headers = {}, body = null, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method, headers, rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        setCookies: res.headers['set-cookie'] ?? [],
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// GET con hasta 3 redirecciones, ACUMULANDO cookies de cada salto (JSESSIONID puede venir en un 302).
async function fiseGet(startUrl) {
  let url = startUrl;
  const cookies = [];
  let page = null;
  for (let hop = 0; hop < 4; hop++) {
    page = await fiseFetch(url, { headers: cookies.length ? { Cookie: cookies.join('; ') } : {} });
    cookies.push(...page.setCookies.map((c) => c.split(';')[0]));
    const loc = page.headers.location;
    if (page.status >= 300 && page.status < 400 && loc) { url = new URL(loc, url).href; continue; }
    break;
  }
  return { page, cookies };
}

// "fetch failed" de undici esconde la causa real en e.cause (EAI_AGAIN, ECONNREFUSED, cert…):
// desenrollamos la cadena para ver el código de red de verdad.
const errDetail = (e) => {
  const parts = [];
  for (let x = e; x; x = x.cause) parts.push(x.code ?? x.message ?? String(x));
  return [...new Set(parts)].join(' ← ');
};

// MODO TEST:  node fise-relay-celular.mjs test
// Prueba la conexión del CELULAR → FISE directamente (sin VPS): dice si esta red alcanza el portal.
if (BASE_RAW === 'test') {
  console.log(`[${ts()}] probando ${PAGE} desde esta red…`);
  const t0 = Date.now();
  try {
    const { page, cookies } = await fiseGet(PAGE);
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`✅ HTTP ${page.status} en ${dt}s (${page.text.length} bytes, ${cookies.length} cookie(s))`);
    console.log(`   consultaId presente: ${/consultaId/.test(page.text) ? 'sí' : 'no'} — esta red SÍ alcanza FISE`);
  } catch (e) {
    console.error(`❌ falló en ${((Date.now() - t0) / 1000).toFixed(2)}s: ${errDetail(e)}`);
    console.error('   Esta red NO alcanza FISE. Prueba apagando el Wi-Fi (solo datos) o al revés, y repite el test.');
  }
  process.exit(0);
}

// MODO TEST-INFOGAS:  node fise-relay-celular.mjs test-infogas
// ¿Esta red pasa el Cloudflare de Infogas con HTTP PLANO (sin navegador)? Si sí, Infogas también
// podría servirse por este relay (hoy va por Chrome real en el VPS). Señal determinista del
// challenge: header `cf-mitigated: challenge` (además del title "Un momento…").
if (BASE_RAW === 'test-infogas') {
  const URL_IG = 'https://vh.infogas.com.pe/';
  console.log(`[${ts()}] probando ${URL_IG} desde esta red…`);
  const t0 = Date.now();
  try {
    const { page } = await fiseGet(URL_IG);
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    const title = (/<title[^>]*>([^<]*)</i.exec(page.text)?.[1] ?? '').trim();
    const mitigated = page.headers['cf-mitigated'] ?? null;
    const hasForm = /inp_ck_plate|n_placa/.test(page.text);
    console.log(`HTTP ${page.status} en ${dt}s (${page.text.length} bytes) · title="${title}"${mitigated ? ` · cf-mitigated=${mitigated}` : ''}`);
    if (hasForm) console.log('✅ el FORM de placa está en el HTML — Cloudflare NO bloqueó: Infogas sería viable por este relay');
    else if (mitigated || /un momento|just a moment|attention required/i.test(`${title} ${page.text.slice(0, 600)}`)) console.log('❌ Cloudflare devolvió el challenge — sin navegador no pasa desde esta red');
    else console.log('⚠ respuesta no reconocida (ni form ni challenge) — pásame el title/status para analizarla');
  } catch (e) {
    console.error(`❌ falló: ${errDetail(e)}`);
  }
  process.exit(0);
}

if (!BASE_RAW || !TOKEN) {
  console.error('Uso: node fise-relay-celular.mjs <URL-del-VPS> <token>');
  console.error('Ej.: node fise-relay-celular.mjs http://149.104.66.122:3011 abc123');
  console.error('Test de red (sin VPS): node fise-relay-celular.mjs test | test-infogas');
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/+$/, '');

// Consulta FISE completa: GET inicio (cookies de sesión + consultaId) → POST buscarSaldo con el
// token v3 que ya resolvió el VPS. Devuelve el JSON crudo; el parseo de montos vive en el VPS.
async function consulta(job) {
  const { page, cookies } = await fiseGet(PAGE);
  const consultaId = /id="consultaId"[^>]*value="([^"]*)"/.exec(page.text)?.[1]
    ?? /name="consultaId"[^>]*value="([^"]*)"/.exec(page.text)?.[1] ?? '';
  const r2 = await fiseFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: PAGE,
      ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
    },
    body: JSON.stringify({ placaVehiculo: job.plate, consultaId, codigoVerificacion: job.captchaToken, tiempoSession: 8, countBusqueda: 1 }),
  });
  return { httpStatus: r2.status, bodyText: r2.text };
}

acquireWakeLock();
console.log(`[${ts()}] worker FISE encendido → ${BASE} (Ctrl+C para salir)`);
let errStreak = 0;
let lastBeat = Date.now();
for (;;) {
  try {
    const res = await fetch(`${BASE}/api/fise-relay/next?token=${encodeURIComponent(TOKEN)}`, { signal: AbortSignal.timeout(15000) });
    if (res.status === 403) { console.error(`[${ts()}] token RECHAZADO por el VPS — revisa FISE_RELAY_TOKEN en /root/placape.env`); process.exit(1); }
    const { job } = await res.json();
    if (errStreak) { console.log(`[${ts()}] VPS de vuelta en línea`); errStreak = 0; }
    if (job) {
      console.log(`[${ts()}] job ${job.id} · placa ${job.plate}…`);
      let out;
      try { out = { id: job.id, ok: true, ...(await consulta(job)) }; }
      catch (e) { out = { id: job.id, ok: false, error: errDetail(e) }; }
      await fetch(`${BASE}/api/fise-relay/result?token=${encodeURIComponent(TOKEN)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(out),
        signal: AbortSignal.timeout(15000),
      }).catch((e) => console.error(`[${ts()}] no pude devolver el resultado: ${e.message}`));
      console.log(`[${ts()}] job ${job.id} → ${out.ok ? `HTTP ${out.httpStatus} (${(out.bodyText ?? '').length} bytes)` : `ERROR ${out.error}`}`);
      lastBeat = Date.now();
      continue; // sin pausa: puede haber otro job esperando en la cola
    }
    // Latido de vida: el poll salió bien pero no había trabajo. Cada ~5 min dejamos constancia en el
    // log para que el operador vea de un vistazo que el relay sigue despierto (no lo durmió el SO).
    if (Date.now() - lastBeat > 300000) { console.log(`[${ts()}] sigo vivo (polling OK, sin trabajos)`); lastBeat = Date.now(); }
  } catch (e) {
    errStreak++;
    if (errStreak % 15 === 1) console.error(`[${ts()}] VPS inalcanzable: ${String(e?.message ?? e)} (sigo reintentando cada 4s)`);
  }
  await sleep(4000);
}
