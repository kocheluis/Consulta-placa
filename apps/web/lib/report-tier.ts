import { SECTION_CATALOG, TIER_RANK, ReportTier, type Report, type SectionResult } from '@app/shared';

/**
 * Paywall server-side: quita el `payload` de las secciones por encima del nivel dado. Única fuente de
 * verdad del recorte por tier — la usan tanto `GET /api/reporte/[placa]` (web) como `GET /api/bot/reporte`
 * (WhatsApp), para que ambos entreguen exactamente lo que el usuario tiene derecho a ver.
 */
export function stripByTier(report: Report, tier: 'BASIC' | 'PRO' | 'ULTRA'): Report {
  const rank = TIER_RANK[tier as ReportTier] ?? 1;
  const kindTier = new Map<string, ReportTier>();
  for (const e of SECTION_CATALOG) if (e.dataKind) kindTier.set(e.dataKind, e.tier);
  const sections: SectionResult[] = report.sections.map((s) => {
    const t = kindTier.get(s.kind);
    return t && TIER_RANK[t] > rank ? { ...s, payload: undefined } : s;
  });
  return { ...report, sections };
}
