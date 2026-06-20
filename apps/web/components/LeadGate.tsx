'use client';

import { useState, type FormEvent } from 'react';
import { formatPlateDisplay } from '@app/shared';
import { Icon } from './ui/Icon';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { submitLead, storeLead } from '@/lib/lead';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pantalla intermedia (lead gate). Aparece tras pedir una placa: el reporte se
 * genera en segundo plano mientras el usuario deja su contacto. Al enviar, guarda
 * el lead, dispara el correo con el reporte y desbloquea la vista (`onUnlock`).
 *
 * `ready` indica que el reporte ya terminó de cargar en background (cambia el copy
 * a "listo"); el desbloqueo igual exige el contacto (captura obligatoria).
 */
export function LeadGate({
  placa,
  ready,
  onUnlock,
}: {
  placa: string;
  ready: boolean;
  onUnlock: () => void;
}) {
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Ingresa un correo válido para enviarte el reporte.');
      return;
    }
    setSubmitting(true);
    const res = await submitLead(placa, email.trim(), whatsapp.trim() || undefined);
    if (!res.ok) {
      setError(res.error ?? 'No se pudo registrar. Intenta de nuevo.');
      setSubmitting(false);
      return;
    }
    storeLead(email.trim(), whatsapp.trim() || undefined);
    onUnlock();
  };

  return (
    <div className="bg-background px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {/* Cabecera: placa + estado de la carga en background */}
        <div className="border-b border-border bg-azul-50 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-2 font-mono text-sm font-bold tracking-wide text-primary">
            <Icon name="directions_car" className="text-[20px]" />
            {formatPlateDisplay(placa)}
          </div>
          <div className="mt-2 flex items-center gap-2" aria-live="polite">
            {ready ? (
              <>
                <Icon name="check_circle" fill className="text-[18px] text-success" />
                <span className="font-body text-sm font-semibold text-success">¡Tu reporte ya está listo!</span>
              </>
            ) : (
              <>
                <Icon name="progress_activity" className="animate-spin text-[18px] text-primary" />
                <span className="font-body text-sm text-azul-700">Consultando SUNARP · SOAT · papeletas…</span>
              </>
            )}
          </div>
        </div>

        {/* Cuerpo: copy + formulario de contacto */}
        <form onSubmit={onSubmit} className="px-6 py-6 sm:px-8" noValidate>
          <h1 className="font-heading text-[22px] font-extrabold tracking-tight text-foreground">
            {ready ? 'Tu reporte está listo' : 'Estamos preparando tu reporte'}
          </h1>
          <p className="mt-2 font-body text-[15px] leading-relaxed text-muted">
            Déjanos tu correo para enviarte el reporte y verlo ahora mismo.
          </p>

          <div className="mt-5 flex flex-col gap-4">
            <Input
              label="Correo electrónico"
              type="email"
              icon="mail"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              placeholder="tucorreo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="WhatsApp (opcional)"
              type="tel"
              icon="chat"
              autoComplete="tel"
              inputMode="tel"
              placeholder="9XX XXX XXX"
              hint="Para avisarte de novedades. No enviamos spam."
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 font-body text-[13px] text-danger-fg"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            block
            size="lg"
            className="mt-6"
            iconRight="arrow_forward"
            disabled={submitting}
          >
            {submitting ? 'Generando…' : 'Ver mi reporte'}
          </Button>

          <p className="mt-4 flex items-start gap-1.5 font-body text-[12.5px] leading-snug text-slate-400">
            <Icon name="lock" className="mt-0.5 flex-none text-[14px]" />
            <span>
              Tus datos están seguros: solo los usamos para enviarte tu reporte. Lee nuestra{' '}
              <a href="/legal/privacidad" className="text-primary hover:underline">
                política de privacidad
              </a>
              .
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}
