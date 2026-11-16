import { SECTION_CATALOG, TIER_RANK, ReportTier, maskOwnerName, type Report, type SectionResult } from '@app/shared';

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

/**
 * Visitante SIN sesión: el titular actual se enmascara (nombre → iniciales + ****). Con sesión se
 * sirve completo (decisión de producto). Evita que alguien recorra placas de forma anónima y coseche
 * nombres. Cubre el titular del vehículo y las copias que viven en los payloads (historial, etc.).
 */
export function maskOwnerForAnon(report: Report): Report {
  const OWNER_KEYS = ['ownerName', 'currentOwner', 'titular'];
  const vehicle = report.vehicle?.owner
    ? { ...report.vehicle, owner: { ...report.vehicle.owner, name: maskOwnerName(report.vehicle.owner.name) ?? '' } }
    : report.vehicle;
  const sections = report.sections.map((s) => {
    const p = s.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return s;
    const hit = OWNER_KEYS.filter((k) => typeof p[k] === 'string' && p[k]);
    if (!hit.length) return s;
    const np: Record<string, unknown> = { ...p };
    for (const k of hit) np[k] = maskOwnerName(p[k] as string);
    return { ...s, payload: np as SectionResult['payload'] };
  });
  return { ...report, vehicle, sections };
}
