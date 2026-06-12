# App móvil (Expo / React Native) — guía de scaffolding

> **Estado**: fuera del alcance de implementación actual (FR-061). Este documento define
> cómo añadir la app Android para Play Store reutilizando el backend existente, sin reescribir
> la lógica de consulta.

## Principio: reutilizar, no reimplementar

La app móvil **no** scrapea ni habla con los portales oficiales: consume la misma **API REST**
(`apps/api`) que la web. Toda la lógica frágil (scraping, CAPTCHA, cola, caché, cumplimiento legal)
vive en el backend y se comparte vía el contrato HTTP. Esto cumple FR-061 y mantiene una sola
fuente de verdad.

## Qué se reutiliza tal cual

- **`packages/shared`**: tipos (`Report`, `SectionResult`, `InsurancePolicy`…), enums,
  validación/normalización de placa (`isValidPlate`, `formatPlateDisplay`) y esquemas Zod.
  React Native ejecuta el mismo TypeScript; el paquete se importa sin cambios.
- **Contrato de la API**: `POST /api/v1/consultas` + polling de `GET /api/v1/consultas/{jobId}`,
  `GET /api/v1/reportes/{placa}`, `POST /api/v1/solicitudes-datos`. El cliente (`apps/web/lib/api.ts`)
  sirve de referencia directa; se copia/adapta a `fetch` de RN.
- **Tokens del design system**: paleta (navy + semánticos), tipografías (Lexend / Source Sans 3 /
  JetBrains Mono) y la jerarquía de componentes (`StolenAlert`, `SourceBadge`, `StatusPill`,
  `SectionCard`, `ComingSoonSection`) se trasladan 1:1 al tema de Expo.

## Pasos para crear `apps/mobile`

1. **Scaffold**: `npx create-expo-app apps/mobile --template` (TypeScript, Expo Router).
2. **Workspace**: añadir `apps/mobile` ya está cubierto por el glob `apps/*` del root.
   Configurar Metro para resolver el monorepo (`metro.config.js` con `watchFolders` a la raíz y
   `nodeModulesPaths`), de modo que `@app/shared` se resuelva como en web.
3. **Fuentes**: cargar Lexend / Source Sans 3 / JetBrains Mono con `expo-font` / `@expo-google-fonts`.
4. **Tema**: definir los mismos tokens de color/tipografía de
   [design-system.md](../specs/001-consulta-placa-vehicular/design-system.md) en un theme RN.
5. **Pantallas** (Expo Router): `index` (búsqueda con validación de placa) y `reporte/[placa]`
   (mismo árbol visual que la web: alerta de robo → registral → seguros → siniestralidad →
   "Próximamente" → disclaimer). Reusar la lógica de polling de `use-consulta`.
6. **API base URL**: variable de entorno (`EXPO_PUBLIC_API_URL`) apuntando al backend desplegado.

## Publicación en Play Store (consideraciones)

- **Data Safety form**: declarar que se muestran datos personales (nombre del titular, dato
  registral público) y su finalidad; enlazar la Política de Privacidad. La minimización ya
  implementada en el backend (retención corta, sin búsqueda inversa, auditoría) sustenta esta
  declaración.
- **Términos y Privacidad** accesibles dentro de la app (las vistas web equivalentes existen en
  `apps/web/app/legal/`).
- **Build/entrega**: EAS Build para generar el AAB; cuenta de Google Play Console.

## Lo que NO debe hacer la app

- No incluir scrapers ni claves de CAPTCHA en el cliente.
- No almacenar localmente el nombre del titular más allá de la sesión de visualización.
- No permitir búsqueda por nombre de persona (solo por placa).
