import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { getPaidTier } from '@/lib/payments';
import { getSessionOperatorAccess } from '@/lib/operador';
import { verifyPreviewToken } from '@/lib/preview-token';
import {
  SECTION_CATALOG, TIER_RANK, ReportTier, ReportStatus, DISCLAIMER_TEXT,
  type Report, type SectionResult,
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

/** Paywall server-side: quita el payload de las secciones por encima del nivel pagado. */
function stripByTier(report: Report, tier: 'BASIC' | 'PRO' | 'ULTRA'): Report {
  const rank = TIER_RANK[tier as ReportTier] ?? 1;
  const kindTier = new Map<string, ReportTier>();
  for (const e of SECTION_CATALOG) if (e.dataKind) kindTier.set(e.dataKind, e.tier);
  const sections: SectionResult[] = report.sections.map((s) => {
    const t = kindTier.get(s.kind);
    return t && TIER_RANK[t] > rank ? { ...s, payload: undefined } : s;
  });
  return { ...report, sections };
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
  if (!isAdminConfigured) return NextResponse.json({ generating: false, report: stub(placa) });

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
  // Cuentas internas de operador: acceso completo a SU nivel (PRO/ULTRA) para cualquier placa
  // (son de confianza; el cupo limita cuántas consultas GENERAN, no cuántas ven). Toma el mayor.
  try {
    const op = await getSessionOperatorAccess();
    if (op?.access.enabled && TIER_RANK[op.access.tier] > TIER_RANK[tier as ReportTier]) {
      tier = op.access.tier;
    }
  } catch { /* sin acceso de operador → sin cambio */ }

  const admin = createAdminClient();
  const { data: rep } = await admin.from('reportes').select('report,status').eq('placa', placa).maybeSingle();

  // ¿Hay un pedido activo para esta placa? Se informa SIEMPRE (aunque ya exista un reporte):
  // al activar PRO/ULTRA se encola una regeneración con todas las fuentes, y la web usa este
  // flag para mostrar la pantalla de carga ("procesado por especialistas") hasta que termine.
  const { data: ped } = await admin
    .from('pedidos').select('id').eq('placa', placa).in('estado', ['pendiente', 'procesando']).limit(1);
  const generating = !!(ped && ped.length);

  if (rep?.report) {
    const report = operatorPreview ? (rep.report as Report) : stripByTier(rep.report as Report, tier);
    return NextResponse.json({ generating, report });
  }

  return NextResponse.json({ generating, report: generating ? null : stub(placa) });
}
