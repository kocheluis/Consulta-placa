'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isValidPlate, normalizePlate } from '@app/shared';
import { Button } from './ui/Button';

/** Buscador del hero: placa estilo placa peruana + "Verificar placa". */
export function HeroSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    const normalized = normalizePlate(value);
    if (!isValidPlate(normalized)) {
      setError('Ingresa una placa peruana válida (ej. ABC-123).');
      return;
    }
    setError(null);
    router.push(`/guiada/${normalized}`);
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-stretch justify-center gap-3">
        <label htmlFor="hero-placa" className="sr-only">
          Placa del vehículo
        </label>
        <div className="inline-flex items-stretch overflow-hidden rounded-xl border-2 border-slate-800 bg-white font-mono shadow-sm focus-within:border-accent">
          <div className="flex flex-col items-center justify-center bg-primary px-3 font-body font-bold text-white">
            <span className="text-[15px]">PE</span>
            <span className="text-[9px] opacity-80">PERÚ</span>
          </div>
          <input
            id="hero-placa"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="ABC-123"
            maxLength={7}
            autoCapitalize="characters"
            aria-label="Placa del vehículo"
            className="w-[160px] min-w-0 bg-transparent px-4 text-center text-2xl font-bold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-slate-300"
          />
        </div>
        <Button variant="accent" size="lg" iconRight="arrow_forward" onClick={go}>
          Verificar placa
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-center text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
