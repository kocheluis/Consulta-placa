import { describe, it, expect } from 'vitest';
import { parseCaracteristicas, parseAsiento } from './asiento-parser.js';

/**
 * Texto reconstruido del asiento "Cambio de Características" de ADY067 (título 2025-3325177),
 * tal como lo aplana `pdfBytesToText` (etiqueta→valor, fila por fila, un espacio). Los valores
 * son los de la ficha real capturada. Sirve para blindar la extracción de la ficha técnica —
 * en especial el par Tipo de Uso/Categoría, donde el uso contiene "(Categoria M1)".
 *
 * NOTA: valida la LÓGICA de las regex; el layout exacto del PDF real se confirma con una captura
 * en vivo (SIGUELO_DEBUG=1) antes de desplegar.
 */
const ASIENTO_CON_FICHA =
  'Cambio de Caracteristicas PERSONA NATURAL Acto Cambio de Color DUA 118 2015 10 022541 1 ' +
  'Tipo de Uso Taxis y Colectivos (Categoria M1) Categoria M1 ' +
  'Nro. VIN LGXC16AF8E0054849 Nro. Serie LGXC16AF8E0054849 Nro. Motor BYD473QD714323110 ' +
  'Marca BYD Modelo F3 Año Modelo 2014 Nro. Versión GL-I GNV Color AMARILLO ' +
  'Tipo Carrocería SEDAN Nro. Ruedas 4 Nro. Ejes 2 Fórmula Rodante 4X2 Potencia Motor 78@6000 ' +
  'Tipo Combustible BI-COMBUSTIBLE GNV Nro. Cilindros 4 Cilindrada 1.488 L ' +
  'Longitud 4.533 mt Ancho 1.705 mt Altura 1.49 mt Nro. Asientos 5 Nro. Pasajeros 4 ' +
  'Peso Bruto 2.075 tn Peso Neto 1.200 tn Carga Util 0.875 tn ' +
  'Documento: Formulario Registral Funcionario: Persona Natural - 2025-263491 Fecha: 06/11/2025 ' +
  'Título 2025-3325177 Fecha 06/11/2025 09:42:42 Monto Cobrado S/. 48.10';

/** Un asiento de gravamen: NO trae ficha técnica (ni VIN ni versión) → debe devolver null. */
const ASIENTO_SIN_FICHA =
  'Constitución de Garantía Mobiliaria 2015-77133345 Nro Partida 53054190 Placa ADY067 ' +
  'Acto Constitución de Garantía Mobiliaria a favor de BANCO Precio S/. 35,209.35';

describe('parseCaracteristicas (ficha técnica del asiento)', () => {
  it('extrae la ficha completa, con versión y separando uso/categoría', () => {
    const s = parseCaracteristicas(ASIENTO_CON_FICHA);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      version: 'GL-I GNV',
      category: 'M1',
      usage: 'Taxis y Colectivos (Categoria M1)',
      bodywork: 'SEDAN',
      fuel: 'BI-COMBUSTIBLE GNV',
      displacement: '1.488 L',
      cylinders: '4',
      power: '78@6000',
      axles: '2',
      wheels: '4',
      driveFormula: '4X2',
      seats: '5',
      passengers: '4',
      length: '4.533 mt',
      width: '1.705 mt',
      height: '1.49 mt',
      grossWeight: '2.075 tn',
      netWeight: '1.200 tn',
      payload: '0.875 tn',
    });
  });

  it('devuelve null cuando el asiento no trae ficha (gravamen)', () => {
    expect(parseCaracteristicas(ASIENTO_SIN_FICHA)).toBeNull();
  });

  it('parseAsiento adjunta la ficha en `caracteristicas`', () => {
    expect(parseAsiento(ASIENTO_CON_FICHA).caracteristicas?.version).toBe('GL-I GNV');
    expect(parseAsiento(ASIENTO_SIN_FICHA).caracteristicas).toBeNull();
  });
});
