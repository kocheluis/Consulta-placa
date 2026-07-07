import { describe, it, expect } from 'vitest';
import { parseCaracteristicas, parseAsiento, parseAsientos, splitAsientos, normalizeActo, construirTimeline, agruparAsientos } from './asiento-parser.js';

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

// ── Datos REALES de CHP605 (SIGUELO_DEBUG): un título puede traer VARIOS asientos en el mismo
// PDF, y las garantías no tienen etiqueta "Acto" (su acto es la cabecera). Blindan: (1) split
// multi-acto, (2) nombre completo del acto (no "constitutivo"), (3) NO marcar 'remate' falso
// por el clausulado de ejecución de la garantía. La basura entre páginas se simula corta.
const CHP_280600 = // Título con DOS asientos: Compra-Venta + Cancelación de Afectación
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Transferencia de Propiedad 2025 - 00280600 Título Nro Partida 55048257 Placa : CHP605 ' +
  '________ PERSONA NATURAL SOLIS TAIPE JHONATHAN BRAYAN DNI 47793287 Soltero ________ ' +
  'Acto Compra - Venta Precio US$ 13,700.00 Monto Pagado US$ 13,700.00 Forma de Pago CONTADO ________ ' +
  'Documento: Acta Notarial Funcionario: Notario - VELARDE SUSSONI, JORGE ERNESTO Fecha: 06/01/2025 ________ ' +
  'Título 2025-280600 Fecha 27/01/2025 09:42:04 Derechos Pagados S/ 240.60 Fecha de Asiento 06/02/2025 - PRESENTACIÓN ELECTRÓNICA ________ ' +
  'Uz³ÁÌÑÏÉ garbage ÿÿÿ 7±ÿ ' + // basura de fuente entre páginas
  'Levantamiento de Embargo 2025 - 00280600 Título Nro Partida 55048257 Placa : CHP605 ________ ' +
  'Acto Cancelacion de Afectacion ________ ' +
  'DEUDOR / CONSTITUYENTE / DEPOSI - PERSONA JURIDICA YENYERE DIRECCION Y GESTION DE EVENTOS S.A.C. RUC 20603486537 ' +
  'ACREEDOR - PERSONA JURIDICA EMPRESA DE CRÉDITOS SANTANDER CONSUMO PERÚ S.A. RUC 20550226589 ' +
  'REPRESENTANTE - PERSONA JURIDICA ESTUDIO DONGO ABOGADOS S.A.C. RUC 20601146381 ________ ' +
  'Documento: Acta Notarial Funcionario: Notario - VELARDE SUSSONI, JORGE ERNESTO Fecha: 06/01/2025 ________ ' +
  'Título 2025-280600 Fecha 27/01/2025 09:42:04 Fecha de Asiento 06/02/2025 - PRESENTACIÓN ELECTRÓNICA';

const CHP_GARANTIA = // Constitución de Garantía Mobiliaria (sin etiqueta "Acto"; con clausulado de ejecución)
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Constitución Garantía Mobiliaria y Otros Actos 2023 - 02736229 Título Nro Partida 55048257 Placa : CHP605 ________ ' +
  'REGISTRO DE PROPIEDAD VEHICULAR Garantía Mobiliaria ________ ' +
  'Participantes DEUDOR / CONSTITUYENTE / DEPOSITARIO: YENYERE DIRECCION Y GESTION DE EVENTOS S.A.C. RUC 20603486537 PARTIDA 14131401 ' +
  'ACREEDOR: EMPRESA DE CRÉDITOS SANTANDER CONSUMO PERÚ S.A. RUC 20550226589 PARTIDA 12929498 ________ ' +
  'Monto de gravamen Determinado S/. 87,750.00 ________ Valor del (los) bien (es) S/. 87,750.00 ________ ' +
  'Identificación y descripción del(los) bien(es) Marca: JETOUR Modelo: DASHING Placa: CHP605 ________ ' +
  'Forma y condiciones de ejecución del bien MEDIANTE LA VENTA EXTRAJUDICIAL PARA LA VENTA A TERCEROS DE CONFORMIDAD CON LA LEY N°28677, ' +
  'LA ADJUDICACION AL ACREEDOR DE CONFORMIDAD CON LA LEY N°28677, O LA EJECUCION JUDICIAL, CONFORME AL CODIGO PROCESAL CIVIL. ________ ' +
  'Fecha del acto constitutivo 18/09/2023 ________ Plazo de vigencia de la Garantía Indeterminado ________ ' +
  'Documento: Contrato Privado con Firmas Legalizadas Funcionario: Notario VELARDE SUSSONI, JORGE E. Fecha: 18/09/2023 ________ ' +
  'Título Nro. : 2023 - 2736229 Orden Nro. : 2023 - 12736229 Fecha : 19/09/2023 10:04:17 am Derechos Pagados : S/ 144.00 Fecha de Asiento : 05/10/2023 02:38:34 pm Sede : LIMA .';

describe('parseAsientos (multi-acto + normalización, datos CHP605)', () => {
  it('separa un título con 2 asientos en 2 registros (Compra-Venta + Cancelación de Afectación)', () => {
    expect(splitAsientos(CHP_280600)).toHaveLength(2);
    const recs = parseAsientos(CHP_280600);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ acto: 'Compra-Venta', tipo: 'Transferencia de Propiedad', precio: 'US$ 13,700.00' });
    expect(recs[0]?.participantes).toContain('SOLIS TAIPE');
    expect(recs[1]?.acto).toBe('Cancelación de Afectación');
    expect(recs[1]?.participantes).toContain('YENYERE');
    expect(recs[1]?.participantes).toContain('SANTANDER');
    expect(recs[1]?.flags.embargo).toBe(true); // "Levantamiento de Embargo"
    expect(recs[1]?.flags.remate).toBe(false);
  });

  it('la garantía usa el NOMBRE COMPLETO del acto (no "constitutivo")', () => {
    const r = parseAsiento(CHP_GARANTIA);
    expect(r.acto).toBe('Constitución Garantía Mobiliaria y Otros Actos');
    expect(r.acto).not.toMatch(/constitutivo/i);
    expect(r.flags.gravamen).toBe(true);
    expect(r.flags.financiera).toBe(true); // EMPRESA DE CRÉDITOS SANTANDER
    expect(r.participantes).toContain('Deudor: YENYERE');
    expect(r.participantes).toContain('Acreedor: EMPRESA DE CRÉDITOS SANTANDER');
    expect(r.fechaPresentacion).toMatch(/19\/09\/2023/);
  });

  it('NO marca "remate" por el clausulado de ejecución de la garantía (falso positivo CHP605)', () => {
    // El texto tiene "LA ADJUDICACION AL ACREEDOR ... O LA EJECUCION JUDICIAL" — es hipotético, no un remate.
    expect(parseAsiento(CHP_GARANTIA).flags.remate).toBe(false);
  });

  it('normalizeActo corrige tildes y el guion de compra-venta', () => {
    expect(normalizeActo('Compra - Venta')).toBe('Compra-Venta');
    expect(normalizeActo('Cancelacion de Afectacion')).toBe('Cancelación de Afectación');
    expect(normalizeActo('Constitucion Garantia Mobiliaria')).toBe('Constitución Garantía Mobiliaria');
  });
});

// ── Datos REALES de CDK293 (SIGUELO_DEBUG): 3 asientos, pero el título 2024-02723258 trae DOS
// compra-ventas en tracto sucesivo (ZEVALLOS → ROMERO). Blindan: (1) NO contar ese asiento como
// dos (son 3 asientos, no 4), (2) NO sumar los montos (US$16k y US$17k van por separado),
// (3) agruparlos en UN asiento con ambas acciones. Ver `agruparAsientos`.
const CDK_1549906 = // 2025-01549906 · Compra-Venta (asiento simple, 1 acción)
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Transferencia de Propiedad 2025 - 01549906 Título Nro Partida 54901940 Placa : CDK293 ' +
  'PERSONA NATURAL MAUCAYLLA MAMANI NOE JAK DNI 41097147 Soltero ' +
  'Acto Compra - Venta Precio US$ 7,000.00 Monto Pagado US$ 7,000.00 Forma de Pago DEPOSITO A LA CUENTA DE AHORROS ' +
  'Documento: Acta Notarial Funcionario: Notario - MENDOZA VASQUEZ, ENRIQUE Fecha: 23/05/2025 ' +
  'Título 2025-1549906 Fecha 27/05/2025 15:26:04 Derechos Pagados S/ 96.20 Recibo 2025-1-596572(LIMA) Fecha de Asiento 05/06/2025 - PRESENTACIÓN ELECTRÓNICA';

const CDK_2723258 = // 2024-02723258 · UN asiento con DOS compra-ventas (tracto sucesivo). NO son 2 asientos.
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Transferencia de Propiedad 2024 - 02723258 Título Nro Partida 54901940 Placa : CDK293 ' +
  'PERSONA NATURAL ZEVALLOS SOTO STEVEN ALEX DNI 43403766 Casado ' +
  'Acto Compra - Venta Precio US$ 16,000.00 Forma de Pago AL CONTADO ' +
  'Documento: Acta de Transferencia Funcionario: Notario - MEDINA RAGGIO, FERNANDO MARIO Fecha: 27/08/2024 ' +
  'Título 2024-2723258 Fecha 17/09/2024 16:39:42 Derechos Pagados S/ 185.20 Recibo 2024-1-1026764(LIMA) Fecha de Asiento 20/09/2024 - PRESENTACIÓN ELECTRÓNICA ' +
  'ỹ Transferencia de Propiedad 2024 - 02723258 Título Nro Partida 54901940 Placa : CDK293 ' +
  'PERSONA NATURAL ROMERO SANCHEZ WILLY JHONATAN DNI 48728641 Soltero ' +
  'Acto Compra - Venta Precio US$ 17,000.00 Forma de Pago AL CONTADO ' +
  'Documento: Acta de Transferencia Funcionario: Notario - MEDINA RAGGIO, FERNANDO MARIO Fecha: 13/09/2024 ' +
  'Título 2024-2723258 Fecha 17/09/2024 16:39:42 Derechos Pagados S/ 185.20 Recibo 2024-1-1026764(LIMA) Fecha de Asiento 20/09/2024 - PRESENTACIÓN ELECTRÓNICA';

const CDK_170786 = // 2023-00170786 · Primera Inscripción de Dominio (trae ficha técnica)
  'Este documento solo tiene fines informativos y no constituye publicidad registral. ' +
  'Inscripción de Vehículo 2023 - 00170786 Título Nro Partida 54901940 Placa : CDK293 ' +
  'PERSONA NATURAL CHAVEZ RAMIREZ CINTHYA LESLIE DNI 42028316 Casado SEPARACION DE PATRIMONIO. PARTIDA REGISTRAL: 13895386 ' +
  'Acto Primera Inscripción de Dominio Precio US$ 31,790.00 Forma de Pago CONTADO ' +
  'DUA 118 2022 10 507334 1 Tipo de Uso Vehiculos Particulares (Categoria M) Categoria M1 Nro. VIN KMHLR41FGPU460603 ' +
  'Nro. Serie KMHLR41FGPU460603 Nro. Motor G4FPNU342867 Marca HYUNDAI Modelo NEW ELANTRA Año Modelo 2023 Nro. Versión GLS ' +
  'Color NEGRO Tipo Carrocería SEDAN Nro. Ruedas 4 Nro. Ejes 2 Fórmula Rodante 4X2 Potencia Motor 150@6300 ' +
  'Tipo Combustible GASOLINA Nro. Cilindros 4 Cilindrada 1.598 L Longitud 4.675 mt Ancho 1.825 mt Altura 1.43 mt ' +
  'Nro. Asientos 5 Nro. Pasajeros 4 Peso Bruto 1.850 tn Peso Neto 1.330 tn Carga Util 0.520 tn ' +
  'Documento: Boleta de Venta Funcionario: Persona Jurídica - MAQUINARIA NACIONAL SA PERU Fecha: 17/12/2022 ' +
  'Título 2023-170786 Fecha 17/01/2023 14:42:23 Monto Cobrado S/ 89.00 Recibo 2023-206-3811(LIMA) Fecha Asiento 20/01/2023';

describe('agruparAsientos (un asiento = un título, con N acciones)', () => {
  it('el título con 2 compra-ventas es UN asiento con 2 acciones (no 2 asientos)', () => {
    const grupos = agruparAsientos(parseAsientos(CDK_2723258));
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.titulo).toBe('2024-2723258');
    expect(grupos[0]?.acciones).toHaveLength(2);
    // Los montos van POR SEPARADO — nunca sumados (no US$ 33,000).
    expect(grupos[0]?.acciones.map((a) => a.precio)).toEqual(['US$ 16,000.00', 'US$ 17,000.00']);
    expect(grupos[0]?.acciones[0]?.participantes).toContain('ZEVALLOS SOTO');
    expect(grupos[0]?.acciones[1]?.participantes).toContain('ROMERO SANCHEZ');
    expect(grupos[0]?.acciones.every((a) => a.acto === 'Compra-Venta')).toBe(true);
  });

  it('CDK293 completa: 3 asientos (no 4) y 3 transferencias de dominio', () => {
    const recs = [...parseAsientos(CDK_1549906), ...parseAsientos(CDK_2723258), ...parseAsientos(CDK_170786)];
    const grupos = agruparAsientos(construirTimeline(recs));
    expect(grupos).toHaveLength(3); // ← el fix: antes contaba 4 (partía el tracto sucesivo)
    const transfers = grupos.reduce(
      (n, g) => n + g.acciones.filter((a) => /compra\s*-?\s*venta|adjudicaci[oó]n/i.test(a.acto)).length, 0,
    );
    expect(transfers).toBe(3); // 3 compra-ventas (7k + 16k + 17k); la 1ª inscripción no cuenta
    // La ficha técnica del vehículo sale de la Primera Inscripción.
    const conFicha = recs.find((r) => r.caracteristicas);
    expect(conFicha?.caracteristicas?.version).toBe('GLS');
    expect(conFicha?.caracteristicas?.bodywork).toBe('SEDAN');
  });

  it('CHP605: cancelación + compra-venta en el mismo asiento → 1 grupo, 2 acciones', () => {
    const grupos = agruparAsientos(parseAsientos(CHP_280600));
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.acciones).toHaveLength(2);
    expect(grupos[0]?.acciones.map((a) => a.acto)).toEqual(['Compra-Venta', 'Cancelación de Afectación']);
    expect(grupos[0]?.flags.embargo).toBe(true); // OR de las banderas de sus acciones
  });

  it('asientos con títulos distintos NO se agrupan (un grupo por título)', () => {
    const grupos = agruparAsientos([...parseAsientos(CDK_1549906), ...parseAsientos(CDK_170786)]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.acciones.length)).toEqual([1, 1]);
  });
});
