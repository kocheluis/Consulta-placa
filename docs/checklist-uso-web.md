# Checklist de uso — PlacaPe (placape.pe)

> Para recorrer la web como cliente real. Marca `[x]` lo que esté bien, `[!]` lo que falle o
> confunda, y anota en **Notas**. Cada punto tiene **Qué mirar** y, cuando aplica, una
> **Recomendación** (lo que suele faltar en este tipo de producto) o un **Hallazgo** que ya
> encontré leyendo el código y la web publicada el 8-nov-2026.
>
> Consejo: hazlo dos veces: una en el celular (datos móviles, no wifi) y otra en la compu.
> Ten a mano un cronómetro y una placa real que conozcas (la tuya o la de un familiar).

Fecha del recorrido: ________  Dispositivo / navegador: ________  Placa usada: ________

---

## 0. Primera impresión (landing `/`)

- [ ] **¿Se entiende en 5 segundos qué es, cuánto cuesta y qué recibo?**
  Recomendación: el titular + el buscador + "Básico gratis · Pro S/ 15.90 · Ultra S/ 19.90" deberían verse sin hacer scroll en el celular.
- [ ] **Promesas que coinciden con la realidad.**
  Hallazgo: la landing dice **"INSPECCIÓN VEHICULAR OFICIAL"** arriba del título, pero el pie dice "no constituye un certificado oficial". PlacaPe no es una entidad oficial ni hace inspección física: ese sello es el que más riesgo tiene ante INDECOPI (publicidad engañosa). Sugerencia: "Historial vehicular con fuentes oficiales".
- [ ] **Tiempos prometidos.**
  Hallazgo: la web dice a la vez "Resultado en 30 seg", "en segundos" (landing y `/planes`), "Acceso inmediato" (`/planes`), "en minutos" y, dentro del reporte, "3 a 10 minutos". Cronometra tu consulta real y deja un solo mensaje, el verdadero.
- [ ] **"Pago y datos cifrados"** (chip de confianza): hoy el pago real es Yape manual. Revisa si la frase se sostiene.
- [ ] **Testimonios y cifras.** Las 4 citas y los números de la marcha blanca (158 vehículos, 45 %, 15 %, 10 %) tienen que poder sustentarse si alguien lo pide (guarda el consentimiento de cada persona citada).
- [ ] **"Soporte dedicado"**: ¿quién responde, por dónde y en cuánto tiempo? (ver paso 9).
- [ ] **Logos de fuentes** (SUNARP, SAT, SBS, MTC, APESEG, ATU, FISE): que no parezca que son socios o que avalan el producto.

Notas: ______________________________________________

## 1. Escribir la placa

- [ ] Prueba `ABC123`, `abc-123`, `ABC 123`, `A1B234` (moto/otras), una placa que no exista y una vacía. ¿El mensaje de error es claro?
- [ ] En el celular, ¿el teclado aparece en mayúsculas? ¿El botón "Verificar placa" queda a la vista?
- [ ] ¿Se puede buscar desde cualquier página o solo desde la portada?

Notas: ______________________________________________

## 2. Puerta de acceso (te pide cuenta)

Toda consulta nueva exige cuenta (lo confirmé en producción: `/reporte/<placa>` muestra "Ingresa para ver tu reporte").

- [ ] ¿Te molesta como cliente que te pida cuenta **antes** de ver nada? Recomendación habitual: mostrar algo gratis (marca/modelo/año) antes de pedir registro, o explicar en una línea **por qué** (te avisamos por correo, guardamos tu historial).
- [ ] Registro con **correo**: ¿llega el correo de confirmación? ¿Cuánto tarda? ¿Cae en spam? ¿Sale con la marca PlacaPe y desde un remitente `@placape.pe`?
- [ ] Registro con **Google** y con **Facebook**: ¿la pantalla de permiso muestra "PlacaPe" (con logo) o un dominio raro de Supabase (`…supabase.co`)? Eso último genera desconfianza.
- [ ] Después de registrarte, ¿te devuelve **a la placa** que estabas consultando?
- [ ] Casilla de Términos y Privacidad: ¿los enlaces abren y se pueden leer en el celular?
- [ ] **"¿Olvidaste tu contraseña?"** Hallazgo: en el código la recuperación no envía nada, solo dice "se habilitará muy pronto, escríbenos a soporte@placape.pe". Pruébalo: un cliente que paga y no puede entrar es un reclamo seguro.

Notas: ______________________________________________

## 3. Espera mientras se genera el reporte

- [ ] Cronometra: ¿cuánto tarda el **Básico**? ¿y Pro/Ultra después de pagar? (en riesgos figura ~3–5 min por reporte y 1 a la vez).
- [ ] ¿La pantalla de espera dice qué está pasando y cuánto falta? ¿Puedes cerrar la pestaña y te llega el aviso por correo?
- [ ] ¿Qué pasa si recargas la página o la abres en otro dispositivo durante la espera?
- [ ] Prueba dos placas seguidas: ¿la segunda queda en cola sin explicación?

Notas: ______________________________________________

## 4. Reporte Básico (gratis)

- [ ] ¿Se entiende el **score / semáforo** sin saber nada de autos? ¿Dice qué significa la letra A–F?
- [ ] **Fuente y fecha de cada dato**: en el código el reporte muestra "Fuentes consultadas" y la fecha general de generación, pero no vi fecha **por fuente**. Revisa si para el SOAT, papeletas, etc. sabes de dónde y de cuándo es el dato (principio de integridad del propio proyecto y defensa ante reclamos).
- [ ] Fuentes que no respondieron: ¿se nota claramente "no se pudo consultar" frente a "sin problemas"? ¿Funciona el botón **"Reintentar fuentes con error"**?
- [ ] Placa inexistente: ¿mensaje claro y **sin cobro**?
- [ ] Datos personales de terceros (nombre/DNI del dueño): ¿aparecen enmascarados? (riesgo L-01).
- [ ] El aviso legal (disclaimer) al pie del reporte: ¿se ve, se entiende y no es letra minúscula ilegible en el celular?
- [ ] ¿Hay un llamado claro a pasar a Pro/Ultra sin que se sienta engañoso?

Notas: ______________________________________________

## 5. Pagar Pro / Ultra (el paso más delicado)

Hallazgo importante: hay **dos caminos de pago distintos** y conviene que los pruebes ambos.
- Desde **el reporte** ("Desbloquear → Activar Pro · S/ 15.90"): en producción usa **Yape manual** (modal "Paga con Yape", tú confirmas el pago a mano en `/admin/pagos`).
- Desde **`/planes`** ("Elegir Pro"): es una **vista previa**; avisa que "no se procesan cobros reales" y termina en una confirmación que no cobra nada. Un cliente puede creer que ya pagó o confundirse.

- [ ] ¿Está claro **qué incluye** cada nivel antes de pagar? ("y más…" en `/planes` obliga a adivinar).
- [ ] ¿El precio dice si incluye IGV? ¿Se entrega **boleta o factura electrónica**? (`/empresas` promete "Factura con RUC"). Recomendación: indicarlo junto al precio.
- [ ] Modal de Yape: ¿a nombre de quién figura el Yape? Si es un Yape **personal**, el cliente ve un nombre de persona, no la empresa: baja la confianza (riesgo L-04). Con la empresa ya constituida, lo ideal es Yape/cuenta a nombre de la empresa.
- [ ] ¿Cuánto tardas tú en confirmar el pago? ¿Qué ve el cliente a las 11 p. m. o un domingo? ¿Le dice el horario de confirmación?
- [ ] Pulsa "Ya yapeé" sin haber pagado: ¿el mensaje es claro y no desbloquea?
- [ ] **Política de reembolso**: ¿qué pasa si pagó y una fuente no respondió, o el reporte nunca llega? Hoy no está publicada (riesgo P-03 / L-05).
- [ ] Referencia de mercado en `/planes` ("S/ 268 haciéndolo por separado", "Reemplaza un peritaje de S/ 150+"): ¿puedes sustentar cada precio? Un reporte no reemplaza un peritaje mecánico; esa frase puede leerse como promesa.
- [ ] "Pack Comprador S/ 49" y packs por volumen: ¿se pueden comprar de verdad hoy o solo se ven?

Notas: ______________________________________________

## 6. Reporte Pro / Ultra

- [ ] ¿Aparecen todas las secciones que `/planes` promete para ese nivel? Cuenta las fuentes reales frente a "10 fuentes nacionales".
- [ ] **PDF**: `/planes` promete "Descarga en PDF" para Pro y Ultra y el reporte de ejemplo tiene botón PDF, pero **en el reporte real no encontré botón de PDF** en el código. Verifica; si falta, es una promesa incumplida.
- [ ] Ultra: análisis con IA y valorización: ¿dice que es referencial? ¿de qué fuentes sale el precio y de qué fecha?
- [ ] ¿Se puede compartir el reporte (enlace) con el vendedor o un familiar? ¿Qué ve esa otra persona?
- [ ] En el celular: tablas anchas, textos chicos, botones que se tapan.

Notas: ______________________________________________

## 7. Reporte de ejemplo (`/reporte/ejemplo`)

- [ ] Hallazgo: el ejemplo muestra el SOAT **"Vigente · vence 12 ago 2026"**, fecha que ya pasó. Detalle chico, pero un comprador atento lo nota y duda del resto. Conviene que las fechas del ejemplo sean relativas o futuras.
- [ ] ¿Queda claro que es de demostración?

Notas: ______________________________________________

## 8. Mi cuenta / "Mis reportes" (`/cuenta`)

- [ ] Hallazgo: "Mis reportes" lista **solo los comprados** (Pro/Ultra). Las consultas Básicas gratis no aparecen. ¿Lo esperarías como cliente?
- [ ] ¿Puedes volver a abrir un reporte pagado días después? ¿Hasta cuándo? (hay retención por TTL: ¿se le avisa al cliente?).
- [ ] ¿Se puede cambiar contraseña, correo o **borrar la cuenta**? (derecho ARCO).
- [ ] ¿Cierra sesión bien en el celular?

Notas: ______________________________________________

## 9. Ayuda, contacto y soporte (`/ayuda`)

- [ ] Hoy el único canal es **correo `soporte@placape.pe`** (Lun–Sáb 9:00–18:00). Escribe un correo de prueba: ¿llega? ¿Cuánto tardas en responder?
- [ ] Recomendación: un botón de **WhatsApp** (incluso un simple `wa.me` mientras se arma el bot) es lo que el cliente peruano espera para "ya pagué y no me llega".
- [ ] Las preguntas frecuentes ("¿Cuánto demora?", "¿Puedo pagar con Yape?") ¿responden lo mismo que el resto de la web?

Notas: ______________________________________________

## 10. Legales y datos de la empresa (pie de página)

- [ ] **Libro de Reclamaciones virtual**: **no existe** en la web. Es **obligatorio** para quien vende a consumidores en el Perú (Código de Protección y Defensa del Consumidor + su reglamento) y debe tener un enlace visible desde la portada. Es lo primero que revisa INDECOPI.
- [ ] **Razón social y RUC** en el pie (y en Términos): hoy no figuran. Con la empresa ya inscrita, conviene ponerlos (también ayuda a la verificación de Meta, ver guía de WhatsApp).
- [ ] **Términos de uso**: hoy son 3 párrafos y solo nombran SUNARP, SBS y APESEG. Faltan: condiciones de compra, precio e IGV, entrega, **reembolsos**, limitación de responsabilidad (riesgo L-03), uso de IA, ley aplicable.
- [ ] **Privacidad**: falta quién es el responsable (razón social, RUC, dirección), finalidad, plazo de conservación, si se usa analítica/cookies y proveedores (Supabase, Vercel, Anthropic para Ultra, Resend).
- [ ] **Solicitar datos (ARCO)**: envía una solicitud de prueba: ¿a dónde llega? ¿Quién la atiende y en cuánto tiempo?
- [ ] Aviso de cookies / analítica (la web usa Vercel Analytics).

Notas: ______________________________________________

## 11. Correos que recibe el cliente

- [ ] Confirmación de cuenta, "tu reporte está listo", pago confirmado: ¿llegan los tres? ¿Remitente con marca? ¿Enlace que funciona en el celular? ¿Llegan a spam en Gmail/Hotmail?

Notas: ______________________________________________

## 12. Otras páginas

- [ ] `/empresas`: muestra un panel de flota de demostración y promete "consulta por lote (CSV, hasta 500)", "equipo y roles", "factura con RUC". ¿Qué de eso existe hoy? "Habla con ventas": ¿a dónde lleva?
- [ ] `/portales`: ¿enlaces vigentes?
- [ ] Una URL que no existe (`/xyz`): ¿la página 404 te devuelve al buscador?

Notas: ______________________________________________

---

## Resumen para priorizar (llenar al final)

| Prioridad | Qué encontré | Paso |
|---|---|---|
| Urgente (dinero, legal, confianza) | | |
| Importante | | |
| Detalle | | |

Lo que yo pondría arriba, de lo ya visto en el código: **Libro de Reclamaciones**, **quitar "Inspección vehicular oficial"**, **un solo tiempo de entrega verdadero**, **PDF prometido que no está**, **recuperar contraseña**, **los dos caminos de pago** (vista previa frente a Yape) y **razón social + RUC + política de reembolso**.
