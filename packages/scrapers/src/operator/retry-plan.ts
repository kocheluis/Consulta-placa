/**
 * Plan de REINTENTO SOLO-ERRORES (pedidos `origin='reintento'`, disparados por el USUARIO desde la web):
 * dado el `results` del reporte guardado, decide qué fuentes RE-CORRER (solo las que quedaron en ERROR)
 * y cuáles REUSAR tal cual (las buenas + las no-rerun). A diferencia de la memoria (planMemoryReuse),
 * NO tiene gate de TTL: el objetivo es REPARAR el reporte existente, no refrescarlo.
 *
 * Reglas:
 *  - ERROR = todo lo que no sea ENCONTRADO/SIN_REGISTRO (incluye dep-fails y "sin resultado").
 *  - `noRerun` (relay GNV): fallan siempre desde el VPS → NO se reintentan; se conserva su previo.
 *  - Solo se re-corre lo que exista en el CATÁLOGO actual (`catalogIds`): una fuente retirada no
 *    puede correrse (y meterla al job colgaría el pipeline esperando un resultado que nunca llega).
 *  - Función PURA (sin fs/red) para poder testearla aislada; el server la envuelve leyendo reporte.json.
 */

export interface RetrySourceResult {
  source: string;
  status: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '-');
const isGood = (status: string): boolean => status === 'ENCONTRADO' || status === 'SIN_REGISTRO';

export function computeErrorRetryPlan<T extends RetrySourceResult>(
  results: T[],
  catalogIds: string[],
  noRerun: Set<string>,
): { rerun: string[]; reuse: T[] } {
  const byNorm = new Map(catalogIds.map((id) => [norm(id), id]));
  const rerun: string[] = [];
  for (const r of results) {
    if (isGood(r.status)) continue;
    const n = norm(r.source);
    if (noRerun.has(n)) continue;
    const id = byNorm.get(n);
    if (id && !rerun.includes(id)) rerun.push(id);
  }
  const rerunSet = new Set(rerun.map(norm));
  const reuse = results.filter((r) => !rerunSet.has(norm(r.source)));
  return { rerun, reuse };
}
