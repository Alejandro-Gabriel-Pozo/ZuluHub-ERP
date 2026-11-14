# Pedernal ERP: instrucciones para trabajar en este repositorio

Idioma: español rioplatense. El dueño define el negocio y no programa; la calidad técnica es responsabilidad
del ingeniero. Las decisiones están en el repositorio `Pedernal-docs` (ADR 001 a 008 y casos de uso).

## Antes de entregar

- Correr `npm run gate` (tipos, lint, formato, arquitectura, código muerto, pruebas). Debe pasar completo.
- Cambios mínimos y enfocados; no inventar librerías ni APIs; avisar antes de sumar una dependencia.
- Si tocás `apps/web/ui`, corré también `npm run test:componentes` (Chromium real: axe, foco y envío; el CI lo corre en el job
  `componentes`). Un entorno que ya trae su propio Chromium lo indica con `PEDERNAL_NAVEGADOR=<ruta del ejecutable>`.
- Si tocás `apps/web`, corré también `npm run test:recorrido` (app real, Chromium y Postgres; necesita `npm run build:web` hecho). Previene: un `Boton`
  sin `"use client"` rompe «Emitir» en el navegador (React #441) y ninguna prueba unitaria lo ve; lo cubre el job `recorrido` del Gate.
- Una regla nueva de arquitectura trae su violación inyectada en `test/arquitectura/reglas.test.ts`.

## Reglas que no se negocian

- **Variables de entorno y secretos: nunca se escriben valores acá.** Las maneja el dueño en Vercel y Neon.
  El código solo declara y valida nombres.
- Dinero: nunca `number` para importes; texto decimal en la frontera (ADR-006).
- La herramienta de acceso a datos solo se importa en `src/adaptadores/postgres` y `src/modulos/*/persistencia`.
- Los dominios no importan Zod, React ni Next. Entre módulos se entra solo por `publico.ts`.
- Todo cambio de datos: transacción, idempotencia, aislamiento por empresa, auditoría en la misma transacción.
- Migraciones: SQL revisado; avisar antes de cualquier cambio destructivo.
- No hacer commit de `.env`, claves ni cadenas de conexión.
- **Todo nace cerrado (denegar por defecto).** Nada se habilita sin declararlo, autorizarlo y dejar rastro; ante un error o una duda el
  sistema cierra (fail closed). Las capacidades son opt-in, con el mínimo privilegio y lista blanca: solo pasa lo declarado. Ejemplos: un
  módulo «en desarrollo» no da permisos a nadie; sin sucursal elegida nunca se asume «todas»; la barra que no puede leer permisos no
  muestra la entrada. La validación de un dato declara lo que se PERMITE (conjunto, largo, forma), nunca lo que se prohíbe: lo que nadie pensó en
  prohibir pasa (caso real: `/\p{Cc}/u` en `datos-fiscales.ts` solo rechaza controles y deja pasar invisibles y `<>`). Chequeo:
  `test/arquitectura/lista-de-permitidos.test.ts`, con una violación inyectada por cada forma (`lista-de-permitidos-evasiones.test.ts` y
  `reglas.test.ts`); lo existente es deuda con vencimiento (`validacion-de-datos--*` en `arquitectura/deuda/registro.json`) y presupuesto por
  archivo que solo baja (`arquitectura/deuda/validacion-de-datos.json`). Lo que no puede analizar cuenta (fail-closed). Límites que NO ve: la lista completa, con el ejemplo que pasa
  de cada uno, vive UNA vez, en el encabezado de `test/arquitectura/lista-de-permitidos-apoyo.ts` (es una alarma para errores honestos, no un
  límite de seguridad; lo que ahí figura como límite es deuda a anotar si aparece en el código). No mira las pruebas (`*.test.*`, `test/`): usan estas expresiones como ejemplo. Los formatos de máquinas de terceros
  (`set-cookie.ts`, `saneamiento.ts` de ARCA) están eximidos con lista exacta y cuenta exacta en la prueba (dueño, 2026-11-06, pregunta directa al orquestador; constancia en
  `11-especificaciones/decisiones-del-dueno-2026-11.md` del repo de docs; un archivo nuevo en esa categoría requiere aprobación del dueño).
- **Sin dato registrado no hay campo (dueño, 2026-11-05).** Todo campo de entrada de `apps/web` y `apps/plataforma` es un componente de
  campo con la prop `dato`, y ese dato está en `src/capacidades/datos/registro.ts` (primitiva, propósitos con fuente, consumidores, quién
  lo pone, qué necesita). Un `<input>`, `<textarea>` o `<select>` crudo, un campo sin dato o con un dato no registrado, un consumidor no
  declarado, un dato sin consumidor y sus evasiones (cualquier aparición de `createElement`/`jsx`/`innerHTML`/`dangerouslySetInnerHTML` y afines, alias del componente, tag dinámico o fuera de la lista de permitidos) fallan, en todo el código de las apps, tests incluidos; lo
  existente que no cumple es deuda con vencimiento (`campos-sin-dato--*` en `arquitectura/deuda/registro.json`) y con presupuesto por archivo que
  solo baja (`arquitectura/deuda/campos-sin-dato.json`), no una excepción silenciosa. Previene: la primitiva del CUIT existía y el campo de documento de
  «Emitir» no la usaba (el CUIT quedó escrito como nombre). Chequeo: `test/arquitectura/campos-con-dato.test.ts`, con una violación
  inyectada por cada caso.
- **Cuota de decisiones por PR (dueño, 2026-11-11).** Un PR agrega como máximo 5 decisiones de negocio (`DINERO`, `PERMISOS`, `COMERCIAL`) y 10
  técnicas pendientes de OK, desde la fecha de `arquitectura/decisiones/cuota.json` (`vigente_desde`); `npm run decisiones:verificar --base` falla si se pasa.
  Si se pasa: preguntar al dueño antes de construir, reusar una decisión existente o pedir su excepción (id, fecha y fuente en `excepciones`). Previene:
  sesiones que acumulan decisiones sin consultar (94 pendientes el 11/11/2026). Chequeo: `test/arquitectura/decisiones-cuota.test.ts`.
- **Interfaz sobria (dueño, 2026-10-30).** No agregues textos, etiquetas, avisos ni ayudas visuales por iniciativa propia: usá primero textos ya
  aprobados y, si el control comunica el motivo con su estado y un texto existente, no dupliques la indicación. Ante la ambigüedad, el cambio mínimo,
  reversible y con menos texto, con el supuesto asentado y confirmación antes de ampliar. Una pantalla terminada no se modifica porque muestre una
  acción que el servidor rechazará: mientras valide bien, devuelve el motivo al intentarla, sin replicar reglas del backend ni trabajo por cada
  combinación de estado, sucursal y permiso; solo se toca ante confusión importante, acción peligrosa o mejora explícita de la entrega. Mensaje genérico
  («esta acción no está permitida», «algo ocurrió») antes que uno por acción; lo específico solo si importa.

## Cómo trabajan los agentes: no suponer y alcance cerrado

Decisión del dueño, 2026-10-28. Previene que se construya algo que nadie pidió o que se decida en su nombre. Caso real: un proyecto
anterior cargó funciones y campos de más porque la necesidad y el alcance no estaban definidos, y otro caso acá: la consola de
plataforma tuvo en el menú «Dominios» y «Soporte» sin pantalla aprobada.

- **No supongas.** Si el pedido es ambiguo o falta información, no decidas: devolvé la lista de **preguntas pendientes** al orquestador,
  que se las traduce al dueño. Frená esa parte y seguí solo con lo que no depende de la respuesta.
- **Se pregunta lo que cambia** qué se construye, cómo se comporta, los datos, el dinero, los permisos, los textos que ve el cliente o la
  prioridad. Lo puramente interno (nombre de una función privada, en qué archivo va) sigue la convención que ya existe; si no hay
  convención y la elección tiene consecuencias, se pregunta.
- **Alcance cerrado.** Se hace solo lo pedido. Lo que no está en la lista no se hace: si ves algo más (mejora, riesgo, deuda), anotalo
  en «Hallazgos aparte» sin tocarlo. Entre quedarse corto y agrandar, quedarse corto.
- **Una regla, un lugar.** Antes de crear una función, una regla o una constante, buscá si ya tiene dueño (registro de contratos,
  `primitivas/`, el `publico.ts` del módulo). Un mismo límite o cálculo no se escribe en dos lugares. El largo máximo y el conjunto permitido de un dato viven una
  vez, en su primitiva; dominio, esquemas, pantallas y PDF los importan, y la base solo los copia con una prueba que falla si difieren (caso real: la
  auditoría de columnas halló 37 con la regla en dos lugares y 6 que ya no coincidían). Chequeo: `test/arquitectura/fuente-unica.test.ts` (una
  constante `LARGO_MAXIMO_…` repetida, o su número escrito a mano donde ya la tiene a mano; lo existente, con el mismo presupuesto y la misma
  deuda que arriba; la copia en la base la comprobará el espejo de la base, trabajo aparte). Cuenta el número de una constante `LARGO_…` de una
  primitiva escrito en cualquier archivo (`.max(254)`, `maxLength={254}`, `.slice(0, 254)`, `{1,254}`) y el mismo límite con otro nombre o privado.
  Límites que NO ve (con ejemplo): el número de una constante que no es de una primitiva en un archivo que no la nombra (`motivo.length > 200`
  en `resincronizar-y-ambiente.ts`), una lista de caracteres permitidos repetida en dos archivos y un número calculado (`2 * 150`).
  Los límites de dividir la cuenta (10 por ítems, 12 por porcentaje; dueño, 14/11/2026) viven en `src/primitivas/cuentas/limites-de-division.ts`; escribir su número a mano junto a «parte» o «cuenta» falla en
  `test/arquitectura/fuente-unica-limites-de-division.test.ts` (previene el tope desfasado entre dominio, pantalla y base; la base la compara `test/integracion/salon-division-limites.test.ts`).
- **Lo que el dueño no aprobó lleva su fuente.** Todo texto, rótulo, regla o dato que ve el cliente y que el dueño no aprobó se agrega
  solo si tiene una **fuente verificable** y se cita junto a la clave o la regla (comentario del catálogo o del código) y en la descripción del
  PR: archivo y línea o sección (documento, manual de ARCA, grabación, código) o el mensaje con su fecha, y quién lo decidió. «Lo aprobó el
  backend» o «lo aprobó el orquestador» no es una fuente. Sin fuente verificable no se agrega: va a preguntas pendientes. Caso real: los
  textos de tipos de documento de la pantalla del detalle del facturador figuraban como «aprobados por el backend»; la fuente real era la
  grabación de ARCA (`test/utilidades/arca-grabaciones/corrida1/012-FEParamGetTiposDoc-respuesta-http200.xml`) y hubo que buscarla después.
- Si no podés frenar porque el resto depende de la respuesta, elegí la opción más chica y reversible, marcala **SUPUESTO** en el informe
  con cuánto cuesta revertirla, y no la entregues como definitiva: el orquestador la trata como pregunta pendiente.

## Justificar cada regla, abstracción y convención

Fuente: `Pedernal-docs/01-vision/reglas-transversales.md` §8. El sistema lo construye y mantiene una IA: una regla sin motivo se
obedece igual, se acumula y compite con otras.

- Toda regla, abstracción o convención nueva se justifica por **la ambigüedad que elimina**, **la categoría concreta de fallos que
  previene** o **el coste significativo de agregarla después** (datos, aislamiento, auditoría, idempotencia, migraciones).
- La justificación es **verificable**: nombra el fallo y hay un chequeo mecánico que falla si se la quita (regla de arquitectura con su
  violación inyectada, prueba, debilitamiento propio detectado). Si no se puede chequear en general, se documenta al menos un caso real.
- La justificación va **junto a la regla**, en una línea con el fallo que previene. Sin ensayos.
- Antes de crear una abstracción o pieza común, verificá si otro módulo ya la tiene; se extrae cuando dos módulos reales la necesitan
  (ADR-014), no antes. Si el módulo vecino ya resolvió algo, se reutiliza.
- Al cerrar un tramo, revisá las reglas que sumaste: si perdió su motivo o quedó cubierta por otra, se elimina o se simplifica.

## Infraestructura

- Vercel: proyecto `pedernal-erp` (equipo `alepozod`), región de funciones `gru1`, carpeta raíz del proyecto `apps/web`
  (Next, npm workspaces; el CI la compila sin secretos). Vercel lee `apps/web/vercel.json`. El despliegue sigue
  deshabilitado (`git.deploymentEnabled: false`) hasta que el dueño apruebe el primer despliegue: una prueba
  (`test/arquitectura/vercel-json.test.ts`) falla si se enciende sin cambiar a propósito su constante. La compilación
  nunca migra: las migraciones las aplica el workflow manual `migrar.yml`, con la aprobación del dueño. La guía de
  puesta en marcha es `apps/web/PRIMER-DESPLIEGUE.md`.
- Neon: proyecto `flat-flower-36030007`, rama `production`, región `aws-sa-east-1`, Postgres 18.
