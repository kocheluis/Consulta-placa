import { describe, it, expect } from 'vitest';
import { sprlSessionState } from './sprl-login.js';

describe('sprlSessionState', () => {
  it('cabecera "¡Hola!" + modal "Sesión Finalizada" = FINALIZADA, no VIVA (CHU444, 30-oct)', () => {
    const txt = 'Inicio JE ¡Hola, Juan Pérez! Usuario X · SALDO DISPONIBLE S/ 0.00 Sesión Finalizada Si ve este mensaje por que el sistema cerró su sesión intempestivamente, verifique que la IP Publica…';
    expect(sprlSessionState(txt)).toBe('FINALIZADA');
  });
  it('viva / caída / desconocido', () => {
    expect(sprlSessionState('¡Hola, Juan! SALDO DISPONIBLE BUSCAR SERVICIOS')).toBe('VIVA');
    expect(sprlSessionState('Usuario Password INGRESAR')).toBe('CAIDA');
    expect(sprlSessionState('')).toBe('DESCONOCIDO');
  });
});
