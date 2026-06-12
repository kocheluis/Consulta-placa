import type { CaptchaSolver } from './index.js';

const IN = 'https://2captcha.com/in.php';
const RES = 'https://2captcha.com/res.php';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // ~120 s

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Implementación del solver usando 2Captcha (https://2captcha.com). */
export class TwoCaptchaSolver implements CaptchaSolver {
  constructor(private readonly apiKey: string) {}

  private async submit(params: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({ key: this.apiKey, json: '1', ...params });
    const res = await fetch(IN, { method: 'POST', body });
    const data = (await res.json()) as { status: number; request: string };
    if (data.status !== 1) throw new Error(`2Captcha in: ${data.request}`);
    return data.request; // captchaId
  }

  private async poll(captchaId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await wait(POLL_INTERVAL_MS);
      const url = `${RES}?key=${this.apiKey}&action=get&id=${captchaId}&json=1`;
      const res = await fetch(url);
      const data = (await res.json()) as { status: number; request: string };
      if (data.status === 1) return data.request; // token/texto
      if (data.request !== 'CAPCHA_NOT_READY') throw new Error(`2Captcha res: ${data.request}`);
    }
    throw new Error('2Captcha: timeout esperando la solución');
  }

  async solveRecaptchaV2(sitekey: string, url: string): Promise<string> {
    const id = await this.submit({ method: 'userrecaptcha', googlekey: sitekey, pageurl: url });
    return this.poll(id);
  }

  async solveImage(imageBase64: string): Promise<string> {
    const id = await this.submit({ method: 'base64', body: imageBase64 });
    return this.poll(id);
  }
}
