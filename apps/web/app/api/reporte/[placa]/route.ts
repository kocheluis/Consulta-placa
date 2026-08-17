import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { getPaidTier } from '@/lib/payments';
import { getSessionCupo, refundCupoHits } from '@/lib/cupo';
import { verifyPreviewToken } from '@/lib/preview-token';
import { stripByTier } from '@/lib/report-tier';
import {
  TIER_RANK, ReportTier, ReportStatus, DISCLAIMER_TEXT,
  type Report,
} from '@app/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Reporte vacío (sin datos): la web muestra el dashboard con la invitación a comprar. */
function stub(placa: string): Report {
  return {
    id: '', placa, status: ReportStatus.PARTIAL, generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER_TEXT, vehicle: null, sections: [],
  };
}

/**
 * Devuelve el reporte de una placa para el cliente. Lee de Supabase (service_role) y
 * recorta por el nivel pagado del usuario. Estados: `generating` (hay un pedido en curso)
 * o `report` (listo o stub-vacío para invitar a comprar).
 */
export async function GET(req: Request, { params }: { params: Promise<{ placa: string }> }) {
  const { placa: raw } = await params;
  const placa = norm(raw);
  if (!placa) return NextResponse.json({ generating: false, report: null });
  if (!isAdminConfigured) return NextResponse.json({ generating: false, report: stub(placa), tier: 'BASIC', cupo: null });

  // Modo operador: ?preview=TOKEN devuelve el reporte COMPLETO sin recortar por tier, para
  // previsualizarlo en la consola. Preferido: token FIRMADO con expiración (verifyPreviewToken,
  // ligado a la placa → un enlace filtrado muere al expirar). Fallback legacy: match exacto del
  // secreto crudo (compat; nuestro código ya no lo pone en URLs, así que no se filtra por logs).
  const preview = new URL(req.url).searchParams.get('preview');
  const opToken = process.env.OPERATOR_PREVIEW_TOKEN;
  const operatorPreview = !!opToken && !!preview &&
    (verifyPreviewToken(placa, preview, opToken) || preview === opToken);

  let tier: 'BASIC' | 'PRO' | 'ULTRA' = 'BASIC';
  try { tier = await getPaidTier(placa); } catch { /* anónimo → BASIC */ }
  // Usuarios con CUPO asignado: ven su nivel (PRO/ULTRA) para cualquier placa (el cupo limita
  // cuántas consultas GENERAN, no cuántas ven). Toma el mayor entre el pagado y el del cupo.
  let cupo: Awaited<ReturnType<typeof getSessionCupo>> = null;
  try { cupo = await getSessionCupo(); } catch { /* sin cupo → sin cambio */ }
  if (cupo?.access.enabled && TIER_RANK[cupo.access.tier] > TIER_RANK[tier as ReportTier]) {
    tier = cupo.access.tier;
  }
  // Se expone al cliente para que, si el reporte aún no cubre su nivel, la UI ofrezca GENERAR con su
  // cupo (POST /api/cupo/consultar) en vez del pago/Yape — sin esto un usuario con cupo veía el paywall.
  const cupoOut = cupo?.access.enabled ? { enabled: true as const, tier: cupo.access.tier } : null;

  const admin = createAdminClient();
  const { data: rep } = await admin.from('reportes').select('report,status').eq('placa', placa).maybeSingle();

  // ¿Hay un pedido activo para esta placa? Se informa SIEMPRE (aunque ya exista un reporte):
  // al activar PRO/ULTRA se encola una regeneración con todas las fuentes, y la web usa este
  // flag para mostrar la pantalla de carga ("procesado por especialistas") hasta que termine.
  const { data: ped } = await admin
    .from('pedidos').select('id').eq('placa', placa).in('estado', ['pendiente', 'procesando']).limit(1);
  const generating = !!(ped && ped.length);

  if (rep?.report) {
    const full = rep.report as Report;
    // Placa INEXISTENTE + usuario con CUPO → reembolsa la consulta: una placa que no existe NO debe
    // consumir cupo (el consumo ocurrió en el submit, antes de saberlo). Idempotente y fail-safe.
    if (full.plateNotFound && cupo?.access.enabled) { await refundCupoHits(cupo.userId, placa); }
    // El titular ACTUAL se sirve COMPLETO (decisión de producto 30-jul-2026: dato registral público
    // de SUNARP y valor central del reporte). La minimización de PII aplica a los TERCEROS del
    // HISTORIAL (dueños anteriores, enmascarados en origen por el transform) y al titular de ATU.
    const report = operatorPreview ? full : stripByTier(full, tier);
    // Devolvemos el `tier` efectivo (pago + CUPO) para que el candado de la UI use la MISMA fuente de
    // verdad con que recortamos los datos — si no, el cliente re-resolvía con solo `purchases` y a un
    // usuario con cupo le mostraba el candado + Yape aunque el reporte ya viniera con datos PRO/ULTRA.
    return NextResponse.json({ generating, report, tier: operatorPreview ? 'ULTRA' : tier, cupo: cupoOut });
  }

  return NextResponse.json({ generating, report: generating ? null : stub(placa), tier, cupo: cupoOut });
}
