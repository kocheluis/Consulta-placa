import { describe, expect, it } from 'vitest';
import { adviceFor, classifyFailure, firstUrl, remediationCounts, remediationText, type RemediationItem } from './remediate.js';

// Errores REALES del chequeo del 21-nov-2026.
const SBS = 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://servicios.sbs.gob.pe/reportesoat/\nCall log:\n  - navigating to "https://servicios.sbs.gob.pe/reportesoat/", waiting until "domcontentloaded"';
const APESEG = 'captcha/Turnstile/API sin respuesta · r1[sin-frame-spa] r2[sin-frame-spa] ·  · api:{}';
const SATT = "locator.waitFor: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator('form[name=\"frmPLACA\"] input[name=\"txtdescripcion\"]') to be visible";

describe('classifyFailure', () => {
  it('DNS que no resuelve = portal caído', () => expect(classifyFailure(SBS)).toBe('portal-caido'));
  it('captcha sin respuesta = captcha (aunque diga sin-frame)', () => expect(classifyFailure(APESEG)).toBe('captcha'));
  it('no encuentra el formulario = la página cambió', () => expect(classifyFailure(SATT)).toBe('pagina-cambio'));
  it('timeout al navegar = portal caído', () => expect(classifyFailure('page.goto: Timeout 30000ms exceeded.')).toBe('portal-caido'));
  it('sesión SUNARP', () => expect(classifyFailure('Sesión Finalizada en SPRL')).toBe('sesion'));
  it('desconocido', () => expect(classifyFailure('algo raro')).toBe('desconocido'));
});

describe('firstUrl', () => {
  it('toma la URL del error de Playwright', () => expect(firstUrl(SBS)).toBe('https://servicios.sbs.gob.pe/reportesoat/'));
  it('sin URL', () => expect(firstUrl(SATT)).toBeNull());
});

describe('adviceFor / resumen', () => {
  const base: RemediationItem = { source: 'x', placa: 'ABC123', kind: 'pagina-cambio', attempts: [], fixed: false };
  it('recuperada en el 2º reintento', () => {
    const it2 = { ...base, fixed: true, attempts: [{ at: '', ok: false, status: 'ERROR', summary: '' }, { at: '', ok: true, status: 'ENCONTRADO', summary: '' }] };
    expect(adviceFor(it2)).toContain('reintento 2');
  });
  it('portal caído confirmado por el probe', () => {
    expect(adviceFor({ ...base, kind: 'portal-caido', probe: { url: 'u', reachable: false, detail: 'ENOTFOUND' } })).toContain('no responde desde el VPS');
  });
  it('página cambiada pide arreglo con aprobación', () => expect(adviceFor(base)).toContain('aprobación'));
  it('cuenta resueltas y pendientes', () => {
    const rem = { startedAt: '', items: [{ ...base, fixed: true }, base], actions: [{ label: 'Reinicio de xvfb', ok: true, detail: 'estaba errored → ahora online' }] };
    expect(remediationCounts(rem)).toEqual({ total: 2, fixed: 1, pending: 1 });
    expect(remediationText(rem).join('\n')).toContain('1 de 2');
  });
});
