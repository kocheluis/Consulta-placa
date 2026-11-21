import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'border-transparent bg-primary text-white hover:bg-primary-600',
  accent: 'border-transparent bg-accent text-[#042D29] hover:bg-accent-600',
  secondary: 'border-border bg-surface text-foreground hover:bg-background',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-azul-50',
};
const SIZE: Record<Size, string> = {
  sm: 'gap-1.5 rounded-lg px-3.5 py-2 text-sm',
  md: 'gap-2 rounded-xl px-5 py-3 text-[15px]',
  lg: 'gap-2 rounded-xl px-7 py-4 text-[17px]',
};

function classesFor(variant: Variant, size: Size, block?: boolean): string {
  return [
    // Respuesta al PRESIONAR (no al soltar): se hunde 3 % al instante y vuelve con desaceleración tipo iOS.
    'inline-flex items-center justify-center border font-body font-semibold cursor-pointer select-none',
    'transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]',
    'active:scale-[0.97] active:duration-75 disabled:active:scale-100',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    block ? 'w-full' : '',
  ].join(' ');
}

type Props = {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  block?: boolean;
  href?: string;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  block,
  href,
  className = '',
  ...rest
}: Props) {
  const inner = (
    <>
      {icon && <Icon name={icon} className="text-[1.25em]" />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} className="text-[1.25em]" />}
    </>
  );
  const cls = `${classesFor(variant, size, block)} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {inner}
    </button>
  );
}
