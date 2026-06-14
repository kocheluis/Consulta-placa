'use client';

import { useId } from 'react';

type Size = 'md' | 'lg';

const SIZE: Record<Size, { input: string; pe: string; sub: string }> = {
  md: { input: 'w-[150px] text-xl', pe: 'text-[14px]', sub: 'text-[8px]' },
  lg: { input: 'w-[180px] text-2xl', pe: 'text-[15px]', sub: 'text-[9px]' },
};

/** Input con estética de placa peruana (bloque "PE · PERÚ" + campo monoespaciado). */
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
  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="inline-flex items-stretch overflow-hidden rounded-xl border-2 border-slate-800 bg-white font-mono shadow-sm focus-within:border-accent">
        <div className={`flex flex-col items-center justify-center bg-primary px-3 font-body font-bold text-white ${s.pe}`}>
          <span>PE</span>
          <span className={`opacity-80 ${s.sub}`}>PERÚ</span>
        </div>
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
          placeholder="ABC-123"
          maxLength={7}
          autoCapitalize="characters"
          aria-label={label}
          className={`min-w-0 bg-transparent px-4 text-center font-bold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-slate-300 ${s.input}`}
        />
      </div>
    </>
  );
}
