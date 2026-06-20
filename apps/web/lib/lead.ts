/**
 * Captura de contacto (lead gate) — lado cliente. Envía el contacto a /api/lead y
 * recuerda en localStorage que este navegador ya dejó sus datos, para no volver a
 * pedirlos en cada consulta.
 */

const KEY = 'placape:lead';

export interface StoredLead {
  email: string;
  whatsapp?: string;
  at: string;
}

/** Contacto ya capturado en este navegador (o null si aún no). */
export function getStoredLead(): StoredLead | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredLead) : null;
  } catch {
    return null;
  }
}

/** Guarda el contacto localmente para saltar la pantalla en futuras consultas. */
export function storeLead(email: string, whatsapp?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ email, whatsapp, at: new Date().toISOString() }));
  } catch {
    /* almacenamiento no disponible (modo privado): no es crítico */
  }
}

export interface SubmitLeadResult {
  ok: boolean;
  error?: string;
}

/** Registra el contacto en el servidor (guarda lead + dispara el correo). */
export async function submitLead(plate: string, email: string, whatsapp?: string): Promise<SubmitLeadResult> {
  try {
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate, email, whatsapp: whatsapp || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? 'No se pudo registrar. Intenta de nuevo.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.' };
  }
}
