import type { CaptchaSolver } from './index.js';

const BASE = 'https://api.capsolver.com';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // ~120 s

interface CreateTaskResponse {
  errorId: number;
  errorDescription?: string;
  taskId?: string;
  // ImageToTextTask es SÍNCRONO: la solución llega aquí mismo, sin taskId.
  status?: 'idle' | 'processing' | 'ready' | 'failed';
  solution?: { text?: string };
}
interface TaskResultResponse {
  errorId: number;
  errorDescription?: string;
  status?: 'idle' | 'processing' | 'ready' | 'failed';
  solution?: { text?: string; gRecaptchaResponse?: string; token?: string };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CapSolver HTTP ${res.status}`);
  return (await res.json()) as T;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Implementación del solver usando CapSolver (https://capsolver.com). */
export class CapSolverSolver implements CaptchaSolver {
  constructor(private readonly clientKey: string) {}

  private async createTask(task: Record<string, unknown>): Promise<string> {
    const res = await post<CreateTaskResponse>('/createTask', { clientKey: this.clientKey, task });
    if (res.errorId !== 0 || !res.taskId) {
      throw new Error(`CapSolver createTask: ${res.errorDescription ?? 'sin taskId'}`);
    }
    return res.taskId;
  }

  private async getResult(taskId: string): Promise<TaskResultResponse['solution']> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await wait(POLL_INTERVAL_MS);
      const res = await post<TaskResultResponse>('/getTaskResult', {
        clientKey: this.clientKey,
        taskId,
      });
      if (res.errorId !== 0) throw new Error(`CapSolver getTaskResult: ${res.errorDescription}`);
      if (res.status === 'ready') return res.solution;
      if (res.status === 'failed') throw new Error('CapSolver: tarea fallida');
    }
    throw new Error('CapSolver: timeout esperando la solución');
  }

  async solveRecaptchaV2(sitekey: string, url: string): Promise<string> {
    const taskId = await this.createTask({
      type: 'ReCaptchaV2TaskProxyLess',
      websiteURL: url,
      websiteKey: sitekey,
    });
    const solution = await this.getResult(taskId);
    if (!solution?.gRecaptchaResponse) throw new Error('CapSolver: sin gRecaptchaResponse');
    return solution.gRecaptchaResponse;
  }

  async solveRecaptchaV3(sitekey: string, url: string, action: string): Promise<string> {
    const taskId = await this.createTask({
      type: 'ReCaptchaV3TaskProxyLess',
      websiteURL: url,
      websiteKey: sitekey,
      pageAction: action,
    });
    const solution = await this.getResult(taskId);
    if (!solution?.gRecaptchaResponse) throw new Error('CapSolver: sin gRecaptchaResponse (v3)');
    return solution.gRecaptchaResponse;
  }

  async solveImage(imageBase64: string): Promise<string> {
    // ImageToTextTask responde SÍNCRONO: la solución viene en createTask, no por
    // polling (un getTaskResult posterior da "task data has expired", errorId=1).
    const res = await post<CreateTaskResponse>('/createTask', {
      clientKey: this.clientKey,
      task: { type: 'ImageToTextTask', body: imageBase64 },
    });
    if (res.errorId !== 0) {
      throw new Error(`CapSolver createTask (image): ${res.errorDescription ?? 'error'}`);
    }
    if (res.solution?.text) return res.solution.text;
    // Respaldo: si algún día devolviera taskId (asíncrono), hacemos polling.
    if (res.taskId) {
      const solution = await this.getResult(res.taskId);
      if (solution?.text) return solution.text;
    }
    throw new Error('CapSolver: sin texto');
  }

  async solveTurnstile(sitekey: string, url: string): Promise<string> {
    const taskId = await this.createTask({
      type: 'AntiTurnstileTaskProxyLess',
      websiteURL: url,
      websiteKey: sitekey,
    });
    const solution = await this.getResult(taskId);
    if (!solution?.token) throw new Error('CapSolver: sin token (Turnstile)');
    return solution.token;
  }
}
