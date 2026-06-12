# Design System: ConsultaPlaca (Web)

**Feature**: `001-consulta-placa-vehicular` | **Date**: 2026-06-12
**Stack**: Next.js 15 + Tailwind + shadcn/ui | **Generado con**: ui-ux-pro-max

Sistema de diseño para `apps/web`. Dirección: **institucional-moderno, confiable, accesible (WCAG AA mínimo)**. Es información sensible para compra-venta de vehículos: prioriza legibilidad, jerarquía clara de alertas y credibilidad sobre la decoración.

---

## 1. Dirección de estilo

- **Estilo base**: *Accessible & Ethical* — alto contraste, texto ≥16px, navegación por teclado, foco visible, semántica.
- **Personalidad**: autoridad serena (como un portal oficial moderno), no "startup llamativa".
- **Evitar (anti-patrones)**: gradientes morado/rosa "IA", diseño recargado, bajo contraste, animaciones gratuitas, emojis como iconos.
- **Iconografía**: **Lucide** (SVG, viewBox 24×24, `w-5 h-5`/`w-6 h-6`). Nunca emojis.
- **Modo**: light-first (transmite oficialidad/limpieza); dark mode opcional en fase posterior con los tokens equivalentes ya previstos.

## 2. Paleta de color

Base institucional (navy autoridad) + **semánticos de estado** que son el corazón del reporte. El **rojo se reserva exclusivamente** para la alerta de robo/siniestro, para que destaque sin competencia.

| Rol | Token | Hex | Uso |
|-----|-------|-----|-----|
| Primary / Brand | `primary` | `#1E3A8A` (navy-800) | Header, títulos, botón principal |
| Primary hover | `primary-600` | `#1E40AF` | Estados hover/active |
| Accent (institucional) | `accent` | `#0369A1` (sky-700) | Enlaces, sellos de fuente, detalles |
| Background | `background` | `#F8FAFC` (slate-50) | Fondo de página |
| Surface | `surface` | `#FFFFFF` | Tarjetas |
| Border | `border` | `#E2E8F0` (slate-200) | Bordes/divisores |
| Text | `foreground` | `#0F172A` (slate-900) | Texto principal |
| Text muted | `muted-fg` | `#475569` (slate-600) | Texto secundario/labels (contraste AA) |

**Semánticos de estado (status):**

| Estado | Token | Hex | Significado en el reporte |
|--------|-------|-----|---------------------------|
| OK / positivo | `success` | `#16A34A` (green-600) | SOAT vigente, sin robo, sin siniestro |
| Advertencia | `warning` | `#D97706` (amber-600) | Reporte parcial, dato no disponible, SOAT por vencer |
| Peligro / alerta | `danger` | `#DC2626` (red-600) | **Reportado como robado**, registra siniestro |
| Próximamente | `neutral` | `#64748B` (slate-500) | Secciones aún no disponibles |

> Las superficies tintadas usan la versión clara (`-50`/`-100`) del semántico con texto en la versión `-700`/`-800` para garantizar contraste ≥4.5:1. El color **nunca es el único indicador**: cada estado lleva icono + texto.

## 3. Tipografía

Pareja "Corporate Trust" + mono para datos:

| Rol | Fuente | Uso |
|-----|--------|-----|
| Headings | **Lexend** (300–700) | Títulos, números grandes |
| Body | **Source Sans 3** (300–700) | Texto, labels, párrafos |
| Mono (datos) | **JetBrains Mono** (400–600) | Placa, VIN, nº serie, nº motor, nº póliza |

```css
@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
```
```js
// tailwind fontFamily
{ heading: ['Lexend','sans-serif'], body: ['Source Sans 3','sans-serif'], mono: ['JetBrains Mono','monospace'] }
```
- Cuerpo mínimo **16px** en móvil; line-height 1.5–1.65; longitud de línea 65–75 car.
- Identificadores (placa/VIN/motor/póliza) siempre en `font-mono` con tracking ligero → legibilidad y evita confusión 0/O, 1/l.

## 4. Tokens de layout

- Contenedor: `max-w-3xl` para el reporte (lectura), `max-w-5xl` para landing.
- Espaciado base 4px; secciones con `gap-6`/`py-8`.
- Radios: `rounded-xl` en tarjetas, `rounded-lg` en inputs/botones.
- Sombra sutil: `shadow-sm` en tarjetas (evitar sombras dramáticas — sensación institucional).
- z-index escala: 10 (sticky header), 20 (dropdown), 50 (modal/toast).
- Touch targets ≥44×44px; foco visible `ring-2 ring-offset-2 ring-primary`.

---

## 5. Componentes clave

### `PlateInput` (buscador)
Input grande, centrado, con máscara/placeholder de placa peruana (`ABC-123` / `A1B-234`). Botón "Consultar" con estado de carga (deshabilitado + spinner). Validación en cliente antes de enviar (FR-002). `FormField + FormItem + FormLabel + FormControl` de shadcn.

### `SourceBadge` (sello de fuente + fecha) — obligatorio en cada sección
Chip pequeño con icono + nombre de fuente (SUNARP/SBS/APESEG) + fecha/hora relativa ("hace 2 h"). Color `accent`. Cumple FR-031/SC-004.

### `StolenAlert` (alerta de robo) — el elemento de mayor jerarquía
Banner `danger` a ancho completo en la cima del reporte cuando `stolenAlert=true`: fondo `red-50`, borde `red-600`, icono `ShieldAlert`, texto en `red-800` y bold. Con `role="alert"` y `aria-live`. Si no hay robo, no se muestra el banner (o, opcionalmente, un chip verde discreto "Sin reporte de robo").

### `SectionCard` (bloque por sección)
Tarjeta `surface` con: título de sección + icono, `SourceBadge`, contenido (`payload`), y un `StatusPill`. Estados:
- `AVAILABLE` → contenido + datos.
- `UNAVAILABLE` → mensaje "Información no disponible en este momento" + botón "Reintentar" (FR-034).
- `COMING_SOON` → `ComingSoonSection`.

### `StatusPill`
Píldora con icono + texto, color semántico. Ej.: "SOAT vigente" (success/CheckCircle), "Registra siniestro" (danger/AlertTriangle), "Sin seguro registrado" (warning).

### `ComingSoonSection`
Tarjeta atenuada (`neutral`, opacidad ~70%, sin sombra) con icono outline, título de la capacidad (Papeletas, GNV, Deuda bancaria, Investigación PNP) y etiqueta "Próximamente". Comunica el alcance sin parecer error/vacío (FR-032).

### `DataRow`
Fila label (muted) + valor. Identificadores en `font-mono`. Para tablas de datos usar `<Table>` de shadcn con `TableHeader/TableBody`.

### `Disclaimer`
Pie del reporte, texto `muted-fg` pequeño: "Información referencial obtenida de portales públicos oficiales…" (FR-033). Siempre visible.

### Estados de carga / vacío
- Carga: **skeleton** por tarjeta (`animate-pulse`), reservando altura para evitar content-jumping. El reporte puede llenarse sección a sección conforme el job avanza.
- Vacío ("sin resultados en SUNARP"): mensaje guía + acción, nunca pantalla en blanco.

---

## 6. Layout — Página de búsqueda / landing

```text
┌───────────────────────────────────────────────────────────┐
│  [logo] ConsultaPlaca            Cómo funciona   Legal      │  sticky header (primary)
├───────────────────────────────────────────────────────────┤
│                                                             │
│            Conoce el historial de un vehículo               │  H1 Lexend
│         antes de comprarlo. Consulta por placa.             │  subtítulo muted
│                                                             │
│        ┌─────────────────────────────┐  ┌───────────┐      │
│        │  ABC-123          (mono)     │  │ Consultar │      │  PlateInput grande
│        └─────────────────────────────┘  └───────────┘      │
│          Datos de SUNARP · SBS · SOAT                       │  microcopy fuentes
│                                                             │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│   │ Registral│   │ Seguro  │   │ Robo    │   (3 features)    │  iconos Lucide
│   │ SUNARP   │   │ y SOAT  │   │ alerta  │                   │
│   └─────────┘   └─────────┘   └─────────┘                   │
│                                                             │
│   ¿Qué incluye el reporte?  /  Próximamente: papeletas…     │  expectativas + alcance
│                                                             │
│   Disclaimer + enlaces legales                              │  footer
└───────────────────────────────────────────────────────────┘
```
Patrón: hero centrado en la acción (search-first), no carrusel de testimonios. Social proof opcional discreto ("+X consultas realizadas"). CTA = el propio buscador.

## 7. Layout — Página de reporte (`/reporte/[placa]`)

```text
┌───────────────────────────────────────────────────────────┐
│  [logo] ConsultaPlaca                         Nueva consulta│
├───────────────────────────────────────────────────────────┤
│  ⚠  VEHÍCULO REPORTADO COMO ROBADO                          │  StolenAlert (danger, role=alert)
│     Fuente: SUNARP · hace 2 h                               │  (solo si stolenAlert=true)
├───────────────────────────────────────────────────────────┤
│  Placa  ABC-123 (mono, grande)        [Estado: Parcial ⚠]   │  encabezado + ReportStatus
│  Toyota Yaris · 2019 · Plomo                                │
├───────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🛡 Datos registrales        [SUNARP · hace 2 h]        │ │  SectionCard AVAILABLE
│  │ Marca   Toyota      Serie   (mono)                     │ │  DataRow + mono
│  │ Modelo  Yaris       VIN     (mono)                     │ │
│  │ Año     2019        Motor   (mono)                     │ │
│  │ Titular JUAN PEREZ  · dato registral público           │ │  owner (minimizado)
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 📄 Seguro y SOAT            [SBS · hace 1 h]           │ │  SectionCard
│  │ ● SOAT vigente   Aseguradora …  Póliza (mono)  Vence … │ │  StatusPill success
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🚑 Siniestralidad          [SBS]    Información no      │ │  SectionCard UNAVAILABLE
│  │ disponible en este momento.            [ Reintentar ]   │ │  (warning) + acción
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Próximamente                                               │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │  ComingSoonSection (grid)
│  │Papeletas│ │  GNV   │ │ Deuda  │ │  PNP   │                │  atenuadas, "Próximamente"
│  └────────┘ └────────┘ └────────┘ └────────┘                │
│                                                             │
│  Disclaimer: información referencial de portales públicos…  │  Disclaimer (siempre)
│  Términos · Privacidad · Solicitar eliminación de datos     │  enlaces legales
└───────────────────────────────────────────────────────────┘
```

**Jerarquía visual del reporte** (orden de impacto): `StolenAlert` (rojo, arriba de todo) → encabezado placa/estado → secciones MVP con sus sellos → "Próximamente" atenuado → disclaimer/legal. Cada dato siempre dice **de dónde** viene y **cuándo** se obtuvo.

---

## 8. Accesibilidad y responsive (checklist de entrega)

- [ ] Contraste ≥4.5:1 (texto), ≥3:1 (UI/iconos). El estado nunca depende solo del color (icono+texto).
- [ ] Foco visible en todo elemento interactivo; orden de tab = orden visual.
- [ ] Inputs con `<label>`; botones-icono con `aria-label`; `StolenAlert` con `role="alert"`.
- [ ] `cursor-pointer` + transición 150–300ms en clickeables; sin layout shift en hover.
- [ ] Skeletons con altura reservada (sin content-jumping); respeta `prefers-reduced-motion`.
- [ ] Responsive 375 / 768 / 1024 / 1440px; sin scroll horizontal; cuerpo ≥16px en móvil.
- [ ] Semántica: `<header> <main> <article> <section>`; placa/VIN en `font-mono`.

## 9. Reutilización móvil (Expo, fase posterior)

Tokens (color, tipografía, semánticos de estado) y la jerarquía de componentes (`StolenAlert`, `SourceBadge`, `SectionCard`, `StatusPill`, `ComingSoonSection`) se trasladan 1:1 a React Native: definir los mismos tokens en el tema de Expo para mantener identidad visual entre web y app. Lexend/Source Sans 3/JetBrains Mono están disponibles para RN.
