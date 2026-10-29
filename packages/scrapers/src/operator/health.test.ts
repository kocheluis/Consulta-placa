import { describe, it, expect } from 'vitest';
import { evaluateSources, overallOf, supabaseKeyKind, shouldRunDaily, limaDateKey, renderHealthEmail, type InfraCheck } from './health.js';

const r = (source: string, status: string, summary = '') => ({ source, status, summary });
const okInfra: InfraCheck[] = [{ id: 'motor', label: 'Motor', severity: 'ok', detail: 'encendido' }];

describe('evaluateSources (veredicto por fuente sobre las placas testigo)', () => {
  it('caso real VPS sin Chromium: las ligeras caen en todas las placas → falla; GNV → dependencia', () => {
    const plate = (placa: string) => ({ placa, results: [
      r('SUNARP', 'ENCONTRADO'),
      r('SAT_PAPELETAS', 'ERROR', "browserType.launch: Executable doesn't exist"),
      r('HISTORIAL', 'ERROR', 'timeout'),
      r('FISE_GNV', 'ERROR', 'no ejecutada: sin señal de combustible (el historial falló o no corrió) — omitida para no gastar captcha'),
    ] });
    const rows = evaluateSources([plate('AAA111'), plate('BBB222')], ['sunarp', 'sat-papeletas', 'historial', 'fise-gnv']);
    const by = Object.fromEntries(rows.map((x) => [x.source, x.verdict]));
    expect(by).toEqual({ sunarp: 'ok', 'sat-papeletas': 'falla', historial: 'falla', 'fise-gnv': 'dependencia' });
    expect(rows[0]!.verdict).toBe('falla'); // ordenado: lo roto primero
  });

  it('falla en una placa y responde en otra → intermitente; sin resultado → sin-dato', () => {
    const rows = evaluateSources([
      { placa: 'AAA111', results: [r('MTC_CITV', 'ERROR', 'captcha')] },
      { placa: 'BBB222', results: [r('MTC_CITV', 'SIN_REGISTRO')] },
      { placa: 'CCC333', results: null },
    ], ['mtc-citv', 'atu']);
    expect(rows.find((x) => x.source === 'mtc-citv')).toMatchObject({ verdict: 'intermitente', ok: 1, err: 1 });
    expect(rows.find((x) => x.source === 'atu')!.verdict).toBe('sin-dato');
  });
});

describe('overallOf', () => {
  it('infra en fail → crítico; mitad de fuentes caídas → crítico; un aviso → alerta; todo ok → ok', () => {
    const okRow = { source: 'a', verdict: 'ok' as const, ok: 1, err: 0, errors: [] };
    const bad = { ...okRow, source: 'b', verdict: 'falla' as const };
    expect(overallOf([{ id: 'x', label: 'X', severity: 'fail', detail: '' }], [okRow])).toBe('critico');
    expect(overallOf(okInfra, [okRow, bad])).toBe('critico');
    expect(overallOf(okInfra, [okRow, okRow, okRow, bad])).toBe('alerta');
    expect(overallOf(okInfra, [okRow])).toBe('ok');
  });
});

describe('supabaseKeyKind (la anon key rompe la cola en silencio por RLS)', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.firma`;
  it('distingue service_role / anon / formatos nuevos', () => {
    expect(supabaseKeyKind(jwt('service_role'))).toBe('service');
    expect(supabaseKeyKind(jwt('anon'))).toBe('publica');
    expect(supabaseKeyKind('sb_secret_abc')).toBe('service');
    expect(supabaseKeyKind('sb_publishable_abc')).toBe('publica');
    expect(supabaseKeyKind('')).toBe('vacia');
    expect(supabaseKeyKind('loquesea')).toBe('desconocida');
  });
});

describe('shouldRunDaily (hora de Lima, una vez por día)', () => {
  const lima = (iso: string) => Date.parse(`${iso}-05:00`);
  it('corre desde la hora configurada y solo una vez ese día', () => {
    expect(shouldRunDaily(lima('2026-10-30T05:59:00'), 6, null)).toBe(false);
    expect(shouldRunDaily(lima('2026-10-30T06:00:00'), 6, null)).toBe(true);
    expect(shouldRunDaily(lima('2026-10-30T14:00:00'), 6, '2026-10-30')).toBe(false);
    // 23:30 en Lima ya es el día siguiente en UTC: la clave debe seguir siendo el día de Lima.
    expect(limaDateKey(lima('2026-10-30T23:30:00'))).toBe('2026-10-30');
  });
});

describe('renderHealthEmail', () => {
  it('asunto con el titular y escapa HTML de los errores', () => {
    const e = renderHealthEmail({ trigger: 'manual', startedAt: 'x', plates: ['AAA111'], pedidos: [], infra: okInfra,
      sources: [{ source: 'atu', verdict: 'falla', ok: 0, err: 1, errors: [{ placa: 'AAA111', summary: '<b>roto</b>' }] }],
      overall: 'critico', headline: '1 caída(s): atu' });
    expect(e.subject).toContain('1 caída(s): atu');
    expect(e.html).toContain('&lt;b&gt;roto&lt;/b&gt;');
    expect(e.text).toContain('[CAÍDA] atu');
  });
});
