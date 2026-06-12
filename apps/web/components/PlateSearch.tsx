'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { isValidPlate, formatPlateDisplay, normalizePlate } from '@app/shared';

/** Buscador con dos modos: consulta guiada (gratis) y reporte automático (PRO). */
export function PlateSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = (base: string) => {
    const normalized = normalizePlate(value);
    if (!isValidPlate(normalized)) {
      setError('Ingresa una placa peruana válida (ej. ABC-123).');
      return;
    }
    setError(null);
    router.push(`${base}/${normalized}`);
  };

  return (
    <div className="w-full">
      <label htmlFor="placa" className="sr-only">
        Número de placa
      </label>
      <input
        id="placa"
        inputMode="text"
        autoComplete="off"
        placeholder="ABC-123"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go('/guiada')}
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg font-mono tracking-wider uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? 'placa-error' : undefined}
      />
      {error && (
        <p id="placa-error" className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {value && isValidPlate(value) && (
        <p className="mt-2 text-sm text-muted">
          Placa: <span className="font-mono">{formatPlateDisplay(value)}</span>
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => go('/guiada')}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
          Consulta guiada · Gratis
        </button>
        <button
          onClick={() => go('/reporte')}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary bg-surface px-5 py-3 font-medium text-primary transition-colors duration-200 hover:bg-background cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <Sparkles className="h-5 w-5" aria-hidden="true" />
          Reporte automático · PRO
        </button>
      </div>
    </div>
  );
}
