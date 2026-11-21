'use client';

import { useEffect, useRef } from 'react';

/**
 * Olas del hero: capas de agua teal que se desplazan lento, con destellos que aparecen y se apagan sobre
 * la cresta de la ola delantera. Canvas 2D, ~30 fps (ahorra batería), y se PAUSA cuando el hero sale de
 * pantalla o la pestaña está oculta. Con «reducir movimiento» se dibuja un solo cuadro quieto.
 */

// Capas de atrás hacia adelante: altura base (fracción del alto), amplitudes (px), longitudes de onda
// (px), velocidades (rad/s) y color.
const LAYERS = [
  { base: 0.58, a1: 18, a2: 7, l1: 1100, l2: 520, s1: 0.16, s2: -0.11, top: 'rgba(22,181,163,0.10)', bottom: 'rgba(12,111,100,0.22)' },
  { base: 0.67, a1: 15, a2: 6, l1: 860, l2: 430, s1: -0.2, s2: 0.13, top: 'rgba(22,181,163,0.13)', bottom: 'rgba(10,90,82,0.28)' },
  { base: 0.76, a1: 13, a2: 5, l1: 700, l2: 360, s1: 0.26, s2: -0.17, top: 'rgba(63,201,184,0.14)', bottom: 'rgba(10,90,82,0.32)' },
  { base: 0.85, a1: 10, a2: 4, l1: 560, l2: 300, s1: -0.32, s2: 0.21, top: 'rgba(113,218,205,0.16)', bottom: 'rgba(12,111,100,0.36)' },
  // Orilla: la última ola es del color de la franja de abajo (blanco) → el hero se funde con la página.
  { base: 0.965, a1: 7, a2: 3, l1: 640, l2: 280, s1: 0.22, s2: -0.15, top: 'rgba(255,255,255,1)', bottom: 'rgba(255,255,255,1)' },
];

type Spark = { x: number; born: number; life: number; size: number };

export function HeroWaves() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = 0, visible = true;
    const sparks: Spark[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const waveY = (L: (typeof LAYERS)[number], x: number, t: number) =>
      h * L.base + L.a1 * Math.sin((x / L.l1) * Math.PI * 2 + t * L.s1) + L.a2 * Math.sin((x / L.l2) * Math.PI * 2 + t * L.s2);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const L of LAYERS) {
        const g = ctx.createLinearGradient(0, h * L.base - L.a1, 0, h);
        g.addColorStop(0, L.top);
        g.addColorStop(1, L.bottom);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, waveY(L, x, t));
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      // Destellos sobre la cresta de la ola delantera: nacen, brillan y se apagan (≈2–3.5 s).
      const front = LAYERS[LAYERS.length - 2]!; // la ola teal más cercana (la última es la orilla blanca)
      if (!reduce && sparks.length < Math.max(6, Math.round(w / 90)) && Math.random() < 0.08) {
        sparks.push({ x: Math.random() * w, born: t, life: 2 + Math.random() * 1.5, size: 1 + Math.random() * 1.3 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        const k = (t - s.born) / s.life;
        if (k >= 1) { sparks.splice(i, 1); continue; }
        const alpha = Math.sin(k * Math.PI) * 0.85;
        const x = s.x + (t - s.born) * 6; // derivan con el agua
        const y = waveY(front, x, t) - 2;
        const r = s.size * 3.2;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
        glow.addColorStop(0.35, `rgba(215,245,240,${alpha * 0.55})`);
        glow.addColorStop(1, 'rgba(215,245,240,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last >= 33) { last = now; draw(now / 1000); } // ~30 fps
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && !reduce) raf = requestAnimationFrame(loop); };

    resize();
    draw(performance.now() / 1000);
    start();

    const ro = new ResizeObserver(() => { resize(); draw(performance.now() / 1000); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; if (visible) start(); });
    io.observe(canvas);
    const onVis = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
