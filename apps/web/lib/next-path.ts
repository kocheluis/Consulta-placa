/**
 * A dónde volver tras iniciar sesión / crear cuenta (p. ej. el reporte de la placa que se quería
 * consultar). Se valida que sea una ruta INTERNA (empieza con "/" y no con "//") para no abrir un
 * redirect a otro dominio. Se recuerda en localStorage porque la confirmación por correo o el login
 * con Google pasan por otras páginas antes de volver.
 */
const KEY = 'placape_next';

export function safeNext(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim();
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : null;
}

export function rememberNext(path: string | null): void {
  const p = safeNext(path);
  if (!p) return;
  try { localStorage.setItem(KEY, p); } catch { /* sin storage → solo se pierde el regreso automático */ }
}

/** Devuelve (y borra) el destino recordado. */
export function takeNext(): string | null {
  try {
    const p = safeNext(localStorage.getItem(KEY));
    localStorage.removeItem(KEY);
    return p;
  } catch { return null; }
}
