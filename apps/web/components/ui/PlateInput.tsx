'use client';

import { useId } from 'react';
import { Icon } from './Icon';
import { typePlate } from '@/lib/plate-typing';

type Size = 'md' | 'lg';

const SIZE: Record<Size, { input: string; pe: string; sub: string }> = {
  md: { input: 'w-[150px] text-xl', pe: 'text-[14px]', sub: 'text-[8px]' },
  lg: { input: 'w-[180px] text-2xl', pe: 'text-[15px]', sub: 'text-[9px]' },
};

/**
 * Input con estética de placa peruana (bloque "PE · PERÚ" + campo monoespaciado). Formatea al escribir
 * (guion automático) y muestra check + borde teal cuando la placa es válida. `onChange` recibe el texto
 * con guion; los llamadores normalizan con `normalizePlate` antes de usarlo.
 */
export function PlateInput({
  value,
  onChange,
  onEnter,
  size = 'md',
  label = 'Placa del vehículo',
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  size?: Size;
  label?: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const s = SIZE[size];
  const plate = typePlate(value);
  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div
        className={`inline-flex items-stretch overflow-hidden rounded-xl border-2 bg-white font-mono shadow-sm transition-colors duration-200 ${
          plate.valid ? 'border-accent' : 'border-slate-800 focus-within:border-accent'
        }`}
      >
        <div className={`flex flex-col items-center justify-center bg-primary px-3 font-body font-bold text-white ${s.pe}`}>
          <span>PE</span>
          <span className={`opacity-80 ${s.sub}`}>PERÚ</span>
        </div>
        <input
          id={inputId}
          value={plate.display}
          onChange={(e) => onChange(typePlate(e.target.value).display)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
          placeholder="ABC-123"
          maxLength={7}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label={label}
          className={`min-w-0 bg-transparent pl-4 text-center font-bold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-slate-300 ${s.input}`}
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
    </>
  );
}
