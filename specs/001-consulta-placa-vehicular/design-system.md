# Design System: PlacaPe (Web)

**Feature**: `001-consulta-placa-vehicular` | **Actualizado**: junio 2026
**Stack**: Next.js 15 (App Router) + Tailwind CSS

Sistema de diseño **implementado** en `apps/web` a partir del handoff de Claude Design.
Dirección: **institucional-confiable (fintech serio), accesible (WCAG AA), light-first**.
Es información sensible para compra-venta de vehículos: prioriza legibilidad, jerarquía
clara de alertas y credibilidad sobre la decoración.

> Reemplaza la propuesta original (navy `#1E3A8A` / sky, Lexend/Source Sans 3, íconos
> Lucide). Lo de abajo es lo que está en el código (`apps/web/tailwind.config.ts`,
> `app/globals.css`, `components/ui/*`).

---

## 1. Dirección de estilo

- **Personalidad:** autoridad serena con calidez (azul confianza + teal acción), no
  "startup llamativa".
- **Evitar (anti-patrones):** gradientes morado/rosa "IA", bajo contraste, animaciones
  gratuitas, **emojis como íconos**.
- **Iconografía:** **Material Symbols Rounded** (Google), vía componente `Icon`
  (`fill` opcional). Tamaño por `text-[Npx]`. Nunca emojis.
- **Modo:** light-first. Dark mode opcional en fase posterior.

## 2. Paleta de color (tokens reales)

Dos escalas de marca + semánticos. El **semáforo de riesgo** (verde/ámbar/rojo) es el
corazón del reporte y del score.

| Rol | Token | Hex | Uso |
|-----|-------|-----|-----|
| Primary / Brand | `primary` | `#14506B` (azul-700) | Botón principal, títulos, chrome |
| Primary hover | `primary-600` | `#103D52` (azul-800) | Hover/active |
| Accent (acción) | `accent` | `#16B5A3` (teal-500) | CTA, enlaces, foco |
| Accent hover | `accent-600` | `#13A091` | Hover |
| Background | `background` | `#F5F8FA` | Fondo de página |
| Surface | `surface` | `#FFFFFF` | Tarjetas |
| Foreground | `foreground` | `#0E1B22` | Texto principal |
| Muted | `muted` | `#647884` | Texto secundario/labels (AA) |
| Border | `border` | `#D7DFE4` | Bordes/divisores |

Escalas completas `azul` (50→950) y `teal` (50→900) en `tailwind.config.ts` (para
componentes y superficies oscuras como paneles azul-900).

**Semánticos / semáforo de estado:**

| Estado | Token | Hex (DEFAULT / bg / fg) | Significado |
|--------|-------|--------------------------|-------------|
| Limpio / OK | `success` | `#18994F` / `#EFFBF3` / `#137A45` | SOAT vigente, sin robo, score alto |
| Revisar / aviso | `warning` | `#DA9211` / `#FEF8E9` / `#B8770A` | Reporte parcial, dato por vencer, score medio |
| Alerta / peligro | `danger` | `#DD3B3B` / `#FEF0F0` / `#B82B2B` | **Reportado como robado**, siniestro, score bajo |

> **Cambio de regla:** el diseño original reservaba el rojo *exclusivamente* para robo.
> Ahora el rojo participa del **semáforo de riesgo** (score "alerta" + alertas críticas).
> El color **nunca es el único indicador**: cada estado lleva icono + texto. Superficies
> tintadas usan `*-bg` con texto `*-fg` para contraste ≥4.5:1.

## 3. Tipografía

| Rol | Fuente | Token | Uso |
|-----|--------|-------|-----|
| Display / Headings | **Sora** (300–800) | `font-heading` | Títulos, números grandes, precios |
| Body / UI | **Plus Jakarta Sans** | `font-body` | Texto, labels, botones |
| Mono (datos) | **JetBrains Mono** | `font-mono` | Placa, VIN, nº motor/serie/póliza, montos |

```css
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300..800&family=Plus+Jakarta+Sans:wght@300..800&family=JetBrains+Mono:wght@400..600&display=swap');
```
- Cuerpo mínimo **16px** en móvil; line-height 1.5–1.65; longitud de línea 65–75 car.
- Identificadores (placa/VIN/motor/póliza) siempre en `font-mono` con tracking ligero
  → legibilidad y evita confusión 0/O, 1/l.

## 4. Tokens de layout

- Radios: `rounded-md` 12px (inputs/botones), `rounded-lg` 16px, `rounded-xl` 22px
  (tarjetas), `rounded-2xl` 28px (paneles/héroes).
- Sombras frías slate-tintadas: `shadow-xs`…`shadow-xl` (definidas en config). Tarjetas
  `shadow-sm`; paneles/modales `shadow-lg/xl`.
- Contenedores: `max-w-[1080px]` marketing/paneles, `max-w-3xl` lectura de reporte.
- Touch targets ≥44×44px; foco visible `focus-visible:ring-2 ring-accent ring-offset-2`.
- z-index: 10 (sticky nav), 20 (dropdown), 50 (modal/toast).

---

## 5. Componentes implementados (`apps/web/components`)

**Primitivos UI (`components/ui/`):**
- `Icon` — wrapper de Material Symbols Rounded (`name`, `fill`, `className`).
- `Button` — variantes `primary | accent | secondary | ghost`; tamaños `sm | md | lg`;
  `icon`/`iconRight`, `block`, `href` (renderiza `Link`), `disabled`.
- `Input` — label + icono + hint/error; **toggle de mostrar/ocultar** automático en `type="password"`.
- `PlateInput` — input con estética de placa peruana (bloque "PE · PERÚ" + campo mono).
- `Badge` — tonos `success | warning | danger | info | neutral | brand`, ícono por defecto por tono.
- `Card` — `title/icon/action`, elevaciones `sm | flat | raised`, `interactive`.
- `Tag` — etiqueta neutra / `source` (sello de fuente, mono).
- `Avatar` — iniciales con color de marca.

**De dominio:**
- `RiskGauge` — medidor SVG 0–100, niveles limpio/revisar/alerta (verde/ámbar/rojo). Reusado para el score.
- `HeroSearch` — buscador del hero (PlateInput + "Verificar placa").
- `StateScreen` — estado de borde reutilizable (404, error, vacío): ícono en círculo + título + acciones.
- `SectionCard` (en `/reporte`) — bloque por sección con plan-gating (BASIC/PRO/ULTRA): contenido bloqueado → blur + "Mejorar a Pro/Ultra".
- `Logo` — wordmark "placa**pe**" (versiones clara/oscura en `public/brand/`).

**Principios que se mantienen del diseño original:**
- **Sello de fuente + fecha obligatorio por sección** (de dónde viene el dato y cuándo).
- **Alerta de robo** = máxima jerarquía, `role="alert"`, banner danger a ancho completo.
- Estados de carga con **skeleton** (altura reservada, sin content-jumping); estados
  vacíos con mensaje guía + acción, nunca pantalla en blanco.
- `Disclaimer` de "información referencial de portales públicos oficiales" siempre visible.

---

## 6. Pantallas (ver lista completa en `estado-actual.md` §8)

Landing search-first (hero con buscador, no carrusel), `/planes` (3 niveles + checkout
preview), `/cuenta` (auth de 2 columnas), `/reporte/ejemplo` (dashboard con plan-gating y
`RiskGauge`), `/onboarding`, `/empresas`, `/ayuda`, estados 404/error. La prueba social va
marcada **"Trial · marcha blanca"** hasta tener reseñas reales.

## 7. Accesibilidad y responsive (checklist de entrega)

- [ ] Contraste ≥4.5:1 (texto), ≥3:1 (UI/íconos). El estado nunca depende solo del color.
- [ ] Foco visible en todo interactivo; orden de tab = orden visual.
- [ ] Inputs con `<label>`; botones-icono con `aria-label`; alerta de robo con `role="alert"`.
- [ ] `cursor-pointer` + transición 150–300ms; sin layout shift en hover.
- [ ] Skeletons con altura reservada; respeta `prefers-reduced-motion`.
- [ ] Responsive 375 / 768 / 1024 / 1440px; sin scroll horizontal; cuerpo ≥16px en móvil.
- [ ] Semántica `<header> <main> <section>`; placa/VIN en `font-mono`.

## 8. Reutilización móvil (Expo, fase posterior)

Tokens (color, tipografía, semáforo) y la jerarquía de componentes se trasladan al tema de
Expo para mantener identidad entre web y app. Sora / Plus Jakarta Sans / JetBrains Mono
están disponibles para React Native; los íconos Material Symbols tienen equivalente RN.
