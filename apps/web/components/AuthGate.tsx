'use client';

import { formatPlateDisplay } from '@app/shared';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';
import { rememberNext } from '@/lib/next-path';

/**
 * Pantalla de acceso obligatorio: toda consulta nueva requiere una cuenta (reemplaza al lead gate de
 * correo + WhatsApp). Al iniciar sesión o crear la cuenta, /cuenta devuelve a la persona a este reporte.
 */
export function AuthGate({ placa }: { placa: string }) {
  const next = `/reporte/${encodeURIComponent(placa)}`;
  const href = (view?: 'register') => `/cuenta?next=${encodeURIComponent(next)}${view ? `&view=${view}` : ''}`;
  return (
    <div className="bg-background px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border bg-azul-50 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-2 font-mono text-sm font-bold tracking-wide text-primary">
            <Icon name="directions_car" className="text-[20px]" />
            {formatPlateDisplay(placa)}
          </div>
        </div>
        <div className="flex flex-col gap-5 px-6 py-7 sm:px-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-xl font-bold text-foreground">Ingresa para ver tu reporte</h1>
            <p className="font-body text-sm leading-relaxed text-muted">
              Para consultar una placa necesitas una cuenta PlacaPe. Es gratis: así guardamos tus consultas y te
              avisamos por correo cuando tu reporte esté listo.
            </p>
          </div>
          <div className="flex flex-col gap-3" onClickCapture={() => rememberNext(next)}>
            <Button variant="accent" size="lg" href={href('register')} icon="person_add">
              Crear cuenta gratis
            </Button>
            <Button variant="secondary" size="lg" href={href()} icon="login">
              Ya tengo cuenta — Iniciar sesión
            </Button>
          </div>
          <p className="flex items-start gap-1.5 font-body text-[12px] leading-snug text-muted">
            <Icon name="lock" className="mt-px text-[14px]" />
            Puedes entrar con tu correo, Google o Facebook. Al terminar vuelves directo a esta placa.
          </p>
        </div>
      </div>
    </div>
  );
}
