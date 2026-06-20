import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { sendEmail } from '@/lib/email';
import { reportReadyEmail } from '@/lib/email-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Captura de contacto de la pantalla intermedia del reporte (lead gate).
 * Guarda el lead (Supabase service_role) y envía el reporte por correo. Tolerante:
 * un fallo al guardar o enviar no rompe el desbloqueo del reporte en el front.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    plate?: string;
    email?: string;
    whatsapp?: string;
  };
  const plate = String(body.plate ?? '').toUpperCase().trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const whatsapp = body.whatsapp ? String(body.whatsapp).trim().slice(0, 24) : null;

  if (!plate) return NextResponse.json({ error: 'Falta la placa.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Ingresa un correo válido.' }, { status: 400 });
  }

  // Asocia el lead al usuario si hay sesión (opcional).
  let userId: string | null = null;
  if (isSupabaseConfigured) {
    try {
      const sb = await createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      /* sin sesión: lead anónimo */
    }
  }

  // 1) Guardar el lead (si el admin está configurado). No bloquea la UX si falla.
  if (isAdminConfigured) {
    try {
      const admin = createAdminClient();
      await admin.from('leads').insert({ plate, email, whatsapp, source: 'report_gate', user_id: userId });
    } catch {
      /* no romper por un fallo de registro */
    }
  }

  // 2) Enviar el reporte por correo (enlace). sendEmail nunca lanza; si falta
  //    RESEND_API_KEY devuelve {skipped:true} y seguimos.
  const reportUrl = `${SITE_URL}/reporte/${encodeURIComponent(plate)}`;
  const { subject, html } = reportReadyEmail({ plate, reportUrl });
  const mail = await sendEmail({ to: email, subject, html });

  return NextResponse.json({ ok: true, emailed: mail.ok });
}
