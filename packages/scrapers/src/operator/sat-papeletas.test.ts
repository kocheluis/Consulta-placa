import { describe, it, expect } from 'vitest';
import { parseSatPapeletasItems } from './sources.js';

/**
 * Fixtures REALES del resultado de SAT Lima (probe-sat-live, innerText con tabs→espacio).
 * Columnas del grid: Placa · Reglamento · Falta · N° Documento · Fecha Infracción · Importe ·
 * Gastos · Descuento · Deuda · Estado · Licencia · Tipo Doc · N° Doc. El importe va SIN "S/".
 */

// CDK293 (7-jul-2026): 1 papeleta pendiente.
const SAT_CDK293 =
  '1/ Placa Reglamento Falta N° Documento/ Código de pago Fecha Infración/ Fecha Emisión Importe Gastos/ Costas Descuento Deuda Estado Licencia de Conducir Tipo Doc. Iden. N° Doc. Identidad\n' +
  'CDK293 RNT M20a E3761377 25/07/2025 990.00 0.00 0.00 990.00 Pendiente Q41097147 DNI/LE 41097147\n' +
  '1/ Número de placa asignada en aplicación de la R.D. Nº 4012-2009-MTC/15.\n' +
  'Fecha de consulta: 7/07/2026';

// Caso NEGATIVO real: sin papeletas (solo texto + fecha de consulta, sin importes).
const BTF268_SIN_PAPELETAS =
  'CONSULTA DE PAPELETAS\nBúsqueda por Placa\nPlaca: BTF268\n' +
  'No se encontraron papeletas registradas pendientes de pago para la placa BTF268.\n' +
  'Fecha de consulta: 23/06/2026';

describe('parseSatPapeletasItems (detalle real SAT Lima)', () => {
  it('CDK293: extrae la papeleta con su falta, n° documento, fecha, monto y estado', () => {
    const rows = parseSatPapeletasItems(SAT_CDK293);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      numero: 'E3761377',
      fecha: '25/07/2025',
      monto: 990,
      estado: 'Pendiente',
    });
    expect(rows[0]?.infraccion).toContain('M20a'); // código de falta
  });

  it('el importe SIN "S/" se lee igual (990.00 → 990)', () => {
    expect(parseSatPapeletasItems(SAT_CDK293)[0]?.monto).toBe(990);
  });

  it('caso SIN papeletas (BTF268): no inventa filas (la "Fecha de consulta" no cuenta)', () => {
    expect(parseSatPapeletasItems(BTF268_SIN_PAPELETAS)).toEqual([]);
  });

  it('dos papeletas → dos filas, con la Deuda (no el Importe) como monto', () => {
    const dos = SAT_CDK293 + '\nCDK293 RNTV G60 E9998887 03/02/2024 466.00 0.00 116.50 349.50 En cobranza coactiva X1 DNI 41097147';
    const rows = parseSatPapeletasItems(dos);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ numero: 'E9998887', monto: 349.5, fecha: '03/02/2024' });
    expect(rows[1]?.estado?.toLowerCase()).toContain('cobranza');
  });
});
