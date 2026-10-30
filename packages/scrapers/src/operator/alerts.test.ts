import { describe, it, expect } from 'vitest';
import { outcomeOf, levelOf, maskContact, isClientOrigin, renderClientAlertEmail, summarizeClients, shouldFlush } from './alerts.js';
import { evaluateSecurity, publicPorts, parseAccepted } from './vps-audit.js';
import { renderHealthEmail, overallDaily } from './health.js';

const r = (source: string, status: string, summary = '') => ({ source, status, summary });
const ped = (o: Record<string, unknown> = {}) => ({ id: 42, placa: 'AAA111', tier: 'PRO', origin: 'servicio', email: 'juan.perez@example.com', ...o });

describe('outcomeOf / levelOf (lo que recibió el cliente)', () => {
  it('reporte con huecos → alerta, con dependencia marcada', () => {
    const o = outcomeOf(ped(), [r('SUNARP', 'ENCONTRADO'), r('HISTORIAL', 'ERROR', 'timeout 600s'),
      r('FISE_GNV', 'ERROR', 'no ejecutada: sin señal de combustible (el historial falló)')], '2026-10-30T10:00:00Z');
    expect(levelOf(o)).toBe('alerta');
    expect(o.failed.map((f) => [f.source, f.dependency])).toEqual([['historial', false], ['fise-gnv', true]]);
    expect(o.paid).toBe(true);
    expect(o.contact).toBe('j***@example.com');
  });
  it('sin reporte (todas en error o error del motor) → crítico; completo → ok', () => {
    expect(levelOf(outcomeOf(ped(), [r('SUNARP', 'ERROR', 'x')], 'x'))).toBe('critico');
    expect(levelOf(outcomeOf(ped(), [], 'x', 'ninguna fuente respondió'))).toBe('critico');
    expect(levelOf(outcomeOf(ped({ tier: 'BASIC' }), [r('SUNARP', 'SIN_REGISTRO')], 'x'))).toBe('ok');
  });
  it('los pedidos del operador (consola, chequeo diario) no son de clientes', () => {
    expect(isClientOrigin('operador')).toBe(false);
    for (const o of ['servicio', 'cupo', 'reintento', 'bot', null]) expect(isClientOrigin(o)).toBe(true);
  });
  it('enmascara contacto: nunca el correo/celular completo', () => {
    expect(maskContact(null, '+51 987 654 321')).toBe('wa ***321');
    expect(maskContact(null, null)).toBe('anónimo');
  });
});

describe('correo de alarma y resumen diario', () => {
  const bad = outcomeOf(ped(), [r('SUNARP', 'ENCONTRADO'), r('SATCAJ_PAPELETAS', 'ERROR', '<script>x</script>')], '2026-10-30T10:00:00Z');
  const fatal = outcomeOf(ped({ id: 43, placa: 'ABC123', tier: 'ULTRA' }), [], '2026-10-30T10:01:00Z', 'ninguna fuente respondió');
  it('asunto cuenta los casos y escapa HTML', () => {
    const e = renderClientAlertEmail([bad, fatal]);
    expect(e.subject).toContain('2 reportes con error a clientes');
    expect(e.subject).toContain('1 SIN reporte');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).not.toContain('juan.perez');
  });
  it('resumen 24 h: totales, pagados y fuentes que más fallaron', () => {
    const ok = outcomeOf(ped({ id: 44 }), [r('SUNARP', 'ENCONTRADO')], '2026-10-30T11:00:00Z');
    const old = outcomeOf(ped({ id: 1 }), [r('SUNARP', 'ERROR')], '2026-10-20T11:00:00Z');
    const s = summarizeClients([ok, bad, fatal, old], Date.parse('2026-10-29T12:00:00Z'));
    expect(s).toMatchObject({ total: 3, ok: 1, conError: 1, sinReporte: 1, pagados: 3, pagadosConProblema: 2 });
    expect(s.top).toEqual([{ source: 'satcaj-papeletas', count: 1 }]);
    expect(overallDaily({ infra: [], sources: [], clients: s })).toBe('critico');
    const mail = renderHealthEmail({ trigger: 'diario', startedAt: 'x', plates: [], pedidos: [], infra: [], sources: [], overall: 'critico', headline: 'h', clients: s });
    expect(mail.subject).toContain('1 SIN reporte');
    expect(mail.text).toContain('CLIENTES (24 h)');
  });
  it('ventana de agrupado: lo fatal sale ya; lo demás espera; tope por hora', () => {
    const now = Date.parse('2026-10-30T10:02:00Z');
    expect(shouldFlush([bad], now, 5 * 60_000, 0, 6)).toBe(false);
    expect(shouldFlush([bad], now + 4 * 60_000, 5 * 60_000, 0, 6)).toBe(true);
    expect(shouldFlush([bad, fatal], now, 5 * 60_000, 0, 6)).toBe(true);
    expect(shouldFlush([fatal], now, 5 * 60_000, 6, 6)).toBe(false);
  });
});

describe('auditoría de seguridad del VPS', () => {
  it('detecta puertos públicos inesperados', () => {
    const ss = 'LISTEN 0 511 127.0.0.1:3010 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:3011 0.0.0.0:*\nLISTEN 0 511 *:5678 *:*\nLISTEN 0 128 [::]:22 [::]:*';
    expect(publicPorts(ss)).toEqual([22, 3011, 5678]);
    const c = evaluateSecurity({ listening: ss, allowedPublicPorts: [22, 3011] });
    expect(c[0]).toMatchObject({ severity: 'warn' });
    expect(c[0]!.detail).toContain('5678');
  });
  it('llave SSH nueva respecto a la línea base → fail; primera vez → adopta sin alarma', () => {
    expect(evaluateSecurity({ keysNow: ['root:SHA256:a x'], keysBaseline: null })[0]!.severity).toBe('ok');
    const c = evaluateSecurity({ keysNow: ['root:SHA256:a x', 'root:SHA256:b intruso'], keysBaseline: ['root:SHA256:a x'] });
    expect(c[0]).toMatchObject({ severity: 'fail' });
    expect(c[0]!.detail).toContain('intruso');
  });
  it('sshd con contraseña, ufw inactivo, env 644 y login por contraseña', () => {
    const c = evaluateSecurity({ sshdT: 'port 22\npasswordauthentication yes\npermitrootlogin yes', ufw: 'Status: inactive', envMode: '644',
      acceptedLogins: parseAccepted('sshd[1]: Accepted password for root from 1.2.3.4 port 5 ssh2') });
    const by = Object.fromEntries(c.map((x) => [x.id, x.severity]));
    expect(by).toMatchObject({ 'sec-ssh-pass': 'warn', 'sec-ssh-root': 'warn', 'sec-ufw': 'fail', 'sec-env': 'fail', 'sec-ssh-ok': 'warn' });
  });
});
