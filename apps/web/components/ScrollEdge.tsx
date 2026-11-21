'use client';

import { useEffect } from 'react';

/**
 * Comportamientos globales de interfaz, sin UI propia:
 *  - Marca `html[data-scrolled]` cuando el contenido pasa bajo la barra superior → la barra muestra su
 *    borde/sombra solo entonces (efecto de borde de Apple, en vez de una línea fija).
 *  - Registra un `touchstart` pasivo: Safari iOS no aplica `:active` sin él, y los botones necesitan su
 *    estado presionado al instante.
 */
export function ScrollEdge() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const sync = () => {
      raf = 0;
      if (window.scrollY > 4) root.setAttribute('data-scrolled', '');
      else root.removeAttribute('data-scrolled');
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const noop = () => {};
    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('touchstart', noop, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('touchstart', noop);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
