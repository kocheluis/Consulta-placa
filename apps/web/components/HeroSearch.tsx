'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { typePlate } from '@/lib/plate-typing';

/**
 * Buscador del hero: placa estilo placa peruana. Navega por defecto al reporte
 * (`/reporte/[placa]`); con `to` se reutiliza para otros destinos (p. ej. `/guiada`).
 *
 * Validación EN LÍNEA (regla de Apple): guion automático, check + borde teal cuando la placa está
 * completa, pista neutra mientras escribe; al enviar una placa incompleta, el campo se sacude y el
 * mensaje pasa a error.
 */
export function HeroSearch({ to = '/reporte', cta = 'Verificar placa' }: { to?: string; cta?: string } = {}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [going, setGoing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const plate = typePlate(value);

  const go = () => {
    if (!plate.valid) {
      setError(true);
      const el = boxRef.current;
      if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.classList.remove('pp-nudge');
        void el.offsetWidth; // reinicia la animación
        el.classList.add('pp-nudge');
      }
      el?.querySelector('input')?.focus();
      return;
    }
    setError(false);
    setGoing(true);
    router.push(`${to}/${plate.normalized}`);
  };

  const hint = error
    ? 'Revisa la placa: 3 letras o números y 3 números (ej. ABC-123).'
    : plate.valid
      ? null
      : value
        ? 'Ej. ABC-123 · A1B-234 · motos ABC-12'
        : null;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-stretch justify-center gap-3">
        <label htmlFor="hero-placa" className="sr-only">
          Placa del vehículo
        </label>
        <div
          ref={boxRef}
          className={`inline-flex items-stretch overflow-hidden rounded-xl border-2 bg-white font-mono shadow-sm transition-colors duration-200 ${
            error ? 'border-danger' : plate.valid ? 'border-accent' : 'border-slate-800 focus-within:border-accent'
          }`}
        >
          <div className="flex flex-col items-center justify-center bg-primary px-3 font-body font-bold text-white">
            <span className="text-[15px]">PE</span>
            <span className="text-[9px] opacity-80">PERÚ</span>
          </div>
          <input
            id="hero-placa"
            value={plate.display}
            onChange={(e) => { setValue(e.target.value); if (error) setError(false); }}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="ABC-123"
            maxLength={7}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label="Placa del vehículo"
            aria-invalid={error || undefined}
            aria-describedby="hero-placa-hint"
            className="w-[160px] min-w-0 bg-transparent pl-4 text-center text-2xl font-bold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-slate-300"
          />
          <span
            aria-hidden
            className={`grid w-9 place-items-center text-success transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              plate.valid ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            }`}
          >
            <Icon name="check_circle" fill className="text-[22px]" />
          </span>
        </div>
        <Button variant="accent" size="lg" iconRight={going ? undefined : 'arrow_forward'} onClick={go} disabled={going}>
          {going ? 'Abriendo…' : cta}
        </Button>
      </div>
      <p
        id="hero-placa-hint"
        role="status"
        className={`mt-3 min-h-[20px] text-center text-sm transition-colors ${error ? 'text-danger' : 'text-muted'}`}
      >
        {hint}
      </p>
    </div>
  );
}
