'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/**
 * Menú móvil (hamburguesa) de la barra superior. En pantallas < sm el <nav> del header
 * está oculto (`hidden sm:flex`) y NO había forma de llegar a las secciones ni al CTA
 * desde el celular. Este componente abre una hoja a pantalla completa con los enlaces
 * de navegación + "Verificar placa". La sesión (Iniciar sesión / chip) sigue visible en
 * la barra vía <HeaderAccount>, así que aquí solo van la navegación y el CTA.
 */
export function MobileMenu({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);

  // Mientras la hoja está abierta: bloquea el scroll del fondo y cierra con Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-border text-foreground hover:bg-azul-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Icon name="menu" className="text-[22px]" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-placape.svg" alt="PlacaPe" className="h-8 w-auto" />
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-foreground hover:bg-azul-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <Icon name="close" className="text-[22px]" />
            </button>
          </div>
          <nav aria-label="Navegación principal" className="flex flex-col gap-1 px-6 py-4">
            {links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 font-body text-[16px] font-medium text-slate-700 hover:bg-azul-50 hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3" onClick={() => setOpen(false)}>
              <Button variant="accent" size="md" iconRight="arrow_forward" href="/" block>
                Verificar placa
              </Button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
