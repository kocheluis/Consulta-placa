/**
 * OCR local del CAPTCHA del JNE: preprocesa (onpe-preprocess) y reconoce con
 * Tesseract limitado a dígitos. Prueba varios modos de segmentación y se queda
 * con la lectura que sea exactamente 6 dígitos (formato del captcha del JNE).
 *
 * Reutiliza un único worker de Tesseract entre llamadas (init cuesta ~1s); llama
 * a close() al terminar. La primera ejecución descarga los datos del idioma.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { clean, binToPng, DEFAULT_OPTS, type PreprocessOptions } from './onpe-preprocess.js';

export interface OnpeOcrResult {
  /** mejor lectura (6 dígitos si se logró; si no, el mejor candidato disponible) */
  code: string;
  /** confianza media de Tesseract del candidato elegido (0–100) */
  confidence: number;
  /** true si `code` tiene exactamente 6 dígitos */
  ok: boolean;
  /** lecturas por cada modo probado, para depurar */
  candidates: Array<{ psm: string; raw: string; digits: string; confidence: number }>;
}

const PSM_MODES: Array<{ label: string; mode: PSM }> = [
  { label: 'SINGLE_WORD', mode: PSM.SINGLE_WORD }, // 8
  { label: 'SINGLE_LINE', mode: PSM.SINGLE_LINE }, // 7
  { label: 'RAW_LINE', mode: PSM.RAW_LINE }, // 13
];

export class OnpeOcr {
  private worker: Worker | null = null;
  constructor(private readonly opts: PreprocessOptions = DEFAULT_OPTS) {}

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    const w = await createWorker('eng');
    await w.setParameters({ tessedit_char_whitelist: '0123456789' });
    this.worker = w;
    return w;
  }

  /** Reconoce el captcha a partir del PNG (Buffer). */
  async recognize(pngBuffer: Buffer): Promise<OnpeOcrResult> {
    const w = await this.ensureWorker();
    const cleaned = clean(pngBuffer, this.opts);
    const cleanedPng = binToPng(cleaned.bin, cleaned.w, cleaned.h);

    const candidates: OnpeOcrResult['candidates'] = [];
    for (const { label, mode } of PSM_MODES) {
      await w.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await w.recognize(cleanedPng);
      const raw = (data.text ?? '').trim();
      const digits = raw.replace(/\D/g, '');
      candidates.push({ psm: label, raw, digits, confidence: data.confidence ?? 0 });
    }

    // Preferencia: candidato de 6 dígitos con mayor confianza; si ninguno, el de
    // mayor confianza entre los que tengan más dígitos.
    const six = candidates.filter((c) => c.digits.length === 6).sort((a, b) => b.confidence - a.confidence);
    const best =
      six[0] ??
      [...candidates].sort((a, b) => b.digits.length - a.digits.length || b.confidence - a.confidence)[0];
    const code = best?.digits ?? '';
    return { code, confidence: best?.confidence ?? 0, ok: code.length === 6, candidates };
  }

  /** Conforma con CaptchaSolver.solveImage (base64 → texto). */
  async solveImage(imageBase64: string): Promise<string> {
    return (await this.recognize(Buffer.from(imageBase64, 'base64'))).code;
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate().catch(() => {});
      this.worker = null;
    }
  }
}
