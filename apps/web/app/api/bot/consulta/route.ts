import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { botAuthOk, getBotUser, upsertBotUser, normPhone, normPlaca } from '@/lib/bot';
import { getUserCupo, checkAndRecordCupo, enqueueCupoConsulta } from '@/lib/cupo';
import { enqueueFreeBasic } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BOT · dispara una consulta al motor desde WhatsApp (n8n). Auth por token de servicio (`x-bot-token`).
 * Reusa la lógica de cupo/encolado que ya existe — n8n NO habla con Supabase ni reimplementa reglas.
 *
 * Identidad (Fase 0):
 *  - Número VINCULADO a una cuenta con CUPO → consume cupo y genera su nivel (PRO/ULTRA).
 *  - Número SIN vincular / sin cupo → genera BASIC gratis (el cobro Yape/IziPay entra en la Fase 1).
 *
 * El número (`whatsapp`) viaja en el pedido → la entrega (VPS → N8N_WEBHOOK_URL → WhatsApp) llega a
 * quien pidió. Body: `{ phone, placa }`.
 */
export async function POST(req: Request) {
  if (!botAuthOk(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string; placa?: string };
  const phone = normPhone(String(body.phone ?? ''));
  const placa = normPlaca(String(body.placa ?? ''));
  if (!phone) return NextResponse.json({ ok: false, status: 'invalid', error: 'falta teléfono' }, { status: 400 });
  if (!placa) return NextResponse.json({ ok: false, status: 'invalid', error: 'placa inválida (6–7 caracteres)' }, { status: 400 });

  const bu = await getBotUser(phone);
  await upsertBotUser(phone, { lastPlaca: placa }); // rastro de contexto (postventa)

  // ── Vinculado + con cupo → gasta cupo (PRO/ULTRA) ──
  if (bu?.userId) {
    const access = await getUserCupo(bu.userId);
    if (access?.enabled) {
      const chk = await checkAndRecordCupo(bu.userId, access, placa);
      if (!chk.ok) {
        return NextResponse.json({ ok: false, status: 'cupo_exceeded', placa, tier: access.tier, window: chk.window, resetInMin: chk.resetInMin });
      }
      const st = await enqueueCupoConsulta(bu.userId, bu.email, placa, access.tier, phone);
      return NextResponse.json({ ok: true, status: st, placa, tier: access.tier, remaining: chk.remaining });
    }
  }

  // ── Sin vincular / sin cupo → BASIC gratis (Fase 0). El cobro llega en la Fase 1. ──
  const free = await enqueueFreeBasic(placa, phone);
  return NextResponse.json({ ok: free.ok, status: free.status, placa, tier: 'BASIC' });
}
