import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
type Size = 'sm' | 'md';

const TONE: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg border-success/25',
  warning: 'bg-warning-bg text-warning-fg border-warning/30',
  danger: 'bg-danger-bg text-danger-fg border-danger/25',
  info: 'bg-azul-50 text-azul-700 border-azul-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  brand: 'bg-azul-50 text-azul-700 border-azul-200',
};
const SIZE: Record<Size, string> = {
  sm: 'gap-1 px-2.5 py-1 text-[11px]',
  md: 'gap-1.5 px-3 py-1.5 text-[13px]',
};
const DEFAULT_ICON: Record<Tone, string | undefined> = {
  success: 'check_circle',
  warning: 'error',
  danger: 'cancel',
  info: 'info',
  neutral: undefined,
  brand: undefined,
};

export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  /** `undefined` = ícono por defecto del tono; `null` = sin ícono. */
  icon?: string | null;
}) {
  const ic = icon === undefined ? DEFAULT_ICON[tone] : (icon ?? undefined);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-body font-semibold leading-none ${TONE[tone]} ${SIZE[size]}`}
    >
      {ic && <Icon name={ic} className="text-[1.05em]" />}
      {children}
    </span>
  );
}
