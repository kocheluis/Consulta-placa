import { describe, it, expect } from 'vitest';
import { parseCaracteristicas, parseAsiento, construirTimeline } from './asiento-parser.js';

/**
 * Textos REALES capturados de los asientos de ADY067 (SIGUELO_DEBUG=1), tal como los aplana
 * `pdfBytesToText`: etiqueta→valor, fila por fila, con las filas de guiones bajos que separan
 * bloques en el PDF. Blindan la extracción de la ficha técnica contra el formato real.
 */
const ASIENTO_CAMBIO = // 2025-03325177 · Cambio de Características (el más reciente → estado actual)
  'Este documento solo tiene fines informativos y no constituye publicidad registral. Cambio de Características ' +
  '2025 - 03325177 Título Nro Partida 53054190 Placa : ADY067 ' +
  '________________________________________________________________________ ' +
  'PERSONA NATURAL CHUQUIPIONDO RAYMUNDO JULIO ABEL DNI 08701061 Soltero ' +
  '________________________________________________________________________ Acto Cambio de Color ' +
  '________________________________________________________________________ ' +
  'DUA 118 2015 10 022541 1 Tipo de Uso Taxis y Colectivos (Categoria M1) Categoria M1 ' +
  'Nro. VIN LGXC16AF8E0054849 Nro. Serie LGXC16AF8E0054849 Nro. Motor BYD473QD714323110 ' +
  'Marca BYD Modelo F3 Año Modelo 2014 Nro. Versión GL-I GNV Color AMARILLO ' +
  'Tipo Carrocería SEDAN Nro. Ruedas 4 Nro. Ejes 2 Fórmula Rodante 4X2 Potencia Motor 78@6000 ' +
  'Tipo Combustible BI-COMBUSTIBLE GNV Nro. Cilindros 4 Cilindrada 1.488 L ' +
  'Longitud 4.533 mt Ancho 1.705 mt Altura 1.49 mt Nro. Asientos 5 Nro. Pasajeros 4 ' +
  'Peso Bruto 2.075 tn Peso Neto 1.200 tn Carga Util 0.875 tn ' +
  '________________________________________________________________________ ' +
  'Documento: Formulario Registral Funcionario: Persona Natural - 2025-263491 Fecha: 06/11/2025 ' +
  '________________________________________________________________________ ' +
  'Título 2025-3325177 Fecha 06/11/2025 09:42:42 Monto Cobrado S/ 48.10';

const ASIENTO_PRIMERA = // 2015-00098641 · Primera Inscripción (trae además "Año Fabricación"; Color PLATA)
  'Este documento solo tiene fines informativos y no constituye publicidad registral. Inscripción de Vehículo ' +
  '2015 - 00098641 Título Nro Partida 53054190 Placa : ADY067 ' +
  '________________________________________________________________________ Acto Primera Inscripción de Dominio ' +
  'Precio US$ 13,790.00 Monto Pagado US$ 13,790.00 Forma de Pago AL CONTADO ' +
  '________________________________________________________________________ ' +
  'DUA 118 2015 10 022541 1 Tipo de Uso Taxis y Colectivos (Categoria M1) Categoria M1 ' +
  'Nro. VIN LGXC16AF8E0054849 Nro. Serie LGXC16AF8E0054849 Nro. Motor BYD473QD714323110 ' +
  'Marca BYD Año Fabricación 2014 Modelo F3 Año Modelo 2014 Nro. Versión GL-I GNV Color PLATA ' +
  'Tipo Carrocería SEDAN Nro. Ruedas 4 Nro. Ejes 2 Fórmula Rodante 4X2 Potencia Motor 78@6000 ' +
  'Tipo Combustible BI-COMBUSTIBLE GNV Nro. Cilindros 4 Cilindrada 1.488 L ' +
  'Longitud 4.533 mt Ancho 1.705 mt Altura 1.49 mt Nro. Asientos 5 Nro. Pasajeros 4 ' +
  'Peso Bruto 2.075 tn Peso Neto 1.200 tn Carga Util 0.875 tn ' +
  '________________________________________________________________________ Documento: Declaración Unica de Aduanas';

// B9K236 (KIA Sorento): MISMA ficha pero con los campos en OTRO ORDEN (carrocería/color/versión antes
// que VIN/serie; uso/categoría al final; trae "Peso Seco" y "Nro. Puertas"). Blinda la independencia
// del orden — antes salía ilegible (un campo se tragaba todo el bloque).
const ASIENTO_ORDEN_DISTINTO =
  'Cambio de Características 2011 - 854220 Nro Partida 111111 Placa : B9K236 ' +
  '________________________________________________________________________ ' +
  'Tipo Carrocería SUV Color BLANCO CLARO Nro. Versión GAS 2.4 ' +
  'Nro. Serie KNAKU811AC5195316 Nro. VIN KNAKU811AC5195316 Nro. Motor G4KEBH752239 ' +
  'Potencia Motor 174@6000 Tipo Combustible GASOLINA Nro. Cilindros 4 Cilindrada 2.349 cc ' +
  'Peso Seco 1.697 tn Peso Neto 1.697 tn Carga Util 0.813 tn Peso Bruto 2.510 tn ' +
  'Nro. Asientos 7 Longitud 4.68 mt Ancho 1.88 mt Altura 1.71 mt Fórmula Rodante 4X2 ' +
  'Nro. Pasajeros 6 Nro. Puertas 5 Nro. Ruedas 4 Nro. Ejes 2 ' +
  'Tipo de Uso Vehiculos Particulares (Categoria M) Categoria M1 ' +
  '________________________________________________________________________ Documento: Formulario Registral';

/** Asiento de gravamen (Garantía Mobiliaria): NO trae la ficha (usa "Serie:"/"Motor:", sin "Nro. VIN"). */
const ASIENTO_GRAVAMEN =
  'Constitución Garantía Mobiliaria y Otros Actos 2015 - 77133345 Nro Partida 53054190 Placa : ADY067 ' +
  'Identificación y descripción del(los) bien(es) Marca: BYD Modelo: F3 Placa: ADY067 ' +
  'Motor: BYD473QD714323110 Serie: LGXC16AF8E0054849 Fecha del acto constitutivo 19/06/2015';

describe('parseCaracteristicas (ficha técnica del asiento)', () => {
  it('extrae la ficha del Cambio de Características (incluye Carga Util sin los guiones bajos)', () => {
    expect(parseCaracteristicas(ASIENTO_CAMBIO)).toMatchObject({
      version: 'GL-I GNV', category: 'M1', usage: 'Taxis y Colectivos (Categoria M1)',
      bodywork: 'SEDAN', fuel: 'BI-COMBUSTIBLE GNV', displacement: '1.488 L', cylinders: '4',
      power: '78@6000', axles: '2', wheels: '4', driveFormula: '4X2', seats: '5', passengers: '4',
      length: '4.533 mt', width: '1.705 mt', height: '1.49 mt',
      grossWeight: '2.075 tn', netWeight: '1.200 tn', payload: '0.875 tn',
    });
  });

  it('extrae la ficha de la Primera Inscripción pese al campo extra "Año Fabricación"', () => {
    const s = parseCaracteristicas(ASIENTO_PRIMERA);
    expect(s?.version).toBe('GL-I GNV');
    expect(s?.bodywork).toBe('SEDAN');
    expect(s?.payload).toBe('0.875 tn');
  });

  it('extrae bien aunque los campos vengan en OTRO ORDEN (B9K236, no ilegible)', () => {
    expect(parseCaracteristicas(ASIENTO_ORDEN_DISTINTO)).toMatchObject({
      version: 'GAS 2.4', bodywork: 'SUV', fuel: 'GASOLINA', displacement: '2.349 cc', cylinders: '4',
      power: '174@6000', seats: '7', passengers: '6', wheels: '4', axles: '2', driveFormula: '4X2',
      length: '4.68 mt', width: '1.88 mt', height: '1.71 mt',
      grossWeight: '2.510 tn', netWeight: '1.697 tn', payload: '0.813 tn',
      usage: 'Vehiculos Particulares (Categoria M)', category: 'M1',
    });
  });

  it('devuelve null en un asiento de gravamen (sin ficha)', () => {
    expect(parseCaracteristicas(ASIENTO_GRAVAMEN)).toBeNull();
  });

  it('parseAsiento adjunta la ficha en `caracteristicas`', () => {
    expect(parseAsiento(ASIENTO_CAMBIO).caracteristicas?.version).toBe('GL-I GNV');
    expect(parseAsiento(ASIENTO_GRAVAMEN).caracteristicas).toBeNull();
  });

  it('el más reciente con ficha (Cambio, color actual) gana sobre la Primera Inscripción', () => {
    // Simula la selección de historial.ts: recorre el timeline de atrás hacia adelante.
    const timeline = construirTimeline([parseAsiento(ASIENTO_PRIMERA), parseAsiento(ASIENTO_CAMBIO)]);
    let ficha = null;
    for (let i = timeline.length - 1; i >= 0; i--) { const c = timeline[i]?.caracteristicas; if (c) { ficha = c; break; } }
    expect(ficha?.version).toBe('GL-I GNV');
  });
});
