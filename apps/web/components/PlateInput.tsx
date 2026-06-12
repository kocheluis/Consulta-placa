'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { isValidPlate, formatPlateDisplay, normalizePlate } from '@app/shared';

/** Buscador de placa con validación en cliente (FR-002). */
export function PlateInput() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizePlate(value);
    if (!isValidPlate(normalized)) {
      setError('Ingresa una placa peruana válida (ej. ABC-123).');
      return;
    }
    setError(null);
    router.push(`/reporte/${normalized}`);
  };

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label htmlFor="placa" className="sr-only">
        Número de placa
      </label>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          id="placa"
          name="placa"
          inputMode="text"
          autoComplete="off"
          placeholder="ABC-123"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-lg font-mono tracking-wider uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? 'placa-error' : undefined}
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
          Consultar
        </button>
      </div>
      {error && (
        <p id="placa-error" className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {value && isValidPlate(value) && (
        <p className="mt-2 text-sm text-muted">
          Consultarás: <span className="font-mono">{formatPlateDisplay(value)}</span>
        </p>
      )}
    </form>
  );
}
