/**
 * SALUD DIARIA DE FUENTES — lógica PURA (sin fs/red) del chequeo que corre el motor cada día:
 * encola unas placas TESTIGO por la ruta real de producción, y con sus resultados decide qué
 * fuentes están sanas, intermitentes o caídas. El server (operator-server.ts) hace la parte
 * impura: encolar, esperar, leer los snapshots, chequear infraestructura y enviar el aviso.
 *
 * Veredicto por fuente (sobre TODAS las placas testigo donde corrió):
 *  - ok           → ninguna corrida en ERROR.
 *  - intermitente → falló en algunas placas y respondió en otras (portal inestable / caso de placa).
 *  - falla        → ERROR en todas las placas → el scraper o el portal están rotos.
 *  - dependencia  → ERROR en todas, pero solo por dependencia caída (GNV sin señal de combustible
 *                   porque el historial falló) → la causa real está en OTRA fuente.
 *  - sin-dato     → no hubo resultado (pedido no atendido, timeout o placa sin reporte).
 */

export type SourceVerdict = 'ok' | 'intermitente' | 'falla' | 'dependencia' | 'sin-dato';

export interface HealthInputResult { source: string; status: string; summary?: string }

export interface HealthSourceRow {
  source: string;
  verdict: SourceVerdict;
  ok: number;
  err: number;
  /** Errores por placa (resumen del motor), para diagnosticar sin abrir la consola. */
  errors: Array<{ placa: string; summary: string }>;
  /** Últimas líneas del log de la fuente (las agrega el server para las que fallan). */
  logTail?: string[];
}

export type InfraSeverity = 'ok' | 'warn' | 'fail';
export interface InfraCheck { id: string; label: string; severity: InfraSeverity; detail: string }

export type Overall = 'ok' | 'alerta' | 'critico';

export interface HealthRun {
  trigger: 'diario' | 'manual';
  startedAt: string;
  finishedAt?: string;
  plates: string[];
  pedidos: Array<{ placa: string; id: string; estado: string }>;
  infra: InfraCheck[];
  sources: HealthSourceRow[];
  overall: Overall;
  headline: string;
  note?: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '-');
const isGood = (status: string): boolean => status === 'ENCONTRADO' || status === 'SIN_REGISTRO';
const DEP_FAIL_RE = /no ejecutada: sin señal de combustible/i;

export function evaluateSources(
  byPlate: Array<{ placa: string; results: HealthInputResult[] | null }>,
  expected: string[],
): HealthSourceRow[] {
  const rows: HealthSourceRow[] = expected.map((id) => {
    const n = norm(id);
    let ok = 0;
    let err = 0;
    const errors: HealthSourceRow['errors'] = [];
    for (const p of byPlate) {
      const r = p.results?.find((x) => norm(x.source) === n);
      if (!r) continue;
      if (isGood(r.status)) ok++;
      else { err++; errors.push({ placa: p.placa, summary: (r.summary ?? r.status).slice(0, 220) }); }
    }
    let verdict: SourceVerdict;
    if (ok + err === 0) verdict = 'sin-dato';
    else if (err === 0) verdict = 'ok';
    else if (ok > 0) verdict = 'intermitente';
    else if (errors.every((e) => DEP_FAIL_RE.test(e.summary))) verdict = 'dependencia';
    else verdict = 'falla';
    return { source: id, verdict, ok, err, errors };
  });
  const rank: Record<SourceVerdict, number> = { falla: 0, 'sin-dato': 1, intermitente: 2, dependencia: 3, ok: 4 };
  return rows.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}

export function overallOf(infra: InfraCheck[], sources: HealthSourceRow[]): Overall {
  if (infra.some((c) => c.severity === 'fail')) return 'critico';
  const broken = sources.filter((s) => s.verdict === 'falla' || s.verdict === 'sin-dato').length;
  // Media plataforma caída = crítico aunque la infraestructura "se vea" bien (p. ej. falta un binario).
  if (sources.length && broken >= Math.ceil(sources.length / 2)) return 'critico';
  if (broken || sources.some((s) => s.verdict !== 'ok') || infra.some((c) => c.severity === 'warn')) return 'alerta';
  return 'ok';
}

export function headlineOf(overall: Overall, infra: InfraCheck[], sources: HealthSourceRow[]): string {
  const total = sources.length;
  const okN = sources.filter((s) => s.verdict === 'ok').length;
  const fails = sources.filter((s) => s.verdict === 'falla' || s.verdict === 'sin-dato').map((s) => s.source);
  const infraFail = infra.filter((c) => c.severity === 'fail').map((c) => c.label);
  if (overall === 'ok') return `Todo en orden · ${okN}/${total} fuentes OK`;
  const parts: string[] = [];
  if (infraFail.length) parts.push(`infra: ${infraFail.join(', ')}`);
  if (fails.length) parts.push(`${fails.length} caída(s): ${fails.slice(0, 6).join(', ')}${fails.length > 6 ? '…' : ''}`);
  if (total) parts.push(`${okN}/${total} OK`);
  return parts.join(' · ') || 'Revisar avisos';
}

/** Rol de la llave de Supabase. La anon/publishable hace que RLS bloquee la cola EN SILENCIO
 *  (lecturas vacías + inserts 42501), así que se detecta por forma, sin tocar la red. */
export function supabaseKeyKind(key: string): 'service' | 'publica' | 'desconocida' | 'vacia' {
  const k = key.trim();
  if (!k) return 'vacia';
  if (k.startsWith('sb_secret_')) return 'service';
  if (k.startsWith('sb_publishable_')) return 'publica';
  const parts = k.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
      if (p.role === 'service_role') return 'service';
      if (p.role === 'anon') return 'publica';
    } catch { /* no es JWT */ }
  }
  return 'desconocida';
}

const LIMA_OFFSET_MS = 5 * 3600 * 1000; // Perú: UTC-5 todo el año (sin horario de verano)
export const limaDateKey = (now: number): string => new Date(now - LIMA_OFFSET_MS).toISOString().slice(0, 10);
export const limaHour = (now: number): number => new Date(now - LIMA_OFFSET_MS).getUTCHours();

/** ¿Toca el chequeo diario? Desde la hora configurada, una vez por día de Lima (si el motor estuvo
 *  caído a esa hora, corre apenas vuelva ese mismo día). */
export function shouldRunDaily(now: number, hour: number, lastDayKey: string | null): boolean {
  return limaHour(now) >= hour && limaDateKey(now) !== lastDayKey;
}

const VERDICT_LABEL: Record<SourceVerdict, string> = {
  ok: 'OK', intermitente: 'Intermitente', falla: 'CAÍDA', dependencia: 'Dependencia caída', 'sin-dato': 'Sin dato',
};
const SEV_ICON: Record<InfraSeverity, string> = { ok: '✓', warn: '⚠', fail: '✕' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function renderHealthEmail(run: HealthRun): { subject: string; text: string; html: string } {
  const icon = run.overall === 'ok' ? '✅' : run.overall === 'alerta' ? '⚠️' : '🚨';
  const subject = `${icon} PlacaPe · salud de fuentes · ${run.headline}`;
  const lines: string[] = [`${run.headline}`, `Placas testigo: ${run.plates.join(', ') || '(ninguna)'} · ${run.startedAt}`, ''];
  if (run.note) lines.push(run.note, '');
  lines.push('INFRAESTRUCTURA');
  for (const c of run.infra) lines.push(`  ${SEV_ICON[c.severity]} ${c.label}: ${c.detail}`);
  lines.push('', 'FUENTES');
  for (const s of run.sources) {
    lines.push(`  [${VERDICT_LABEL[s.verdict]}] ${s.source} (ok ${s.ok} · error ${s.err})`);
    for (const e of s.errors.slice(0, 2)) lines.push(`      ${e.placa}: ${e.summary}`);
    for (const l of (s.logTail ?? []).slice(-3)) lines.push(`      log> ${l}`);
  }
  const color: Record<SourceVerdict, string> = { ok: '#15803D', intermitente: '#B45309', falla: '#B91C1C', dependencia: '#6D28D9', 'sin-dato': '#B91C1C' };
  const sevColor: Record<InfraSeverity, string> = { ok: '#15803D', warn: '#B45309', fail: '#B91C1C' };
  const html = `<div style="font:14px/1.5 system-ui,sans-serif;color:#1F2733;max-width:720px">
<h2 style="margin:0 0 4px">${icon} ${esc(run.headline)}</h2>
<div style="color:#5D6B7E;font-size:12px">Placas testigo: ${esc(run.plates.join(', ') || '(ninguna)')} · ${esc(run.startedAt)}</div>
${run.note ? `<p style="background:#FEF3C7;padding:8px 10px;border-radius:8px">${esc(run.note)}</p>` : ''}
<h3 style="margin:16px 0 6px">Infraestructura</h3>
<table style="border-collapse:collapse;font-size:13px">${run.infra.map((c) => `<tr><td style="padding:2px 8px;color:${sevColor[c.severity]};font-weight:700">${SEV_ICON[c.severity]}</td><td style="padding:2px 8px"><b>${esc(c.label)}</b></td><td style="padding:2px 8px;color:#5D6B7E">${esc(c.detail)}</td></tr>`).join('')}</table>
<h3 style="margin:16px 0 6px">Fuentes</h3>
<table style="border-collapse:collapse;font-size:13px;width:100%">${run.sources.map((s) => `<tr style="border-top:1px solid #DCE2EC"><td style="padding:5px 8px;white-space:nowrap"><b>${esc(s.source)}</b></td><td style="padding:5px 8px;color:${color[s.verdict]};font-weight:700;white-space:nowrap">${VERDICT_LABEL[s.verdict]}</td><td style="padding:5px 8px;color:#5D6B7E;font-size:12px">${s.errors.slice(0, 2).map((e) => `${esc(e.placa)}: ${esc(e.summary)}`).join('<br>')}${(s.logTail ?? []).length ? `<pre style="margin:4px 0 0;font-size:11px;white-space:pre-wrap;color:#475569">${esc((s.logTail ?? []).slice(-3).join('\n'))}</pre>` : ''}</td></tr>`).join('')}</table>
<p style="color:#5D6B7E;font-size:12px;margin-top:16px">Detalle, capturas y logs: consola del operador → pestaña "Salud de fuentes".</p></div>`;
  return { subject, text: lines.join('\n'), html };
}
