import {
  SectionKind,
  SectionStatus,
  SourceId,
  formatPlateDisplay,
  type SourceResult,
} from '@app/shared';

/**
 * Datos de ejemplo para DEMO_MODE: permite probar el flujo end-to-end (cola →
 * worker → reporte → web) sin scrapear los portales reales ni resolver CAPTCHA.
 *
 * Genera variación determinista según la placa para que distintas placas
 * muestren distintos resultados (con/sin robo, con/sin SOAT, con/sin siniestro).
 */
export function demoSources(plateNormalized: string): SourceResult[] {
  const fetchedAt = new Date().toISOString();
  const plateDisplay = formatPlateDisplay(plateNormalized);

  // Hash simple y estable de la placa para variar el escenario.
  const seed = [...plateNormalized].reduce((a, c) => a + c.charCodeAt(0), 0);
  const stolen = seed % 5 === 0;
  const hasSoat = seed % 3 !== 0;
  const hasSiniestro = seed % 4 === 0;

  const marcas = ['TOYOTA', 'HYUNDAI', 'KIA', 'NISSAN', 'SUZUKI'];
  const modelos = ['YARIS', 'ACCENT', 'RIO', 'SENTRA', 'SWIFT'];
  const colores = ['PLOMO', 'BLANCO', 'NEGRO', 'ROJO', 'AZUL'];
  const idx = seed % marcas.length;

  return [
    {
      kind: SectionKind.REGISTRAL,
      source: SourceId.SUNARP,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      vehicle: {
        plateDisplay,
        platePrevious: null,
        brand: marcas[idx]!,
        model: modelos[idx]!,
        year: 2015 + (seed % 9),
        color: colores[idx]!,
        serie: `9BR${seed}HE0K0${(seed * 7) % 1000000}`,
        vin: `9BR${seed}HE0K0${(seed * 7) % 1000000}`,
        engineNumber: `2NR${(seed * 13) % 10000000}`,
        stolenAlert: stolen,
      },
      ownerName: 'PEREZ GARCIA, JUAN CARLOS',
      payload: { stolenAlert: stolen },
    },
    {
      kind: SectionKind.SEGUROS,
      source: SourceId.SBS,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: {
        hasActiveSoat: hasSoat,
        insurer: hasSoat ? 'LA POSITIVA SEGUROS' : null,
        policyNumber: hasSoat ? `SOAT-2025-${(seed * 3) % 1000000}` : null,
        validFrom: hasSoat ? '2025-03-01' : null,
        validTo: hasSoat ? '2026-03-01' : null,
      },
    },
    {
      kind: SectionKind.SINIESTRALIDAD,
      source: SourceId.SBS,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: { hasSiniestro, periodYears: 5 },
    },
  ];
}
