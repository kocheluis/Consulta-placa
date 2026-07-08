import type { Valuation, ValuationBand, ValuationAdjustment } from './report.js';

/**
 * Motor de VALORIZACIÓN (ULTRA). El kilometraje real NO es público en Perú (lo confirmó el probe
 * del MTC), así que NO se puede dar un precio único: se dan precios por BANDAS de km (uso bajo/
 * promedio/alto/muy alto) partiendo de un precio base de mercado (marca/modelo/versión/año, que
 * estima la IA) y ajustando por la CONDICIÓN hallada en el reporte.
 *
 * Determinístico y testeable: la IA solo aporta el rango base (su fortaleza: conoce el mercado);
 * las bandas de km y los ajustes por condición se calculan aquí, de forma transparente.
 */

const KM_POR_ANIO = 15_000; // promedio Perú

export interface ValuationInput {
  /** Rango base de mercado en S/ (de la IA). 0/0 → no se pudo estimar. */
  baseMin: number;
  baseMax: number;
  year: number | null;
  currentYear: number;
  confidence: 'alta' | 'media' | 'baja';
  basis: string;
  // Condición (del reporte):
  siniestro: boolean;        // siniestro/pérdida total registrado (SBS/aseguradora/remate por choque)
  usoTaxi: boolean;          // uso taxi/servicio (ATU/CITV) → desgaste
  gnv: boolean;              // conversión a GNV
  gravamenVigente: boolean;  // carga vigente
  gravamenMonto: number | null;
  papeletasPendientes: number; // S/ pendientes
  transfers: number;         // nº de transferencias de dominio
  roboVigente: boolean;      // anotación de robo SIN cancelar
  revisionVencida: boolean;  // RTV vencida cuando ya le corresponde
}

/** Bandas de km relativas al km esperado por antigüedad (o absolutas si no hay año). */
function kmBands(expectedKm: number | null): Array<{ label: string; kmRange: string; factor: number; expected: boolean }> {
  const fmt = (n: number): string => Math.round(n).toLocaleString('es-PE');
  if (expectedKm && expectedKm > 0) {
    const b = [0.6, 1.15, 1.7].map((m) => expectedKm * m);
    return [
      { label: 'Uso bajo', kmRange: `menos de ${fmt(b[0]!)} km`, factor: +0.08, expected: false },
      { label: 'Uso promedio', kmRange: `~${fmt(b[0]!)}–${fmt(b[1]!)} km`, factor: 0, expected: true },
      { label: 'Uso alto', kmRange: `~${fmt(b[1]!)}–${fmt(b[2]!)} km`, factor: -0.1, expected: false },
      { label: 'Uso muy alto', kmRange: `más de ${fmt(b[2]!)} km`, factor: -0.2, expected: false },
    ];
  }
  return [
    { label: 'Uso bajo', kmRange: 'menos de 40 000 km', factor: +0.08, expected: false },
    { label: 'Uso promedio', kmRange: '~40 000–90 000 km', factor: 0, expected: true },
    { label: 'Uso alto', kmRange: '~90 000–140 000 km', factor: -0.1, expected: false },
    { label: 'Uso muy alto', kmRange: 'más de 140 000 km', factor: -0.2, expected: false },
  ];
}

const round500 = (n: number): number => Math.max(0, Math.round(n / 500) * 500);

export function buildValuation(input: ValuationInput): Valuation {
  const { baseMin, baseMax, year, currentYear } = input;
  const expectedKm = year && currentYear >= year ? Math.max(0, currentYear - year) * KM_POR_ANIO : null;

  const disclaimer =
    'Estimación referencial, NO un avalúo. El kilometraje real no es público en Perú, por eso se dan ' +
    'rangos por uso. Contrasta con avisos del mercado (Neoauto, Mercado Libre) y una revisión mecánica.';

  // Sin precio base (la IA no pudo estimar) → sección informativa sin bandas.
  if (!(baseMin > 0 && baseMax > 0)) {
    return {
      currency: 'PEN', available: false, baseMin: 0, baseMax: 0, expectedKm,
      bands: [], adjustments: [], netMin: 0, netMax: 0,
      confidence: 'baja', basis: input.basis || 'sin datos suficientes para estimar el precio base',
      disclaimer,
    };
  }

  // Ajustes por condición: multiplicadores acumulativos + deducciones fijas.
  const adjustments: ValuationAdjustment[] = [];
  let mult = 1;
  const pct = (f: number): string => `−${Math.round(f * 100)}%`;
  const apply = (cond: boolean, factor: number, factorName: string, detail: string): void => {
    if (!cond) return;
    mult *= 1 - factor;
    adjustments.push({ factor: factorName, impact: pct(factor), detail });
  };
  apply(input.siniestro, 0.22, 'Siniestro / pérdida total', 'Registra siniestro o remate por choque → castigo fuerte de precio y reventa.');
  apply(input.usoTaxi, 0.18, 'Uso como taxi/servicio', 'Desgaste mayor por uso comercial (motor, suspensión, tapicería).');
  apply(input.gnv, 0.06, 'Conversión a GNV', 'Muchos compradores descuentan por la conversión (tanque, garantía, mantenimiento).');
  apply(input.transfers >= 4, 0.04, 'Muchos dueños', `${input.transfers} transferencias de dominio → menor demanda.`);
  apply(input.revisionVencida, 0.03, 'Revisión técnica vencida', 'Costo/gestión de regularizar la RTV.');

  // Deducciones fijas (no porcentuales).
  const papeletas = Math.max(0, input.papeletasPendientes || 0);
  if (papeletas > 0) adjustments.push({ factor: 'Papeletas pendientes', impact: `−S/ ${papeletas.toFixed(2)}`, detail: 'Deuda de infracciones a cancelar antes de la transferencia.' });
  if (input.gravamenVigente) {
    const m = input.gravamenMonto && input.gravamenMonto > 0 ? ` (S/ ${input.gravamenMonto.toLocaleString('es-PE')})` : '';
    adjustments.push({ factor: 'Gravamen vigente', impact: 'Descontar deuda', detail: `Carga/garantía vigente${m}: exige el levantamiento o descuenta el saldo del precio antes de comprar.` });
  }

  // Bandas de km con la condición ya aplicada → precio final por rango.
  const bands: ValuationBand[] = kmBands(expectedKm).map((b) => ({
    label: b.label,
    kmRange: b.kmRange,
    priceMin: round500(baseMin * (1 + b.factor) * mult - papeletas),
    priceMax: round500(baseMax * (1 + b.factor) * mult - papeletas),
    ...(b.expected ? { isExpected: true } : {}),
  }));

  const expected = bands.find((b) => b.isExpected) ?? bands[1] ?? bands[0]!;
  const roboVigente = input.roboVigente;
  if (roboVigente) adjustments.unshift({ factor: 'Anotación de robo VIGENTE', impact: 'No comprar', detail: 'El vehículo figura como robado sin cancelar la anotación: no proceder con la compra.' });

  // Confianza: baja si la IA ya venía dudosa o hay señales que distorsionan mucho el precio.
  const confidence: Valuation['confidence'] =
    roboVigente || input.confidence === 'baja' ? 'baja'
      : input.siniestro || input.confidence === 'media' ? 'media'
        : 'alta';

  return {
    currency: 'PEN', available: true, baseMin: round500(baseMin), baseMax: round500(baseMax), expectedKm,
    bands, adjustments,
    netMin: expected.priceMin, netMax: expected.priceMax,
    confidence, basis: input.basis, ...(roboVigente ? { blocked: true } : {}), disclaimer,
  };
}
