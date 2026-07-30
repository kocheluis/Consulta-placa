/**
 * Clasificación del USO PÚBLICO a partir de la ficha registral del asiento (SUNARP): el campo
 * "Tipo de uso" + la categoría vehicular. Es la señal NACIONAL (el asiento vale en todo el Perú;
 * ATU solo cubre la habilitación de Lima/Callao). Taxonomía:
 *  - Pasajeros liviano/menor: M1 = automóvil taxi/colectivo · B-I = mototaxi/trimoto (viaje corto).
 *  - Masivo: M2 = microbús/minibús/combi (rutas cortas) · M3 = ómnibus/bus (urbano/interprovincial).
 */
export interface PublicUseInfo {
  /** true = el tipo de uso registral es de SERVICIO PÚBLICO (taxi/colectivo/transporte). */
  isPublic: boolean;
  /** Clasificación legible según categoría/uso (solo cuando isPublic). */
  kind: string | null;
}

export function classifyPublicUse(usage?: string | null, category?: string | null): PublicUseInfo {
  const u = (usage ?? '').trim();
  if (!u) return { isPublic: false, kind: null };
  // "Vehiculos Particulares (Categoria M)" → privado. El "particular" manda sobre cualquier keyword.
  const isPublic = !/particular/i.test(u) &&
    /taxi|colectivo|mototaxi|trimoto|\bp[uú]blic[oa]|urbano|interprovincial|interurbano|escolar|turismo|trabajadores/i.test(u);
  if (!isPublic) return { isPublic: false, kind: null };
  const c = (category ?? '').toUpperCase().replace(/\s+/g, '');
  let kind: string | null = null;
  if (/M3/.test(c) || /[oó]mnibus|\bbus(es)?\b/i.test(u)) kind = 'Ómnibus / bus (transporte público masivo)';
  else if (/M2/.test(c) || /microb[uú]s|minib[uú]s|combi/i.test(u)) kind = 'Microbús / minibús (transporte público masivo)';
  else if (/^B-?I\b|L5/.test(c) || /trimoto|mototaxi/i.test(u)) kind = 'Mototaxi / trimoto (pasajeros, viaje corto)';
  else if (/M1/.test(c) || /autom[oó]vil|taxi|colectivo/i.test(u)) kind = 'Automóvil — taxi / colectivo (pasajeros liviano)';
  return { isPublic: true, kind };
}
