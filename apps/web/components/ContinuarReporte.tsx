'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { takeNext } from '@/lib/next-path';

/** Tras confirmar el correo: si la persona venía de consultar una placa, la devuelve a ese reporte. */
export function ContinuarReporte() {
  const [dest, setDest] = useState<string | null>(null);
  useEffect(() => { setDest(takeNext()); }, []);
  if (!dest) return null;
  return (
    <Button variant="accent" size="lg" href={dest} iconRight="arrow_forward">
      Continuar a mi reporte
    </Button>
  );
}
