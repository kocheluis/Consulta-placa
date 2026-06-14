import type { ReactNode } from 'react';
import { Icon } from './ui/Icon';

type Tone = 'brand' | 'warning' | 'danger' | 'neutral' | 'success';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: 'bg-azul-50', fg: 'text-primary' },
  warning: { bg: 'bg-warning-bg', fg: 'text-warning-fg' },
  danger: { bg: 'bg-danger-bg', fg: 'text-danger-fg' },
  neutral: { bg: 'bg-slate-100', fg: 'text-muted' },
  success: { bg: 'bg-success-bg', fg: 'text-success' },
};

/**
 * Estado de borde reutilizable (vacío / no encontrado / error / offline).
 * Tarjeta centrada con ícono en círculo, título, descripción y acciones.
 */
export function StateScreen({
  tone = 'neutral',
  icon,
  title,
  description,
  children,
  footer,
}: {
  tone?: Tone;
  icon: string;
  title: string;
  description: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-surface text-center shadow-sm">
      <div className="px-6 py-12 sm:px-10">
        <div className={`mx-auto mb-5 grid h-[84px] w-[84px] place-items-center rounded-full ${t.bg}`}>
          <Icon name={icon} className={`text-[46px] ${t.fg}`} />
        </div>
        <h2 className="font-heading text-[26px] font-extrabold tracking-tight text-foreground">{title}</h2>
        <p className="mx-auto mb-6 mt-3 max-w-md text-base leading-relaxed text-muted">{description}</p>
        {children}
        {footer && <div className="mt-5 font-mono text-[12.5px] text-slate-400">{footer}</div>}
      </div>
    </div>
  );
}
