import type { Page } from '@playwright/test';

/** Reporte de ejemplo con robo + SOAT + siniestralidad + "Próximamente". */
export function sampleReport(opts: { stolen?: boolean; partial?: boolean } = {}) {
  const fetchedAt = '2026-06-12T10:00:00Z';
  return {
    id: 'job-1',
    placa: 'ABC-123',
    status: opts.partial ? 'PARTIAL' : 'COMPLETE',
    generatedAt: fetchedAt,
    disclaimer: 'Información referencial obtenida de portales públicos oficiales.',
    vehicle: {
      brand: 'TOYOTA',
      model: 'YARIS',
      year: 2019,
      color: 'PLOMO',
      serie: '9BRBC3HE0K0123456',
      vin: '9BRBC3HE0K0123456',
      engineNumber: '2NR1234567',
      plateDisplay: 'ABC-123',
      platePrevious: null,
      stolenAlert: Boolean(opts.stolen),
      owner: { name: 'PEREZ GARCIA, JUAN', note: 'Dato registral público de SUNARP.' },
    },
    sections: [
      { kind: 'REGISTRAL', source: 'SUNARP', status: 'AVAILABLE', fetchedAt, payload: {} },
      {
        kind: 'SEGUROS',
        source: 'SBS',
        status: 'AVAILABLE',
        fetchedAt,
        payload: { hasActiveSoat: true, insurer: 'LA POSITIVA', policyNumber: 'SOAT-1', validFrom: null, validTo: '2026-03-01' },
      },
      opts.partial
        ? { kind: 'SINIESTRALIDAD', source: 'SBS', status: 'UNAVAILABLE', fetchedAt: null }
        : { kind: 'SINIESTRALIDAD', source: 'SBS', status: 'AVAILABLE', fetchedAt, payload: { hasSiniestro: false, periodYears: 5 } },
      { kind: 'PAPELETAS', source: null, status: 'COMING_SOON', fetchedAt: null },
      { kind: 'GNV', source: null, status: 'COMING_SOON', fetchedAt: null },
      { kind: 'DEUDA_BANCARIA', source: null, status: 'COMING_SOON', fetchedAt: null },
      { kind: 'PNP', source: null, status: 'COMING_SOON', fetchedAt: null },
    ],
  };
}

/** Intercepta la API: POST /consultas devuelve el reporte directo (cached). */
export async function mockApi(page: Page, report: unknown) {
  await page.route('**/api/v1/consultas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: null, status: 'COMPLETED', cached: false, report }),
    });
  });
}
