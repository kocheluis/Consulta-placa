/**
 * Helpers PUROS del bot (sin Supabase ni Next): normalización de teléfono/placa y el resumen del
 * reporte para WhatsApp. Separados de `lib/bot.ts` para poder testearlos aislados. `lib/bot.ts` los
 * re-exporta, así el resto del código sigue importando desde '@/lib/bot'.
 */
import crypto from 'node:crypto';
import { computeScore, ScoreLevel, type Report } from '@app/shared';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';

/** Código OTP de 6 dígitos (aleatorio criptográfico) para la vinculación del número. */
export function genOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Hash del OTP (SHA-256). Se guarda el HASH, nunca el código en claro. */
export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Normaliza un número de WhatsApp a solo dígitos en formato país. WhatsApp Cloud API entrega el
 * `wa_id` como `51987654321` (código país + número, sin '+'). Un celular peruano suelto (9 dígitos,
 * empieza en 9) se prefija con 51. Devuelve '' si no queda nada usable.
 */
export function normPhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9 && digits.startsWith('9')) return `51${digits}`;
  return digits;
}

/** Normaliza una placa peruana (6–7 alfanuméricos, mayúsculas). '' si inválida. */
export function normPlaca(raw: string): string {
  const p = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length >= 6 && p.length <= 7 ? p : '';
}

const scoreEmoji = (level: ScoreLevel): string =>
  level === ScoreLevel.GOOD ? '🟢' : level === ScoreLevel.WARNING ? '🟡' : level === ScoreLevel.BAD ? '🔴' : '⚪';
const scoreLabel = (level: ScoreLevel): string =>
  level === ScoreLevel.GOOD ? 'Riesgo bajo' : level === ScoreLevel.WARNING ? 'Revisar' : level === ScoreLevel.BAD ? 'Riesgo alto' : 'Sin score suficiente';

export interface ReportSummary {
  text: string;
  url: string;
  score: { overall: number | null; level: ScoreLevel; letter: string | null } | null;
  vehicle: { brand: string | null; model: string | null; year: number | null; color: string | null } | null;
  plateNotFound: boolean;
}

/**
 * Resumen del reporte listo para enviar por WhatsApp (texto con *negritas* de WA). Usa el score
 * determinístico ya existente. El `Report` ya trae los nombres de TERCEROS enmascarados (Ley 29733),
 * así que este resumen es seguro para el cliente por construcción.
 */
export function reportSummary(report: Report): ReportSummary {
  const url = `${SITE_URL}/reporte/${encodeURIComponent(report.placa)}`;
  if (report.plateNotFound) {
    return {
      text: `⚠️ La placa *${report.placa}* no figura registrada en SUNARP a la fecha. No se generó reporte (no se cobra ni consume cupo).`,
      url, score: null, vehicle: null, plateNotFound: true,
    };
  }
  const v = report.vehicle;
  const veh = v ? { brand: v.brand, model: v.model, year: v.year, color: v.color } : null;
  const vehLine = v
    ? [[v.brand, v.model, v.year].filter(Boolean).join(' '), v.color].filter(Boolean).join(' · ')
    : '';
  const s = computeScore(report);
  const header = vehLine ? `🚗 *${report.placa}* — ${vehLine}` : `🚗 *${report.placa}*`;

  const lines: string[] = [header, ''];
  if (s.overall != null) {
    lines.push(`*Score: ${s.overall}/100* ${scoreEmoji(s.level)} ${scoreLabel(s.level)}`, '');
  }
  for (const c of s.concepts) {
    if (c.score == null) continue; // concepto sin datos → no lo listamos
    const reason = c.reasons.join(' ').slice(0, 140);
    lines.push(`• *${c.label}* (${c.score}): ${reason}`);
  }
  lines.push('', `📄 Reporte completo: ${url}`);

  return {
    text: lines.join('\n'),
    url,
    score: { overall: s.overall, level: s.level, letter: s.letter },
    vehicle: veh,
    plateNotFound: false,
  };
}
