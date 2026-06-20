import { NextResponse } from 'next/server';
import { purchasePaidEmail, reportReadyEmail, yapeReceivedEmail } from '@/lib/email-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vista previa de las plantillas de correo — SOLO desarrollo (404 en producción).
 * Renderiza el HTML tal cual lo recibe el cliente, sin enviar nada por Resend.
 *
 *   /api/dev/email-preview?type=paid    → recibo de pago (reporte desbloqueado)
 *   /api/dev/email-preview?type=yape    → instrucciones de Yape (pedido recibido)
 *   /api/dev/email-preview?type=report  → reporte listo
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'No disponible' }, { status: 404 });
  }

  const type = new URL(request.url).searchParams.get('type') ?? 'paid';
  const sample = { plate: 'VAS710', tier: 'PRO' as const, amount: 15.9, orderId: 'a1b2c3d4-0000-4f00-8000-abcdef123456' };

  let html: string;
  if (type === 'yape') {
    html = yapeReceivedEmail({ ...sample, yapeNumber: '987 654 321', yapeName: 'PlacaPe', reportUrl: 'http://localhost:3002/reporte/VAS710' }).html;
  } else if (type === 'report') {
    html = reportReadyEmail({ plate: sample.plate, tier: sample.tier, reportUrl: 'http://localhost:3002/reporte/VAS710', scoreOverall: 78, scoreLevel: 'verde', scoreLabel: 'Riesgo bajo' }).html;
  } else {
    html = purchasePaidEmail({ ...sample, reportUrl: 'http://localhost:3002/reporte/VAS710' }).html;
  }

  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
