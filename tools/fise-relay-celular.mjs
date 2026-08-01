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

const [, , BASE_RAW, TOKEN] = process.argv;
if (!BASE_RAW || !TOKEN) {
  console.error('Uso: node fise-relay-celular.mjs <URL-del-VPS> <token>');
  console.error('Ej.: node fise-relay-celular.mjs http://149.104.66.122:3011 abc123');
  process.exit(1);
}
const BASE = BASE_RAW.replace(/\/+$/, '');

const PAGE = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/inicio';
const ENDPOINT = 'https://fise.minem.gob.pe:23308/consulta-taller/pages/consultaTaller/buscarSaldo';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);

// Consulta FISE completa: GET inicio (cookies de sesión + consultaId) → POST buscarSaldo con el
// token v3 que ya resolvió el VPS. Devuelve el JSON crudo; el parseo de montos vive en el VPS.
async function consulta(job) {
  const r1 = await fetch(PAGE, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const setCookies = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [];
  const cookie = (setCookies ?? []).map((c) => c.split(';')[0]).join('; ');
  const html = await r1.text();
  const consultaId = /id="consultaId"[^>]*value="([^"]*)"/.exec(html)?.[1]
    ?? /name="consultaId"[^>]*value="([^"]*)"/.exec(html)?.[1] ?? '';
  const r2 = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: PAGE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ placaVehiculo: job.plate, consultaId, codigoVerificacion: job.captchaToken, tiempoSession: 8, countBusqueda: 1 }),
    signal: AbortSignal.timeout(25000),
  });
  return { httpStatus: r2.status, bodyText: await r2.text() };
}

console.log(`[${ts()}] worker FISE encendido → ${BASE} (Ctrl+C para salir)`);
let errStreak = 0;
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
      catch (e) { out = { id: job.id, ok: false, error: String(e?.message ?? e) }; }
      await fetch(`${BASE}/api/fise-relay/result?token=${encodeURIComponent(TOKEN)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(out),
        signal: AbortSignal.timeout(15000),
      }).catch((e) => console.error(`[${ts()}] no pude devolver el resultado: ${e.message}`));
      console.log(`[${ts()}] job ${job.id} → ${out.ok ? `HTTP ${out.httpStatus} (${(out.bodyText ?? '').length} bytes)` : `ERROR ${out.error}`}`);
      continue; // sin pausa: puede haber otro job esperando en la cola
    }
  } catch (e) {
    errStreak++;
    if (errStreak % 15 === 1) console.error(`[${ts()}] VPS inalcanzable: ${String(e?.message ?? e)} (sigo reintentando cada 4s)`);
  }
  await sleep(4000);
}
