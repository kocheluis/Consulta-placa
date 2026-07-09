import { describe, it, expect } from 'vitest';
import { runLightLane, type LaneBrowser, type LightRunner } from './source-lane.js';
import type { CaptchaSolver } from '../captcha/index.js';
import type { Page } from 'playwright';

const fakePage = () => ({ close: async () => {} }) as unknown as Page;
const noopSolver = {} as CaptchaSolver;
const items = (plates: string[]) => plates.map((plate) => ({ plate, outDir: '/tmp' }));
const okRunner: LightRunner = async (_p, plate) =>
  ({ source: 'X', label: 'x', category: 'OTRO', status: 'ENCONTRADO', summary: `ok ${plate}`, ms: 1 });

describe('runLightLane', () => {
  it('reúsa el navegador (1 open/close) y una página por placa en el mismo contexto', async () => {
    let opens = 0, closes = 0, pages = 0;
    const launchBrowser = async (): Promise<LaneBrowser> => {
      opens++;
      return { ctx: { newPage: async () => { pages++; return fakePage(); } }, close: async () => { closes++; } };
    };
    const res = await runLightLane('sat', okRunner, items(['P1', 'P2', 'P3']), { captchaApiKey: '', launchBrowser, solver: noopSolver });
    expect(res.size).toBe(3);
    expect(opens).toBe(1); // navegador reusado, NO uno por placa
    expect(closes).toBe(1);
    expect(pages).toBe(3); // 1 página por placa, mismo contexto (sesión persiste)
    expect([...res.values()].every((r) => r.result.status === 'ENCONTRADO')).toBe(true);
  });

  it('un error en una placa no aborta el resto del lote', async () => {
    const runner: LightRunner = async (_p, plate) => {
      if (plate === 'P2') throw new Error('boom');
      return { source: 'X', label: 'x', category: 'OTRO', status: 'ENCONTRADO', summary: 'ok', ms: 1 };
    };
    const launchBrowser = async (): Promise<LaneBrowser> => ({ ctx: { newPage: async () => fakePage() }, close: async () => {} });
    const res = await runLightLane('sat', runner, items(['P1', 'P2', 'P3']), { captchaApiKey: '', launchBrowser, solver: noopSolver });
    expect(res.size).toBe(3);
    expect(res.get('P2')?.result.status).toBe('ERROR');
    expect(res.get('P1')?.result.status).toBe('ENCONTRADO');
    expect(res.get('P3')?.result.status).toBe('ENCONTRADO');
  });

  it('lote vacío → mapa vacío sin abrir navegador', async () => {
    let opens = 0;
    const res = await runLightLane('sat', okRunner, [], {
      captchaApiKey: '', solver: noopSolver,
      launchBrowser: async () => { opens++; return { ctx: { newPage: async () => fakePage() }, close: async () => {} }; },
    });
    expect(res.size).toBe(0);
    expect(opens).toBe(0);
  });
});
