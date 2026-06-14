import type { ReactNode } from 'react';

export function Tag({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'source';
}) {
  if (variant === 'source') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-azul-200 bg-azul-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-azul-700">
        {children}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-slate-100 px-2.5 py-1 font-body text-xs font-semibold text-slate-700">
      {children}
    </span>
  );
}
