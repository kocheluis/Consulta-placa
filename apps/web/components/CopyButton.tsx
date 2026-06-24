'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Botón que copia un texto (p. ej. la placa) al portapapeles, con feedback. */
export function CopyButton({
  text,
  label = 'Copiar placa',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard no disponible */
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm font-semibold text-foreground transition-colors hover:bg-background cursor-pointer ${className}`}
      aria-label={label}
    >
      <Icon name={copied ? 'check' : 'content_copy'} className="text-[16px] text-teal-700" />
      {copied ? 'Copiada' : label}
    </button>
  );
}
