/**
 * Enmascarado parcial de PII del titular para el reporte del cliente (Ley 29733). Convención tipo
 * "otras apps peruanas": nombres completos + apellidos → 3 primeras letras + ****. Las EMPRESAS
 * (persona jurídica) NO se enmascaran: su razón social y RUC son públicos.
 *
 * Formato de SUNARP para personas: "APELLIDOS, NOMBRES" (con coma). Empresas: razón social SIN coma,
 * con sufijo/keyword legal (S.A.C., E.I.R.L., …). La coma + el sufijo desambiguan persona/empresa y
 * ubican los apellidos. El titular puede traer MÁS DE UNO (copropiedad) concatenado → fallback seguro.
 * Se aplica en el ENSAMBLADO (antes de persistir/servir); el operador conserva el dato crudo aparte.
 */

// Persona JURÍDICA (empresa). Amplio a propósito: ante la duda preferimos NO marcar como empresa
// (→ enmascaramos como persona). Estas keywords no aparecen en nombres de personas naturales.
const RX_EMPRESA =
  /\b(S\.?\s?A\.?\s?C|S\.?\s?A\.?\s?A|S\.?\s?R\.?\s?L|S\.?\s?C\.?\s?R\.?\s?L|E\.?\s?I\.?\s?R\.?\s?L|S\.?\s?A\b|SOCIEDAD|EMPRESA|CORPORACI[OÓ]N|CONSORCIO|COOPERATIVA|ASOCIACI[OÓ]N|FUNDACI[OÓ]N|BANCO|FINANCIERA|SEGUROS|COMPA[ÑN][IÍ]A|\bCIA\b|INVERSIONES|TRANSPORTES?|SERVICIOS?|MULTISERVICIOS|COMERCIAL|DISTRIBUIDORA|IMPORTACIONES|EXPORTACIONES|INDUSTRIAS?|CONSTRUCTORA|CONTRATISTAS|REPRESENTACIONES|NEGOCIOS|GENERALES|LTDA|\bE\.?I\.?R\.?L\b)\b/i;

/** ¿El titular es una empresa (persona jurídica)? A las empresas no se les enmascara. */
export function isCompanyName(name: string | null | undefined): boolean {
  return !!name && RX_EMPRESA.test(name);
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Un apellido → 3 primeras letras + ****. Partículas cortas (DE/LA/…) se dejan; 3 letras revela solo 1. */
function maskToken(t: string): string {
  const s = t.trim();
  if (s.length <= 2) return s; // "DE", "LA", "MC" — poco identificable
  if (s.length === 3) return s[0] + '***';
  return s.slice(0, 3) + '****';
}

/**
 * Enmascara el nombre del titular. Empresa → tal cual. Persona "APELLIDOS, NOMBRES" → nombres
 * completos + apellidos enmascarados. Multipropietario / sin coma → enmascara TODOS los tokens
 * (parcial y seguro: ninguno queda completo, porque no podemos ubicar cuáles son nombres).
 */
export function maskOwnerName(raw: string | null | undefined): string | null {
  const name = norm(raw);
  if (!name) return null;
  if (name.includes('****')) return name; // ya enmascarado → idempotente (build + serving sin doble-máscara)
  if (isCompanyName(name)) return name; // empresa: RUC/razón social públicos

  const commas = (name.match(/,/g) ?? []).length;
  if (commas === 1) {
    const [ap, nom] = name.split(',');
    const apel = norm(ap).split(' ').filter(Boolean).map(maskToken).join(' ');
    return `${norm(nom)} ${apel}`.trim();
  }
  // Sin coma o copropiedad (varias comas): no sabemos qué tokens son nombres → enmascaramos todos.
  return name.replace(/,/g, ' ').split(' ').filter(Boolean).map(maskToken).join(' ');
}

// Tokens que NO son parte del nombre (roles, estado civil, régimen, tipo de persona, conectores):
// se conservan tal cual y ayudan a que la máscara no se coma contexto útil del asiento.
const RX_STOP_TOKEN =
  /^(?:DEUDOR|ACREEDOR|COMPRADOR|VENDEDOR|TITULAR|PROPIETARIO|REPRESENTANTE|APODERADO|SUCESI[OÓ]N|PERSONA|NATURAL|JUR[IÍ]DICA|SOCIEDAD|CONYUGAL|CASAD[OA]|SOLTER[OA]|VIUD[OA]|DIVORCIAD[OA]|Y|E|DEL?|LA|LOS|LAS)[.,:]?$/i;

/**
 * Enmascara la PII de PERSONAS dentro del texto libre de participantes de un ASIENTO (historial):
 * los dueños ANTERIORES del vehículo no necesitan ser identificables (Ley 29733). Regla ANCLADA AL
 * DOCUMENTO: en los asientos las personas naturales van siempre con su DNI/CE — se enmascaran los
 * APELLIDOS (3 letras + ****) y el número (3 dígitos + ****), pero el NOMBRE DE PILA queda VISIBLE
 * (pedido del dueño 1-ago-2026: un nombre solo no identifica y mantiene el reporte legible):
 *  - con coma ("APELLIDOS, NOMBRES"): todo lo que sigue a la última coma es nombre → visible;
 *  - sin coma (formato SUNARP apellidos-primero): el ÚLTIMO token es nombre de pila → visible
 *    (solo si hay ≥2 tokens de nombre; con uno solo no sabemos si es apellido y se enmascara).
 * Las EMPRESAS (acreedores tipo "BBVA CONSUMER FINANCE…", sin DNI) y el texto del acto/montos
 * quedan INTACTOS — anclar al documento evita enmascarar razones sociales por error. Roles/estado
 * civil/tipo ("Deudor:", "Casado", "PERSONA NATURAL", "SOCIEDAD CONYUGAL") se conservan como contexto.
 */
export function maskHistorialParties(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // 1) Nombre pegado a su documento: "APELLIDOS[,] NOMBRES DNI 06725079" → apellidos a 3+**** + nº recortado.
  const RX_NAME_DOC =
    /((?:[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'.-]*,?\s+){1,6})(D\.?\s?N\.?\s?I\.?|DNI|C\.?\s?E\.?|CE|CARNE\s+DE\s+EXTRANJER[IÍ]A)\s*:?\s*(\d{6,9})/g;
  let out = raw.replace(RX_NAME_DOC, (_m, names: string, doc: string, num: string) => {
    const toks = String(names).trim().split(/\s+/);
    const lastComma = toks.reduce((acc, t, i) => (t.endsWith(',') ? i : acc), -1);
    const nameIdx = toks.map((t, i) => (RX_STOP_TOKEN.test(t) ? -1 : i)).filter((i) => i >= 0);
    const lastNameTok = nameIdx.length >= 2 ? nameIdx[nameIdx.length - 1] : -1;
    const masked = toks.map((t, i) => {
      if (RX_STOP_TOKEN.test(t)) return t; // rol/estado civil/etiqueta/conector → visible
      if (lastComma >= 0 ? i > lastComma : i === lastNameTok) return t; // nombre de pila → visible
      const comma = t.endsWith(',') ? ',' : '';
      return `${maskToken(t.replace(/,+$/, ''))}${comma}`;
    }).join(' ');
    return `${masked} ${doc} ${num.slice(0, 3)}****`;
  });
  // 2) Documentos sueltos que quedaron sin pareja de nombre (igual se recortan).
  out = out.replace(/\b(DNI|D\.N\.I\.?|C\.?E\.?)\s*:?\s*(\d{6,9})\b/gi, (_m, d: string, n: string) => `${d} ${n.slice(0, 3)}****`);
  return out;
}

/**
 * Enmascara el documento del titular. RUC de EMPRESA (20…, 11 dígitos) → público (tal cual). DNI / CE /
 * RUC de persona (10…) → 3 primeros + ****. Entrada típica: "DNI 08701061", "RUC 20601234567".
 */
export function maskDoc(raw: string | null | undefined): string | null {
  const d = norm(raw);
  if (!d) return null;
  const m = d.match(/^([A-Za-zÁÉÍÓÚÑ.]+)\s*[-:]?\s*([0-9A-Za-z]+)$/);
  if (!m) return d; // formato inesperado → no tocar (evita recortar mal y revelar de más)
  const tipo = (m[1] ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const num = m[2] ?? '';
  if (tipo.startsWith('RUC') && /^20\d{9}$/.test(num)) return d; // RUC empresa: público
  return `${m[1]} ${num.slice(0, 3)}****`; // DNI/CE/RUC-persona
}
