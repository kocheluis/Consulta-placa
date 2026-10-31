import { describe, it, expect } from 'vitest';
import { cleanMtcCaptcha } from './sources.js';
describe('cleanMtcCaptcha (captcha MTC = 6 dígitos)', () => {
  it('solo envía lecturas de exactamente 6 dígitos', () => {
    expect(cleanMtcCaptcha('035363')).toBe('035363');
    expect(cleanMtcCaptcha(' 03 5363 ')).toBe('035363');
    expect(cleanMtcCaptcha('51544')).toBe('');
    expect(cleanMtcCaptcha('O35363')).toBe('');
  });
});
