'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/**
 * Menú móvil (hamburguesa). En pantallas < sm el <nav> del header está oculto.
 *
 * Se renderiza en un PORTAL sobre <body>: el header usa `backdrop-filter`, y eso convierte al header en
 * el bloque contenedor de sus hijos `position: fixed` → el menú quedaba atrapado en los 57 px de la barra,
 * transparente, con los enlaces encima del hero (bug visto en producción, nov-2026).
 *
 * Reglas de Apple aplicadas:
 *  - Sale desde el lado del botón ☰ (derecha) y se va por el mismo camino.
 *  - Velo que oscurece el fondo (tarea modal).
 *  - Arrastre 1:1 para cerrar, con histéresis, rubber-band hacia la izquierda y proyección del impulso al
 *    soltar (decide abrir/cerrar según dónde TERMINARÍA el gesto, no dónde se soltó).
 *  - Interrumpible: la transición CSS parte del valor actual.
 */
export function MobileMenu({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x0: number; w: number; dx: number; moved: boolean; hist: { x: number; t: number }[] } | null>(null);

  useEffect(() => setMounted(true), []);

  // Abierto: bloquea el scroll del fondo, cierra con Escape y mueve el foco a la hoja.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const setLive = (dx: number | null, w = 1) => {
    const sheet = sheetRef.current, scrim = scrimRef.current;
    if (!sheet || !scrim) return;
    sheet.style.transition = dx == null ? '' : 'none';
    scrim.style.transition = dx == null ? '' : 'none';
    sheet.style.transform = dx == null ? '' : `translateX(${dx}px)`;
    scrim.style.opacity = dx == null ? '' : String(Math.max(0, 1 - Math.max(0, dx) / w));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    drag.current = { x0: e.clientX, w: e.currentTarget.offsetWidth, dx: 0, moved: false, hist: [{ x: e.clientX, t: e.timeStamp }] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientX - d.x0;
    if (!d.moved && Math.abs(raw) < 8) return; // histéresis antes de comprometer la dirección
    d.moved = true;
    // Hacia la derecha sigue al dedo 1:1; hacia la izquierda resiste (rubber-band, no hay más hoja).
    d.dx = raw >= 0 ? raw : (raw * d.w * 0.55) / (d.w + 0.55 * Math.abs(raw));
    setLive(d.dx, d.w);
    d.hist.push({ x: e.clientX, t: e.timeStamp });
    if (d.hist.length > 5) d.hist.shift();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const a = d.hist[0]!, b = d.hist[d.hist.length - 1]!;
    const v = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0; // px/s
    const projected = d.dx + (v / 1000) * 0.998 / (1 - 0.998); // proyección de Apple (decaimiento exponencial)
    setLive(null);
    if (projected > d.w / 2) setOpen(false);
  };

  const sheet = (
    <div className="sm:hidden" aria-hidden={!open}>
      <div
        ref={scrimRef}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-50 bg-azul-950/40 transition-opacity duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        inert={!open || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`pp-glass fixed inset-y-0 right-0 z-50 flex w-[84%] max-w-[360px] touch-pan-y flex-col border-l border-white/60 bg-white/90 shadow-[-18px_0_40px_rgba(7,34,46,0.18)] backdrop-blur-2xl backdrop-saturate-[1.7] transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity ${open ? 'translate-x-0' : 'translate-x-[calc(100%+64px)]'}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <span aria-hidden className="absolute left-2 top-1/2 h-11 w-1 -translate-y-1/2 rounded-full bg-slate-300" />
        <div className="flex items-center justify-between py-3.5 pl-7 pr-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-placape.svg" alt="PlacaPe" className="h-8 w-auto" />
          <button
            ref={closeRef}
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-foreground transition-transform active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Icon name="close" className="text-[22px]" />
          </button>
        </div>
        <nav aria-label="Navegación principal" className="flex flex-col gap-0.5 px-4 py-2">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3.5 py-3 font-body text-[17px] font-semibold text-foreground transition-colors active:bg-azul-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-5 pb-6" onClick={() => setOpen(false)}>
          <Button variant="accent" size="md" iconRight="arrow_forward" href="/" block>
            Verificar placa
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-border text-foreground transition-transform hover:bg-azul-50 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Icon name="menu" className="text-[22px]" />
      </button>
      {mounted && createPortal(sheet, document.body)}
    </div>
  );
}
