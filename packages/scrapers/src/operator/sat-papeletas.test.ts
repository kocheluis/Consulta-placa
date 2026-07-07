import { describe, it, expect } from 'vitest';
import { parseSatPapeletasItems } from './sources.js';

/**
 * Tests de MECÁNICA del parser de filas de SAT Lima. La garantía es independiente del formato
 * exacto del grid: una fila cuenta como papeleta SOLO si trae A LA VEZ una fecha (dd/mm/aaaa) y
 * un importe "S/ n". Así nunca inventa filas a partir de cabeceras/fechas de consulta/totales.
 * (El formato real CON papeletas se fijará como fixture con una captura SAT_DEBUG=1 — hoy la única
 * captura real disponible es SIN papeletas, BTF268, que abajo se usa como caso negativo real.)
 */

// Caso NEGATIVO REAL: innerText del resultado de BTF268 (23-jun) — sin papeletas. Tiene una fecha
// ("Fecha de consulta") pero ningún importe → el parser NO debe emitir filas.
const BTF268_SIN_PAPELETAS =
  'CONSULTA DE PAPELETAS\n' +
  'Búsqueda por Placa\n' +
  'Placa: BTF268\n' +
  'Fecha de consulta: 23/06/2026\n' +
  'No se encontraron papeletas registradas pendientes de pago para la placa BTF268.';

// Caso SINTÉTICO (mecánica): filas típicas de un grid aplanado por innerText.
const GRID_SINTETICO =
  'Nº de Papeleta Fecha Falta Importe Estado\n' +
  '1541234567890 12/03/2024 M27 EXCESO DE VELOCIDAD S/ 384.00 Pendiente\n' +
  '1549876543210 05/11/2023 G50 LUZ ROJA S/ 460.00 En cobranza coactiva\n' +
  'TOTAL S/ 844.00';

describe('parseSatPapeletasItems (mecánica del detalle SAT Lima)', () => {
  it('caso real SIN papeletas (BTF268): no inventa filas', () => {
    expect(parseSatPapeletasItems(BTF268_SIN_PAPELETAS)).toEqual([]);
  });

  it('solo emite filas con fecha + importe; ignora cabecera y línea TOTAL', () => {
    const rows = parseSatPapeletasItems(GRID_SINTETICO);
    expect(rows).toHaveLength(2); // ni la cabecera ni "TOTAL S/ 844.00" (sin fecha) cuentan
    expect(rows.map((r) => r.monto)).toEqual([384, 460]);
    expect(rows.map((r) => r.fecha)).toEqual(['12/03/2024', '05/11/2023']);
  });

  it('captura código de falta y estado cuando están presentes', () => {
    const [r] = parseSatPapeletasItems('1541234567890 12/03/2024 M27 EXCESO DE VELOCIDAD S/ 384.00 Pendiente');
    expect(r?.infraccion).toBe('M27');
    expect(r?.estado?.toLowerCase()).toBe('pendiente');
    expect(r?.numero).toBe('1541234567890');
  });
});
