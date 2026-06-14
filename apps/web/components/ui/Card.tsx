import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Elevation = 'sm' | 'flat' | 'raised';

export function Card({
  children,
  title,
  icon,
  action,
  elevation = 'sm',
  padded,
  interactive,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  icon?: string;
  action?: ReactNode;
  elevation?: Elevation;
  padded?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const elev =
    elevation === 'raised'
      ? 'shadow-md border-transparent'
      : elevation === 'flat'
        ? 'shadow-none'
        : 'shadow-sm';
  const inter = interactive
    ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-azul-200 hover:shadow-lg'
    : '';
  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-surface ${elev} ${inter} ${className}`}>
      {title ? (
        <>
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            {icon && <Icon name={icon} className="text-primary" />}
            <h3 className="flex-1 font-heading text-base font-bold text-foreground">{title}</h3>
            {action}
          </div>
          <div className="p-5">{children}</div>
        </>
      ) : padded ? (
        <div className="p-5">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
