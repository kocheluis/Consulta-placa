'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  /** Material Symbol a la izquierda. */
  icon?: string;
  /** Texto de ayuda bajo el campo. */
  hint?: string;
  /** Mensaje de error (reemplaza al hint y marca el borde). */
  error?: string;
};

/**
 * Campo de formulario del design system: label + ícono opcional.
 * Si `type="password"`, muestra automáticamente un toggle de visibilidad.
 */
export function Input({
  label,
  icon,
  hint,
  error,
  type = 'text',
  id,
  className = '',
  ...rest
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block font-body text-sm font-semibold text-foreground">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <Icon
            name={icon}
            className="pointer-events-none absolute left-3 text-[20px] text-muted"
          />
        )}
        <input
          id={inputId}
          type={inputType}
          aria-invalid={error ? true : undefined}
          className={[
            'w-full rounded-md border bg-surface py-3 font-body text-[15px] text-foreground',
            'placeholder:text-slate-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent/30',
            error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent',
            icon ? 'pl-11' : 'pl-4',
            isPassword ? 'pr-11' : 'pr-4',
          ].join(' ')}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
          >
            <Icon name={show ? 'visibility_off' : 'visibility'} className="text-[20px]" />
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-1.5 font-body text-xs font-medium text-danger-fg" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 font-body text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
