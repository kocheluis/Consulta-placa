import { describe, it, expect } from 'vitest';
import { parseSunarpOcr } from './ocr-parser.js';

// Salida OCR REAL de tesseract sobre el certificado de SUNARP (placa de prueba
// VAS710, vehículo de una aseguradora — no personal). Incluye el ruido típico:
// "Nº" leído como N9/No/NC y líneas basura del encabezado.
const OCR_REAL = `Nene Consulta
sunarp.:: O Vehicular
DATOS DEL VEHÍCULO
N9 PLACA: VAS710
No SERIE: SAJBA3CD9N1658907
N9 VIN: SAJBA3CD9N1658907
NC MOTOR: 16DG219987
COLOR: BLANCO
MARCA: TOYOTA
MODELO: HILUX
PLACA VIGENTE: VAS710
PLACA ANTERIOR: NINGUNA
ESTADO: EN CIRCULACION
ANOTACIONES: NINGUNA
SEDE: AREQUIPA
AÑO DE MODELO: 2022
PROPIETARIO(S):
QUALITAS COMPAÑIA DE SEGUROS S.A.
20/06/2026 02:03:34`;

describe('parseSunarpOcr', () => {
  it('extrae los datos del vehículo del texto OCR real (ruido N°)', () => {
    const [r] = parseSunarpOcr(OCR_REAL, 'VAS-710');
    expect(r!.status).toBe('AVAILABLE');
    expect(r!.vehicle?.brand).toBe('TOYOTA');
    expect(r!.vehicle?.model).toBe('HILUX');
    expect(r!.vehicle?.year).toBe(2022);
    expect(r!.vehicle?.color).toBe('BLANCO');
    expect(r!.vehicle?.serie).toBe('SAJBA3CD9N1658907');
    expect(r!.vehicle?.vin).toBe('SAJBA3CD9N1658907');
    expect(r!.vehicle?.engineNumber).toBe('16DG219987');
    expect(r!.vehicle?.sede).toBe('AREQUIPA');
    expect(r!.vehicle?.registralStatus).toBe('EN CIRCULACION');
    expect(r!.vehicle?.platePrevious).toBeNull(); // "NINGUNA"
    expect(r!.vehicle?.stolenAlert).toBe(false);
    expect(r!.ownerName).toBe('QUALITAS COMPAÑIA DE SEGUROS S.A.');
  });

  it('corrige el paréntesis del OCR a J en serie/VIN y no deja símbolos', () => {
    // Caso real (placa AYE066): el OCR leyó la J como ")" → "…4575)4002451".
    const ocr = `N9 SERIE: 9BWAL4575)4002451\nN9 VIN: 9BWAL4575)4002451\nNC MOTOR: CWS03-1524`;
    const [r] = parseSunarpOcr(ocr, 'AYE-066');
    expect(r!.vehicle?.serie).toBe('9BWAL4575J4002451');
    expect(r!.vehicle?.vin).toBe('9BWAL4575J4002451');
    // Cualquier otro símbolo (guion aquí) se elimina: solo letras y números.
    expect(r!.vehicle?.engineNumber).toBe('CWS031524');
  });

  it('marca robo cuando ANOTACIONES menciona robo/captura', () => {
    const [r] = parseSunarpOcr('N9 PLACA: ABC123\nANOTACIONES: ORDEN DE CAPTURA POR ROBO', 'ABC-123');
    expect(r!.vehicle?.stolenAlert).toBe(true);
  });

  it('devuelve NOT_FOUND si no hay datos', () => {
    const [r] = parseSunarpOcr('texto sin estructura', 'XYZ-789');
    expect(r!.status).toBe('NOT_FOUND');
  });
});
