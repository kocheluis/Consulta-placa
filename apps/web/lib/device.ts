'use client';

/**
 * Señales del DISPOSITIVO para la prueba gratis del reporte Completo (1 por dispositivo, no solo por
 * cuenta): evita crear muchas cuentas en el mismo equipo para repetirla. Dos señales del navegador:
 *   · localId → id aleatorio persistido en localStorage (sobrevive si solo se borran las cookies).
 *   · fp      → huella: SHA-256 de rasgos estables del equipo (pantalla, zona horaria, idioma, núcleos,
 *               GPU y cómo dibuja un canvas). Cambia poco entre modo normal e incógnito.
 * El servidor suma una tercera (cookie httpOnly `pp_dev`). Solo viajan hashes/ids, no los rasgos.
 */
const KEY = 'placape_device';

function localId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

function canvasSig(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const g = c.getContext('2d');
    if (!g) return '';
    g.textBaseline = 'top';
    g.font = '16px Arial';
    g.fillStyle = '#0d786c';
    g.fillRect(10, 10, 100, 30);
    g.fillStyle = '#f0a91c';
    g.fillText('PlacaPe ABC-123 ñ', 4, 18);
    return c.toDataURL();
  } catch {
    return '';
  }
}

function gpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : '';
  } catch {
    return '';
  }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deviceSignals(): Promise<{ localId: string; fp: string }> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const traits = [
    nav.userAgent, nav.platform, nav.language, (nav.languages ?? []).join(','),
    `${screen.width}x${screen.height}x${screen.colorDepth}`, String(window.devicePixelRatio),
    Intl.DateTimeFormat().resolvedOptions().timeZone, String(nav.hardwareConcurrency ?? ''), String(nav.deviceMemory ?? ''),
    String(nav.maxTouchPoints ?? ''), gpu(), canvasSig(),
  ].join('||');
  let fp = '';
  try { fp = await sha256(traits); } catch { /* sin crypto.subtle → solo localId + cookie */ }
  return { localId: localId(), fp };
}
