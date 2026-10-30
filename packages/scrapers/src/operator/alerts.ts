/**
 * ALARMAS DE CLIENTE — lógica PURA (sin fs/red). Cada pedido de un cliente (web, cupo, bot, reintento;
 * todo lo que NO sea 'operador') deja un "resultado de entrega". Si el reporte que recibió el cliente
 * trae fuentes en ERROR —o no salió reporte— se arma una alarma para el operador. El server agrupa las
 * alarmas en una ventana corta (evita una ráfaga de correos si cae un portal) y las guarda para el
 * resumen diario.
 */

export interface OutcomeSourceResult { source: string; status: string; summary?: string }

export interface ClientOutcome {
  at: string;
  pedidoId: string;
  placa: string;
  tier: string;
  /** Canal del pedido: servicio (web), cupo, reintento, bot… */
  origin: string;
  /** Contacto enmascarado (el correo va a un buzón, no a la consola pública). */
  contact: string;
  /** PRO/ULTRA = reporte de pago (o cupo asignado): un error ahí es más grave. */
  paid: boolean;
  /** Sin reporte: ninguna fuente respondió o el motor reventó. */
  fatal: boolean;
  fatalMsg?: string;
  total: number;
  failed: Array<{ source: string; summary: string; dependency: boolean }>;
}

export type AlertLevel = 'ok' | 'alerta' | 'critico';

const isGood = (status: string): boolean => status === 'ENCONTRADO' || status === 'SIN_REGISTRO';
const DEP_FAIL_RE = /no ejecutada: sin señal de combustible/i;

export const isClientOrigin = (origin: string | null | undefined): boolean =>
  String(origin ?? 'servicio').toLowerCase() !== 'operador';

/** j***@gmail.com · ***-***-123. Nunca el contacto completo en correos ni logs. */
export function maskContact(email?: string | null, whatsapp?: string | null): string {
  const e = String(email ?? '').trim();
  if (e.includes('@')) {
    const [u, d] = e.split('@');
    return `${(u ?? '').slice(0, 1)}***@${d ?? ''}`;
  }
  const w = String(whatsapp ?? '').replace(/\D/g, '');
  if (w.length >= 3) return `wa ***${w.slice(-3)}`;
  return 'anónimo';
}

export function outcomeOf(
  p: { id: string | number; placa: string; tier?: string | null; origin?: string | null; email?: string | null; whatsapp?: string | null; userId?: string | null },
  results: OutcomeSourceResult[],
  at: string,
  fatalMsg?: string,
): ClientOutcome {
  const tier = String(p.tier ?? 'PRO').toUpperCase();
  const failed = results
    .filter((r) => !isGood(r.status))
    .map((r) => ({ source: r.source.toLowerCase().replace(/_/g, '-'), summary: (r.summary ?? r.status).slice(0, 200), dependency: DEP_FAIL_RE.test(r.summary ?? '') }));
  const fatal = Boolean(fatalMsg) || (results.length > 0 && failed.length === results.length);
  return {
    at,
    pedidoId: String(p.id),
    placa: p.placa,
    tier,
    origin: String(p.origin ?? 'servicio').toLowerCase(),
    contact: p.userId && !p.email && !p.whatsapp ? 'cuenta web' : maskContact(p.email, p.whatsapp),
    paid: tier === 'PRO' || tier === 'ULTRA',
    fatal,
    fatalMsg: fatalMsg ? fatalMsg.slice(0, 200) : fatal ? 'ninguna fuente respondió' : undefined,
    total: results.length,
    failed,
  };
}

/** critico = el cliente no recibió reporte; alerta = lo recibió con huecos; ok = completo. */
export function levelOf(o: ClientOutcome): AlertLevel {
  if (o.fatal) return 'critico';
  return o.failed.length ? 'alerta' : 'ok';
}

const LEVEL_ICON: Record<AlertLevel, string> = { ok: '✅', alerta: '⚠️', critico: '🚨' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Fuentes que más fallaron en un conjunto de entregas (sin contar las caídas por dependencia). */
export function topFailing(outcomes: ClientOutcome[], n = 6): Array<{ source: string; count: number }> {
  const m = new Map<string, number>();
  for (const o of outcomes) for (const f of o.failed) if (!f.dependency) m.set(f.source, (m.get(f.source) ?? 0) + 1);
  return [...m.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

export function renderClientAlertEmail(outcomes: ClientOutcome[], consoleUrl?: string): { subject: string; text: string; html: string } {
  const crit = outcomes.filter((o) => o.fatal).length;
  const level: AlertLevel = crit ? 'critico' : 'alerta';
  const plates = [...new Set(outcomes.map((o) => o.placa))];
  const top = topFailing(outcomes, 4);
  const subject = `${LEVEL_ICON[level]} PlacaPe · ${outcomes.length === 1 ? `reporte con error a un cliente (${plates[0]})` : `${outcomes.length} reportes con error a clientes`}`
    + `${crit ? ` · ${crit} SIN reporte` : ''}${top.length ? ` · ${top.map((t) => t.source).join(', ')}` : ''}`;
  const line = (o: ClientOutcome): string => {
    const what = o.fatal ? `SIN REPORTE (${o.fatalMsg ?? 'ninguna fuente respondió'})` : `${o.failed.length}/${o.total} fuentes con error`;
    return `${o.placa} · ${o.tier}${o.paid ? ' (pago)' : ''} · ${o.origin} · ${o.contact} · ${what} · pedido ${o.pedidoId}`;
  };
  const text = [
    `${outcomes.length} entrega(s) a clientes con problemas:`, '',
    ...outcomes.flatMap((o) => [line(o), ...o.failed.slice(0, 8).map((f) => `    ${f.dependency ? '(dep) ' : ''}${f.source}: ${f.summary}`)]),
    '', consoleUrl ? `Consola: ${consoleUrl} → Historial (filtra por placa) → Reintentar.` : 'Consola del operador → Historial → Reintentar.',
  ].join('\n');
  const html = `<div style="font:14px/1.5 system-ui,sans-serif;color:#1F2733;max-width:720px">
<h2 style="margin:0 0 8px">${LEVEL_ICON[level]} ${esc(subject.replace(/^\S+ PlacaPe · /, ''))}</h2>
${outcomes.map((o) => `<div style="border-top:1px solid #DCE2EC;padding:8px 0">
<div><b>${esc(o.placa)}</b> · ${esc(o.tier)}${o.paid ? ' <b style="color:#B45309">(pago)</b>' : ''} · ${esc(o.origin)} · ${esc(o.contact)} · <span style="color:${o.fatal ? '#B91C1C' : '#B45309'};font-weight:700">${o.fatal ? 'SIN REPORTE' : `${o.failed.length}/${o.total} con error`}</span></div>
<div style="color:#5D6B7E;font-size:12px">pedido ${esc(o.pedidoId)} · ${esc(o.at)}${o.fatal && o.fatalMsg ? ` · ${esc(o.fatalMsg)}` : ''}</div>
${o.failed.length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:13px">${o.failed.slice(0, 8).map((f) => `<li><b>${esc(f.source)}</b>${f.dependency ? ' <i>(dependencia)</i>' : ''}: <span style="color:#5D6B7E">${esc(f.summary)}</span></li>`).join('')}</ul>` : ''}
</div>`).join('')}
<p style="color:#5D6B7E;font-size:12px;margin-top:12px">${consoleUrl ? `<a href="${esc(consoleUrl)}">Consola</a>` : 'Consola del operador'} → Historial → filtra por placa → Reintentar las fuentes en error.</p></div>`;
  return { subject, text, html };
}

export interface ClientsSummary {
  since: string;
  total: number;
  ok: number;
  conError: number;
  sinReporte: number;
  pagados: number;
  pagadosConProblema: number;
  porCanal: Record<string, number>;
  top: Array<{ source: string; count: number }>;
  /** Las entregas con problema más recientes (máx. 15). */
  problemas: ClientOutcome[];
}

export function summarizeClients(outcomes: ClientOutcome[], sinceMs: number): ClientsSummary {
  const win = outcomes.filter((o) => Date.parse(o.at) >= sinceMs);
  const bad = win.filter((o) => levelOf(o) !== 'ok');
  const porCanal: Record<string, number> = {};
  for (const o of win) porCanal[o.origin] = (porCanal[o.origin] ?? 0) + 1;
  return {
    since: new Date(sinceMs).toISOString(),
    total: win.length,
    ok: win.length - bad.length,
    conError: bad.filter((o) => !o.fatal).length,
    sinReporte: bad.filter((o) => o.fatal).length,
    pagados: win.filter((o) => o.paid).length,
    pagadosConProblema: bad.filter((o) => o.paid).length,
    porCanal,
    top: topFailing(win),
    problemas: bad.slice(0, 15),
  };
}

/**
 * ¿Toca despachar el buffer de alarmas? Una entrega SIN reporte sale de inmediato; el resto espera la
 * ventana (para agrupar una ráfaga en un solo correo). Tope por hora para no inundar el buzón: lo que
 * no sale se queda en el buffer y viaja en el siguiente envío.
 */
export function shouldFlush(buffer: ClientOutcome[], now: number, windowMs: number, sentInLastHour: number, maxPerHour: number): boolean {
  if (!buffer.length || sentInLastHour >= maxPerHour) return false;
  if (buffer.some((o) => o.fatal)) return true;
  const first = Math.min(...buffer.map((o) => Date.parse(o.at)));
  return now - first >= windowMs;
}
