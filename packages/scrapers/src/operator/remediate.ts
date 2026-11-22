/**
 * MANTENIMIENTO AUTOMÁTICO después del chequeo diario (agente de mantenimiento, niveles 1 y 3).
 *
 *  - Nivel 1 (automático, sin IA): clasifica cada falla, comprueba si el portal responde desde el VPS,
 *    reintenta la fuente (2 veces, separadas) y reinicia procesos pm2 caídos que no son de cron.
 *  - Nivel 3 (aviso): lo que sigue roto se explica en el correo diario con la causa probable y qué hacer.
 *  - Nivel 2 (Claude corrige código con aprobación) se apoya en `kind === 'pagina-cambio'`: hoy solo se
 *    señala en el aviso.
 *
 * Este archivo es lógica PURA (clasificación, consejos, render) para poder testearla; las acciones
 * (reintentos, probes, pm2) las ejecuta operator-server.
 */

export type FailureKind = 'portal-caido' | 'pagina-cambio' | 'captcha' | 'sesion' | 'desconocido';

export interface RemediationAttempt { at: string; ok: boolean; status: string; summary: string }
export interface RemediationProbe { url: string; reachable: boolean; detail: string }
export interface RemediationItem {
  source: string;
  placa: string;
  kind: FailureKind;
  probe?: RemediationProbe | null;
  attempts: RemediationAttempt[];
  fixed: boolean;
}
export interface RemediationAction { label: string; ok: boolean; detail: string }
export interface Remediation {
  startedAt: string;
  finishedAt?: string;
  items: RemediationItem[];
  actions: RemediationAction[];
}

/** Causa probable de una falla a partir del resumen del motor + las últimas líneas del log. */
export function classifyFailure(text: string): FailureKind {
  const t = text.toLowerCase();
  // El portal no contesta: DNS, conexión rechazada/cortada, 5xx o la navegación inicial agotó el tiempo.
  if (/err_name_not_resolved|enotfound|eai_again|err_connection_(refused|reset|timed_out|closed)|err_address_unreachable|econnrefused|econnreset|etimedout|service unavailable|bad gateway|gateway time-?out|http 50[0-9]|\b50[234]\b/.test(t)) return 'portal-caido';
  if (/page\.goto:[^\n]*timeout/.test(t)) return 'portal-caido';
  if (/captcha|turnstile|recaptcha|capsolver/.test(t)) return 'captcha';
  if (/sesi[oó]n (finalizada|expirada|caducada)|inicio de sesi[oó]n|re-?login|usuario bloqueado|cuenta bloqueada/.test(t)) return 'sesion';
  if (/locator|waitfor|selector|no encontr|not found|sin-frame|timeout \d+ms exceeded|cannot read prop|unexpected token|is not a function/.test(t)) return 'pagina-cambio';
  return 'desconocido';
}

/** Primera URL http(s) del texto (los errores de Playwright la incluyen: "navigating to https://…"). */
export function firstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s"'<>)\]]+/.exec(text);
  return m ? m[0].replace(/[.,;:]+$/, '') : null;
}

const KIND_LABEL: Record<FailureKind, string> = {
  'portal-caido': 'portal caído o sin conexión',
  'pagina-cambio': 'la página del Estado cambió',
  captcha: 'captcha sin resolver',
  sesion: 'sesión de SUNARP',
  desconocido: 'causa no identificada',
};
export const kindLabel = (k: FailureKind): string => KIND_LABEL[k];

/** Qué pasó y qué hacer, en lenguaje simple, para el aviso. */
export function adviceFor(it: RemediationItem): string {
  if (it.fixed) {
    const n = it.attempts.findIndex((a) => a.ok) + 1;
    return `Se recuperó sola en el reintento ${n} (falla pasajera). No hay que hacer nada.`;
  }
  switch (it.kind) {
    case 'portal-caido':
      return it.probe && !it.probe.reachable
        ? `El portal no responde desde el VPS (${it.probe.detail}). Suele ser una caída del propio portal: no depende de nosotros. Mañana se vuelve a revisar; si sigue así 2 días, conviene revisar si cambió de dirección.`
        : 'El portal responde, pero la consulta no terminó: puede estar lento o bloqueando la IP del VPS. Revisa la captura en la consola (Salud de fuentes).';
    case 'captcha':
      return 'El captcha no se resolvió en 3 intentos. Revisa el saldo de CapSolver en este mismo correo; si hay saldo, el portal pudo cambiar su captcha y hace falta ajustar el código (pídeselo a Claude).';
    case 'sesion':
      return 'Falla de sesión con SUNARP. Revisa que la cuenta SPRL no esté bloqueada y el proceso sprl-keepalive (ssh placape-vps logs sprl-keepalive 50).';
    case 'pagina-cambio':
      return 'La página del Estado parece haber cambiado (el motor no encuentra el formulario o el botón). Hace falta ajustar el código: pídele a Claude que la corrija; te pedirá aprobación antes de publicar.';
    default:
      return 'No pude identificar la causa. Revisa el log y la captura en la consola (Salud de fuentes).';
  }
}

export function remediationCounts(rem: Remediation): { total: number; fixed: number; pending: number } {
  const fixed = rem.items.filter((i) => i.fixed).length;
  return { total: rem.items.length, fixed, pending: rem.items.length - fixed };
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Bloque de texto plano para el correo diario. */
export function remediationText(rem: Remediation): string[] {
  const c = remediationCounts(rem);
  const out = ['MANTENIMIENTO AUTOMÁTICO', `  ${c.fixed} de ${c.total} falla(s) resueltas solas · ${c.pending} necesitan atención`];
  for (const a of rem.actions) out.push(`  ${a.ok ? '✔' : '✖'} ${a.label}: ${a.detail}`);
  for (const it of rem.items) {
    out.push(`  ${it.fixed ? '✔' : '✖'} ${it.source} (${it.placa}) · ${kindLabel(it.kind)} · ${it.attempts.length} reintento(s)`);
    out.push(`      ${adviceFor(it)}`);
  }
  return out;
}

/** Bloque HTML para el correo diario (va ARRIBA: es lo primero que hay que leer). */
export function remediationHtml(rem: Remediation): string {
  const c = remediationCounts(rem);
  const pending = rem.items.filter((i) => !i.fixed);
  const fixed = rem.items.filter((i) => i.fixed);
  const row = (it: RemediationItem) => `<tr style="border-top:1px solid #DCE2EC"><td style="padding:6px 8px;white-space:nowrap;vertical-align:top"><b>${esc(it.source)}</b><div style="font-size:11px;color:#5D6B7E">${esc(kindLabel(it.kind))}</div></td><td style="padding:6px 8px;font-size:13px">${esc(adviceFor(it))}</td></tr>`;
  return `<div style="border:1px solid ${c.pending ? '#F5C77E' : '#A7E3C0'};background:${c.pending ? '#FFFBEB' : '#F0FDF4'};border-radius:10px;padding:10px 12px;margin:12px 0">
<div style="font-weight:700;margin-bottom:4px">Mantenimiento automático: ${c.fixed} de ${c.total} resueltas solas${c.pending ? ` · <span style="color:#B45309">${c.pending} necesitan atención</span>` : ''}</div>
${rem.actions.length ? `<ul style="margin:4px 0;padding-left:18px;font-size:13px">${rem.actions.map((a) => `<li>${a.ok ? '✔' : '✖'} ${esc(a.label)}: ${esc(a.detail)}</li>`).join('')}</ul>` : ''}
${pending.length ? `<table style="border-collapse:collapse;width:100%">${pending.map(row).join('')}</table>` : ''}
${fixed.length ? `<div style="font-size:12px;color:#15803D;margin-top:6px">Recuperadas al reintentar: ${esc(fixed.map((i) => i.source).join(', '))}</div>` : ''}
</div>`;
}
