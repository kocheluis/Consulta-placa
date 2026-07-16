import { describe, it, expect, afterEach } from 'vitest';
import { sprlSlots } from './sprl-slots.js';

const KEYS = ['SPRL_USER', 'SPRL_PASS', 'SPRL_USER_2', 'SPRL_PASS_2', 'SPRL_USER_3', 'SPRL_PASS_3'] as const;
function clear() { for (const k of KEYS) delete process.env[k]; }

afterEach(clear);

describe('sprlSlots', () => {
  it('el slot 1 existe SIEMPRE (para el keep-alive del perfil ya logueado, aun sin creds)', () => {
    clear();
    const s = sprlSlots();
    expect(s).toHaveLength(1);
    expect(s[0]!.index).toBe(1);
    expect(s[0]!.port).toBe(9224);
  });

  it('agrega slot 2 y slot 3 solo cuando sus credenciales están configuradas', () => {
    clear();
    process.env.SPRL_USER = 'a'; process.env.SPRL_PASS = 'x';
    process.env.SPRL_USER_2 = 'b'; process.env.SPRL_PASS_2 = 'y';
    process.env.SPRL_USER_3 = 'c'; process.env.SPRL_PASS_3 = 'z';
    const s = sprlSlots();
    expect(s.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it('cada slot usa un puerto DISTINTO; el slot 3 = 9228 (NO 9226/9227, que son de Superbid/ATU/SIGM)', () => {
    clear();
    process.env.SPRL_USER = 'a'; process.env.SPRL_PASS = 'x';
    process.env.SPRL_USER_2 = 'b'; process.env.SPRL_PASS_2 = 'y';
    process.env.SPRL_USER_3 = 'c'; process.env.SPRL_PASS_3 = 'z';
    const ports = sprlSlots().map((x) => x.port);
    expect(ports).toEqual([9224, 9225, 9228]);
    expect(new Set(ports).size).toBe(ports.length); // sin colisiones
    expect(ports).not.toContain(9226); // Superbid/ATU
    expect(ports).not.toContain(9227); // SIGM
  });

  it('cada slot tiene su PROPIO perfil (sesiones que no se pisan)', () => {
    clear();
    process.env.SPRL_USER = 'a'; process.env.SPRL_PASS = 'x';
    process.env.SPRL_USER_2 = 'b'; process.env.SPRL_PASS_2 = 'y';
    process.env.SPRL_USER_3 = 'c'; process.env.SPRL_PASS_3 = 'z';
    const profiles = sprlSlots().map((x) => x.profile);
    expect(new Set(profiles).size).toBe(3);
  });
});
