# Feature Specification: PlacaPe — Historial Vehicular por Placa (Perú)

**Feature Branch**: `001-consulta-placa-vehicular`

**Created**: 2026-06-12

**Status**: En desarrollo (marcha blanca)

> ⚠️ Esta spec describe el alcance original. El producto evolucionó (marca **PlacaPe**,
> niveles **BASIC/PRO/ULTRA**, cuentas **Supabase**, pagos por reporte, CAPTCHA Turnstile).
> Ver el estado vigente y los cambios de alcance en **[estado-actual.md](./estado-actual.md)**.

**Input**: User description: "Aplicación web (y posteriormente app Android para Play Store) para consultar el historial de un vehículo peruano por su número de placa, mostrando datos registrales (SUNARP), seguros y siniestralidad (SBS), y estado del SOAT, con secciones 'próximamente' para papeletas, GNV, deuda bancaria e investigaciones PNP que aún no tienen fuente pública automatizable."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta de datos registrales del vehículo (Priority: P1)

Una persona que está por comprar un auto usado ingresa el número de placa y obtiene los datos registrales oficiales del vehículo: titular/propietario, marca, modelo, año, color, número de serie/VIN/motor, y una alerta visible si el vehículo figura reportado como robado. El reporte indica claramente la fuente (SUNARP) y la fecha/hora en que se obtuvo el dato.

**Why this priority**: Es el núcleo del producto y la razón principal por la que un usuario consulta una placa antes de comprar. Sin este dato la app no entrega valor diferencial. Es independientemente desplegable y demostrable.

**Independent Test**: Ingresar una placa válida y verificar que se muestran los campos registrales y la alerta de robo (cuando aplique), con sello de fuente y fecha. Probar también una placa inexistente y verificar el mensaje de "sin resultados".

**Acceptance Scenarios**:

1. **Given** una placa registrada en SUNARP, **When** el usuario la consulta, **Then** el sistema muestra titular, marca, modelo, año, color, número de serie/VIN/motor, y la fecha/hora y fuente del dato.
2. **Given** una placa con anotación de robo, **When** el usuario la consulta, **Then** el sistema muestra una alerta destacada de "vehículo reportado como robado".
3. **Given** una placa con formato inválido (no cumple el patrón peruano), **When** el usuario intenta consultar, **Then** el sistema rechaza la consulta con un mensaje de validación antes de procesarla.
4. **Given** una placa con formato válido pero sin registro encontrado, **When** el usuario la consulta, **Then** el sistema muestra "sin resultados en SUNARP" sin error técnico.

---

### User Story 2 - Estado de seguro (SOAT) y siniestralidad (Priority: P2)

El mismo usuario quiere saber si el vehículo tiene SOAT vigente y si registra accidentes. Ingresada la placa, el reporte indica si el vehículo cuenta con SOAT/CAT/seguro vehicular vigente o contratado en los últimos 5 años, la compañía aseguradora/AFOCAT emisora, número de póliza/certificado y vigencia, y si registra o no siniestros/accidentes. Cada dato indica su fuente (SBS / APESEG) y fecha de obtención.

**Why this priority**: Complementa la decisión de compra (un vehículo siniestrado o sin SOAT es señal de alerta), pero el producto ya entrega valor con solo la US1, por eso es P2.

**Independent Test**: Consultar una placa con SOAT vigente y verificar que se muestran aseguradora, póliza y vigencia; consultar una con historial de siniestro y verificar la indicación de accidente; verificar el sello de fuente y fecha en cada sección.

**Acceptance Scenarios**:

1. **Given** un vehículo con SOAT vigente, **When** el usuario consulta la placa, **Then** el sistema muestra "SOAT vigente", aseguradora, número de póliza y fecha de vigencia.
2. **Given** un vehículo con accidentes registrados en los últimos 5 años, **When** el usuario consulta la placa, **Then** el sistema indica que el vehículo registra siniestralidad.
3. **Given** un vehículo sin pólizas en los últimos 5 años, **When** el usuario consulta la placa, **Then** el sistema indica "sin seguro registrado en los últimos 5 años".

---

### User Story 3 - Reporte consolidado con secciones "Próximamente" y disclaimer (Priority: P2)

El usuario ve un único reporte consolidado que reúne las secciones disponibles (registral, seguros, siniestralidad) y muestra de forma explícita las secciones aún no disponibles —papeletas/infracciones, deuda de GNV, deuda bancaria/prendas, investigaciones PNP— marcadas como "Próximamente", de modo que el usuario entienda el alcance actual. El reporte incluye un disclaimer legal de que la información es referencial y proviene de portales públicos oficiales.

**Why this priority**: Da contexto y honestidad sobre el alcance, evita expectativas erróneas y prepara la UI para crecer. Es P2 porque depende de que existan al menos US1/US2 para tener contenido que consolidar.

**Independent Test**: Generar un reporte y verificar que las secciones no disponibles aparecen claramente como "Próximamente" (no como error ni vacío) y que el disclaimer legal es visible.

**Acceptance Scenarios**:

1. **Given** un reporte generado, **When** el usuario lo visualiza, **Then** las secciones de papeletas, GNV, deuda bancaria/prendas e investigaciones PNP aparecen rotuladas "Próximamente".
2. **Given** cualquier reporte, **When** el usuario lo visualiza, **Then** se muestra un disclaimer indicando que la información es referencial y obtenida de portales públicos oficiales.
3. **Given** un reporte donde una fuente no respondió a tiempo, **When** el usuario lo visualiza, **Then** esa sección indica "información no disponible en este momento" sin invalidar el resto del reporte.

---

### User Story 4 - Resultados rápidos mediante caché (Priority: P3)

Cuando una placa ya fue consultada recientemente, el sistema devuelve el reporte de forma casi inmediata reutilizando un resultado almacenado temporalmente, en lugar de volver a consultar las fuentes oficiales. El reporte indica que los datos corresponden a una consulta previa y su antigüedad, con la opción de forzar una actualización.

**Why this priority**: Mejora experiencia y reduce costo/carga sobre las fuentes oficiales, pero no es imprescindible para el MVP funcional. P3.

**Independent Test**: Consultar una placa dos veces seguidas y verificar que la segunda respuesta es marcadamente más rápida y está rotulada con la antigüedad del dato y opción de actualizar.

**Acceptance Scenarios**:

1. **Given** una placa consultada hace pocos minutos, **When** otro usuario la consulta, **Then** el sistema devuelve el resultado almacenado e indica su antigüedad.
2. **Given** un resultado almacenado vencido (más antiguo que el tiempo de validez), **When** el usuario consulta, **Then** el sistema vuelve a consultar las fuentes oficiales.
3. **Given** un resultado almacenado vigente, **When** el usuario elige "actualizar", **Then** el sistema vuelve a consultar las fuentes ignorando el almacenado.

---

### Edge Cases

- **Fuente oficial caída o con CAPTCHA no resoluble**: el reporte se entrega parcial, marcando la sección afectada como "no disponible en este momento" y permitiendo reintentar, sin bloquear las secciones que sí respondieron.
- **Placa en formato antiguo vs. nuevo** (formatos de placa peruana han cambiado en el tiempo): el sistema acepta y normaliza los formatos válidos vigentes e históricos, y maneja la relación entre placa anterior y placa vigente cuando la fuente la expone.
- **Consultas abusivas / scraping de la propia app**: el sistema limita la tasa de consultas por usuario/origen para no ser usado como agregador masivo ni saturar las fuentes oficiales.
- **Datos contradictorios entre fuentes** (ej. SUNARP indica un dato y SBS otro): cada dato se atribuye a su fuente sin que el sistema "decida" cuál es correcto.
- **Solicitud de eliminación de datos por el titular**: debe existir un canal para atender solicitudes relacionadas con datos personales (nombre del propietario).
- **Tiempo de respuesta largo de las fuentes**: si la consulta excede un umbral, el usuario recibe feedback de progreso y/o la opción de recibir el resultado cuando esté listo, en lugar de una pantalla congelada.

## Requirements *(mandatory)*

### Functional Requirements

#### Consulta y validación
- **FR-001**: El sistema MUST permitir al usuario ingresar un número de placa y solicitar un reporte vehicular.
- **FR-002**: El sistema MUST validar y normalizar el formato de la placa (formatos peruanos vigentes e históricos) antes de procesar la consulta, rechazando entradas inválidas con un mensaje claro.
- **FR-003**: El sistema MUST limitar la tasa de consultas por usuario/origen para prevenir abuso y uso como agregador masivo.

#### Datos registrales (SUNARP)
- **FR-010**: El sistema MUST obtener y mostrar los datos registrales del vehículo: titular/propietario, marca, modelo, año, color, y número de serie/VIN/motor cuando estén disponibles.
- **FR-011**: El sistema MUST mostrar de forma destacada una alerta cuando el vehículo figure con anotación de robo.
- **FR-012**: El sistema MUST manejar y, cuando la fuente lo exponga, mostrar la relación entre placa anterior y placa vigente.

#### Seguros y siniestralidad (SBS / APESEG)
- **FR-020**: El sistema MUST indicar si el vehículo cuenta con SOAT/CAT/seguro vehicular vigente o contratado en los últimos 5 años.
- **FR-021**: El sistema MUST mostrar, cuando estén disponibles, la compañía aseguradora/AFOCAT emisora, número de póliza/certificado y vigencia.
- **FR-022**: El sistema MUST indicar si el vehículo registra o no siniestralidad/accidentes en el periodo disponible.

#### Reporte consolidado
- **FR-030**: El sistema MUST presentar un reporte consolidado que agrupe las secciones disponibles (registral, seguros, siniestralidad).
- **FR-031**: Cada dato/sección del reporte MUST indicar su fuente oficial y la fecha/hora en que fue obtenido.
- **FR-032**: El sistema MUST mostrar las capacidades aún no disponibles (papeletas/infracciones, deuda de GNV, deuda bancaria/prendas, investigaciones PNP) rotuladas como "Próximamente".
- **FR-033**: El sistema MUST mostrar un disclaimer indicando que la información es referencial y proviene de portales públicos oficiales.
- **FR-034**: Cuando una fuente no responda, el sistema MUST entregar un reporte parcial marcando la sección afectada como "no disponible", sin invalidar el resto.

#### Obtención de datos y rendimiento
- **FR-040**: El sistema MUST obtener la información desde los portales oficiales públicos (SUNARP, SBS, APESEG) mediante un proceso de consulta automatizado que gestione los mecanismos de protección de dichos portales (CAPTCHA/reCAPTCHA).
- **FR-041**: El sistema MUST procesar las consultas a través de una cola que tolere la latencia y los reintentos de las fuentes oficiales sin bloquear la interfaz del usuario.
- **FR-042**: El sistema MUST almacenar temporalmente (caché con tiempo de validez) los resultados por placa para evitar reconsultar las fuentes en cada solicitud, indicando la antigüedad del dato.
- **FR-043**: El sistema MUST permitir forzar una actualización que ignore el resultado almacenado.

#### Privacidad y cumplimiento legal
- **FR-050**: El sistema MUST minimizar el almacenamiento del nombre del propietario, tratándolo como dato personal sensible bajo la normativa peruana de protección de datos (DS 016-2024-JUS / Ley 29733).
- **FR-051**: El sistema MUST mostrar Términos de Uso y Política de Privacidad accesibles al usuario.
- **FR-052**: El sistema MUST ofrecer un canal para atender solicitudes relacionadas con datos personales (p. ej., del titular del vehículo).
- **FR-053**: El sistema MUST registrar el origen y propósito de los datos personales tratados, de forma que pueda declararse el manejo de datos para publicación en tiendas de aplicaciones.

#### Multiplataforma (evolución)
- **FR-060**: La capacidad de consulta MUST estar disponible a través de una interfaz web en el lanzamiento inicial.
- **FR-061**: La lógica de obtención de datos MUST exponerse de forma que pueda ser reutilizada por una futura aplicación móvil Android sin reimplementar la consulta a las fuentes.

#### Monetización (preparación, no MVP)
- **FR-070**: El sistema SHOULD estar diseñado para soportar a futuro un modelo de consumo (p. ej., consultas gratuitas limitadas y reportes/créditos de pago) sin que el MVP implemente cobro.
- **FR-071**: El MVP MUST lanzarse sin autenticación obligatoria (consulta anónima con límite de tasa por origen); las cuentas de usuario se incorporarán junto con el modelo de monetización en una fase posterior.

#### Niveles de resultado (BASIC / PRO / ULTRA)
- **FR-080**: El sistema MUST ofrecer tres niveles de resultado por placa: **BASIC** (gratuito), **PRO** y **ULTRA** (de pago).
- **FR-081**: El nivel **BASIC** MUST mostrar automáticamente la información común del vehículo (marca, modelo, año, color y alerta de robo) obtenida de SUNARP, sin requerir que el usuario visite portales externos.
- **FR-082**: El nivel **PRO** MUST presentar el reporte consolidado en formato amigable con un **score general (0–100)** y un **score por concepto** (legal/registral, seguro y siniestros, multas y deudas, uso y estado), cada uno con su explicación y fuente. El score MUST calcularse de forma determinística y explicable (no mediante IA).
- **FR-083**: El nivel **ULTRA** MUST añadir una recomendación asistida por IA que estime un valor de compra de referencia a partir de precios de mercado obtenidos en el momento (Neoauto, Mercado Libre Perú, Autocosmos, Facebook Marketplace) y un veredicto (comprar/negociar/evitar) con su justificación.
- **FR-084**: La interfaz pública MUST NOT exponer los enlaces a los portales oficiales (la "consulta guiada"); las URLs de origen se usan solo del lado servidor para la obtención de datos. Una vista interna protegida por rol de administrador PUEDE mostrarlos para verificación del equipo.
- **FR-085**: La atribución de la fuente oficial de cada dato (p. ej. "SUNARP") MUST permanecer visible (ver FR-031), aunque la mecánica de obtención (URLs, scraping, tokens) NO se exponga al cliente.

### Key Entities *(include if feature involves data)*

- **Vehículo**: representa el bien consultado, identificado por su placa (vigente e histórica). Atributos: marca, modelo, año, color, serie/VIN/motor, estado de robo.
- **Reporte de consulta**: resultado consolidado para una placa en un momento dado. Atributos: placa consultada, fecha/hora de generación, conjunto de secciones (registral, seguros, siniestralidad, próximamente), antigüedad, estado (completo/parcial).
- **Sección de fuente**: cada bloque de datos atribuido a una fuente oficial (SUNARP, SBS, APESEG). Atributos: fuente, fecha/hora de obtención, estado (disponible/no disponible), contenido.
- **Propietario/Titular**: dato personal asociado al vehículo en SUNARP; tratado con minimización y reglas de retención específicas.
- **Póliza/SOAT**: cobertura de seguro asociada al vehículo. Atributos: aseguradora/AFOCAT, número, vigencia.
- **Siniestro**: indicación de accidente registrado para el vehículo en el periodo disponible.
- **Solicitud de consulta (trabajo en cola)**: unidad de trabajo que representa una consulta en proceso. Atributos: placa, estado (pendiente/en proceso/completado/fallido), reintentos.
- **Usuario/Consumidor de la consulta**: quien realiza la búsqueda; sujeto a límites de tasa. (Cuenta de usuario formal pendiente de definición según FR-070.)
- **Nivel de resultado (Tier)**: BASIC | PRO | ULTRA. Determina qué secciones y elaboraciones (score, recomendación IA) se entregan para una consulta.
- **Score del vehículo**: puntuación general (0–100) y por concepto, derivada de forma determinística del reporte ensamblado (no IA); sustenta el nivel PRO y alimenta la recomendación ULTRA.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario puede obtener un reporte registral (US1) de una placa válida en menos de 30 segundos en una primera consulta (sin caché), incluyendo el tiempo de resolución de protecciones de la fuente.
- **SC-002**: Una segunda consulta de la misma placa dentro del periodo de validez del caché se entrega en menos de 3 segundos.
- **SC-003**: Al menos el 90% de las consultas de placas válidas y existentes devuelven la sección registral completa (titular y características) sin error técnico.
- **SC-004**: El 100% de los reportes muestran, para cada sección, su fuente oficial y la fecha/hora de obtención.
- **SC-005**: El 100% de los reportes muestran el disclaimer legal y las secciones "Próximamente" cuando corresponde.
- **SC-006**: Cuando una fuente está caída, el reporte se entrega parcial (con las secciones disponibles) en al menos el 95% de esos casos, en lugar de fallar por completo.
- **SC-007**: El nombre del propietario no se conserva más allá del periodo de validez del reporte definido por la política de retención, verificable en el almacenamiento.
- **SC-008**: Un usuario nuevo entiende el alcance del reporte (qué está disponible y qué es "Próximamente") sin asistencia, medible por prueba de usabilidad con ≥80% de comprensión.

## Assumptions

- **Fuentes de datos**: No existe ninguna API oficial contratada del gobierno peruano; los datos se obtienen de los portales públicos gratuitos (SUNARP `consultavehicular.sunarp.gob.pe`, SBS `servicios.sbs.gob.pe/reportesoat`, APESEG). Estos portales están protegidos con CAPTCHA/reCAPTCHA y mecanismos de sesión, por lo que la obtención automatizada es frágil y puede requerir mantenimiento continuo.
- **Obtención de SUNARP (Cloudflare Turnstile)**: El portal de SUNARP está protegido con Cloudflare Turnstile (no es CAPTCHA de imagen ni reCAPTCHA); la obtención automatizada requiere un solver de pago que soporte Turnstile (**2Captcha** para iniciar, **CapSolver** para producción) y, probablemente, proxies residenciales para no ser bloqueado por reputación de IP. El nivel BASIC depende de esta obtención, por lo que se aplica **caché agresiva por placa** para acotar el costo por consulta.
- **Alcance MVP**: Solo se implementan SUNARP, SBS y SOAT/APESEG por ser las únicas fuentes que entregan datos por placa de forma públicamente verificable. Papeletas (SAT/SUTRAN/MTC), deuda de GNV, deuda bancaria/prendas detalladas e investigaciones PNP quedan fuera del MVP por no tener fuente pública automatizable confirmada.
- **Cobertura geográfica**: La sección de papeletas urbanas (futuro) sería inicialmente solo de Lima (SAT Lima), no nacional.
- **Lanzamiento**: Web primero (FR-060); la app Android del Play Store es una fase posterior que reutiliza la misma capa de datos (FR-061).
- **Legal**: El nombre del propietario es dato registral público de SUNARP, pero también dato personal bajo Ley 29733 y su reglamento DS 016-2024-JUS (vigente desde marzo 2025); por ello se minimiza su almacenamiento y se publican Términos/Privacidad. Se asume que la operación se realiza como consulta de información pública con fines de verificación, no como reventa masiva de base de datos.
- **Datos por DNI y multas electorales (decisión de diseño PRO)**: La consulta gratuita de SUNARP expone el nombre del titular, NO su DNI (el DNI solo está en la partida pagada SPRL), y el cruce nombre→DNI está prohibido (sin búsqueda inversa por nombre). Por ello: (a) las papeletas por cinemómetro de SUTRAN (exceso de velocidad en carretera) son dato del vehículo y sí pueden integrarse al reporte PRO; (b) las multas electorales (JNE/ONPE, por DNI) son dato personal del dueño —no del vehículo, no se heredan en la compra— y NO se consultan de oficio con el DNI del titular (conflicto con FR-050 / Ley 29733); se ofrecen como módulo opcional "Verificación del vendedor" iniciado por el usuario, con el DNI que el vendedor entrega con su consentimiento en la transacción (una multa electoral impaga impide la transferencia notarial).
- **Monetización**: No se implementa cobro en el MVP; la arquitectura se prepara para freemium/créditos a futuro (FR-070).
- **Conectividad**: Los usuarios disponen de conexión a internet estable; la app es de consulta en línea (no offline).
- **Disponibilidad de fuentes**: Se asume que los portales oficiales seguirán accesibles públicamente; cambios en sus mecanismos de protección o estructura pueden requerir adaptación del proceso de obtención.
