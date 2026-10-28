# Pedernal ERP: instrucciones para trabajar en este repositorio

Idioma: español rioplatense. El dueño define el negocio y no programa; la calidad técnica es responsabilidad
del ingeniero. Las decisiones están en el repositorio `Pedernal-docs` (ADR 001 a 008 y casos de uso).

## Antes de entregar

- Correr `npm run gate` (tipos, lint, formato, arquitectura, código muerto, pruebas). Debe pasar completo.
- Cambios mínimos y enfocados; no inventar librerías ni APIs; avisar antes de sumar una dependencia.
- Si tocás `apps/web/ui`, corré también `npm run test:componentes` (Chromium real: axe, foco y envío; el CI lo corre en el job
  `componentes`). Un entorno que ya trae su propio Chromium lo indica con `PEDERNAL_NAVEGADOR=<ruta del ejecutable>`.
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
  `primitivas/`, el `publico.ts` del módulo). Un mismo límite o cálculo no se escribe en dos lugares.
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
