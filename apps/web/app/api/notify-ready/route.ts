import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { reportReadyEmail, type ScoreLevel as EmailScoreLevel } from '@/lib/email-templates';
import { sendWhatsAppReportReady } from '@/lib/whatsapp';
import { computeScore, ScoreLevel, type Report } from '@app/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ENTREGA del reporte al cliente cuando queda LISTO (correo + WhatsApp). La invoca el motor
 * del VPS al terminar/reutilizar un reporte. Auth por token compartido VPS↔web
 * (`OPERATOR_PREVIEW_TOKEN`, header `x-operator-token`). Resuelve el contacto: usa el
 * email/whatsapp del pedido si vienen; si no, el último lead capturado para esa placa.
 * Enriquece el correo con el score calculado del reporte guardado.
 */
export async function POST(req: Request) {
  const token = req.headers.get('x-operator-token') ?? '';
  const expected = process.env.OPERATOR_PREVIEW_TOKEN ?? '';
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }
  if (!isAdminConfigured) {
    return NextResponse.json({ error: 'backend no configurado' }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    placa?: string; email?: string; whatsapp?: string; tier?: string;
  };
  const placa = norm(String(body.placa ?? ''));
  if (!placa) return NextResponse.json({ error: 'falta placa' }, { status: 400 });

  const admin = createAdminClient();
  let email = (body.email ?? '').trim().toLowerCase();
  let whatsapp = (body.whatsapp ?? '').trim();

  // Fallback de contacto: el último lead capturado para esta placa (lead gate del reporte).
  if (!email || !whatsapp) {
    try {
      const { data } = await admin
        .from('leads')
        .select('email, whatsapp')
        .eq('plate', placa)
        .order('created_at', { ascending: false })
        .limit(1);
      const lead = (data ?? [])[0] as { email?: string; whatsapp?: string } | undefined;
      if (lead) {
        if (!email) email = (lead.email ?? '').trim().toLowerCase();
        if (!whatsapp) whatsapp = (lead.whatsapp ?? '').trim();
      }
    } catch { /* sin lead / tabla no migrada → seguimos con lo que haya */ }
  }

  if (!email && !whatsapp) {
    return NextResponse.json({ ok: true, note: 'sin contacto para notificar' });
  }

  // Enriquecer el correo con el score del reporte guardado (opcional).
  const reportUrl = `${SITE_URL}/reporte/${encodeURIComponent(placa)}`;
  let scoreOverall: number | undefined;
  let scoreLevel: EmailScoreLevel | undefined;
  let scoreLabel: string | undefined;
  try {
    const { data: rep } = await admin.from('reportes').select('report').eq('placa', placa).maybeSingle();
    if (rep?.report) {
      const s = computeScore(rep.report as Report);
      if (s.overall != null) {
        scoreOverall = s.overall;
        scoreLevel = s.level === ScoreLevel.GOOD ? 'verde' : s.level === ScoreLevel.WARNING ? 'ambar' : s.level === ScoreLevel.BAD ? 'rojo' : undefined;
        scoreLabel = s.level === ScoreLevel.GOOD ? 'Riesgo bajo' : s.level === ScoreLevel.WARNING ? 'Revisar' : s.level === ScoreLevel.BAD ? 'Riesgo alto' : undefined;
      }
    }
  } catch { /* score opcional */ }

  const tier: 'BASIC' | 'PRO' | 'ULTRA' = body.tier === 'PRO' ? 'PRO' : body.tier === 'ULTRA' ? 'ULTRA' : 'BASIC';
  const result: Record<string, unknown> = {};

  if (email) {
    const { subject, html } = reportReadyEmail({ plate: placa, reportUrl, tier, scoreOverall, scoreLevel, scoreLabel });
    result.email = await sendEmail({ to: email, subject, html });
  }
  if (whatsapp) {
    result.whatsapp = await sendWhatsAppReportReady({ to: whatsapp, plate: placa, reportUrl });
  }

  return NextResponse.json({ ok: true, ...result });
}
