# Puesta en marcha y primer despliegue de Pedernal (guía del dueño y lista de chequeo)

Esta guía es la §6.3 del plan (`Pedernal-docs/11-especificaciones/web-armazon-y-despliegue.md`) completada con lo que
quedó construido en W6 y puesta al día contra `main` el 2026-11-04 (migración requerida `0019`, facturación `disponible`,
flujo «Cargar entorno»). Lo que sigue sin poder comprobarse leyendo código está marcado **NO VERIFICADO**.
**El despliegue automático está encendido SOLO para la rama de Git `preview`** (`git.deploymentEnabled` por rama en
`apps/web/vercel.json`; decisión del dueño, 2026-11-05). `main` (producción) y cualquier otra rama quedan APAGADAS: un push
ahí no publica nada. Encender producción es otra decisión del dueño y el ÚLTIMO paso de esta guía (más abajo, marcado).

**Reglas que valen en todos los pasos**

- Ningún valor de variable, clave ni cadena de conexión pasa por el repositorio, por un chat ni por un informe. Los
  valores los cargás vos en Vercel, en Neon y en los Environments de GitHub. En esta guía solo hay **nombres**.
- Producción y Preview llevan valores **distintos** (otra base, otras claves, otro cliente de Google).
- Vercel **nunca** tiene la cadena del dueño de la base. La compilación **nunca** migra: migra el workflow manual
  `migrar.yml`, con tu aprobación.
- Lo que no se pudo comprobar sin Vercel está marcado **NO VERIFICADO**. Cada uno tiene su chequeo en la sección C.

---

## A. Qué hay listo en el repositorio

| Pieza                                               | Dónde                                                                   | Qué hace                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuración de Vercel                             | `apps/web/vercel.json`                                                  | Región `gru1`, despliegue automático encendido solo para la rama `preview` (`main` y el resto apagadas), un cron diario. Vercel la lee desde la carpeta raíz del proyecto (`apps/web`).                                                                                           |
| Cron de trabajos                                    | `app/api/trabajos/cron`                                                 | Una vez por día (06:17 UTC): encola la reconciliación fiscal, despacha la cola (mails, reintentos) y barre las sesiones. Solo responde con `CRON_SECRET`; sin él, 401 sin cuerpo.                                                                                                 |
| Despacho inmediato                                  | `servidor/despacho-inmediato.ts`                                        | `despacharDespuesDeConfirmar(ids)` y `despacharPorClavesDespuesDeConfirmar` (con `after()` de Next): las acciones que encolan los usan para que salga en segundos; el cron es el respaldo. Hoy solo lo llama emitir un comprobante.                                               |
| Salud                                               | `app/api/salud`                                                         | `{"ok":true}` (200) o `{"ok":false}` (503), sin ningún detalle. Hace un `SELECT 1` con el rol limitado de la aplicación.                                                                                                                                                          |
| Guarda de migración                                 | `src/composicion/guarda-de-migracion.ts`                                | Si la base no tiene la migración que el código necesita (`MIGRACION_REQUERIDA`), toda la app responde «En mantenimiento» (503 con una referencia `PD-…`) en vez de fallar a mitad de una factura. Vuelve sola, a los pocos segundos, apenas se migra.                             |
| Migrar la base                                      | `.github/workflows/migrar.yml`                                          | Workflow manual. `produccion` y `preview` piden tu aprobación; antes de aplicar en producción crea la rama de respaldo `antes-de-<NNNN>` en Neon (si cargaste `NEON_API_KEY` y `NEON_PROJECT_ID`) y después instala la clave de contexto (si cargaste `PEDERNAL_CLAVE_CONTEXTO`). |
| Cargar el entorno de Vercel (lo que se genera solo) | `.github/workflows/cargar-entorno.yml`, `npm run cargar-entorno`        | Workflow manual. Genera y carga en Vercel, como sensibles y sin sobrescribir nada, los secretos que no dependen de vos (sección B.4 bis). `produccion` y `preview` piden tu aprobación.                                                                                           |
| Instalar la clave de contexto                       | `npm run instalar-clave`                                                | Instala en la base la clave con la que se firma el contexto. Idempotente. Lo usa el workflow y también sirve en tu terminal.                                                                                                                                                      |
| Migrar / dar LOGIN a los roles / cargar Vercel      | `npm run migrar -- --ver \| --aplicar \| --preparar-roles [--vercel …]` | Ya existía (tanda 4/5). Ver la sección B.4.                                                                                                                                                                                                                                       |
| Un freno contra encender el despliegue de paso      | `test/arquitectura/vercel-json.test.ts`                                 | Falla si `deploymentEnabled` enciende `main` o cualquier rama que no sea `preview` sin cambiar a propósito la constante `RAMAS_CON_DESPLIEGUE_APROBADO_POR_EL_DUENO` del mismo archivo.                                                                                           |

**Ya está** (verificado contra `main`, 2026-10-22; la facturación, al 2026-11-04): los scripts `npm run plataforma:primer-admin` y
`npm run plataforma:caso` (más `plataforma:baja-admin` y `plataforma:resetear-segundo-factor`), los casos de uso de
plataforma de marca, plan y alta de empresa (M5/M6) y el enchufe de la resolución de hosts a la base
(`apps/web/servidor/fuente-de-puertas.ts` usa la puerta pública REAL: si falta la cadena `PEDERNAL_DB_PUBLICO` el pedido
falla cerrado y la puerta muestra la neutra).

Las pantallas del facturador (comprobantes, emitir, configuración fiscal con certificado de ARCA y puntos de venta) ya están
en la web: figuran en la lista de rutas de `npm run build:web` (verificado 2026-11-04). El módulo `facturacion` está
`disponible` en `src/capacidades/modulos/catalogo.ts` (línea 118-119, «dueño, 2026-11-04, para probarla contra ARCA en
homologación»); **no nace activo para nadie**: la plataforma lo activa empresa por empresa (sección E, paso 5).

**Todavía NO está** (y por eso el primer cliente no puede entrar aún; ver la sección E): lo que depende de vos (rama
`preview` de Neon, Environments de GitHub, proyecto y variables de Vercel, cliente de Google, dominios).

---

## B. Pasos del dueño, en orden

> Cada paso dice qué hacés, dónde y qué tiene que pasar. Los pasos 1 a 5 no tocan la aplicación: se pueden hacer antes
> de que exista ningún despliegue.

### B.1 GitHub: los dos Environments

Settings → Environments → New environment. Dos, con estos nombres exactos:

| Environment  | Revisores obligatorios | Ramas permitidas | Secretos (Environment secrets)                                                                                                  |
| ------------ | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `produccion` | **Vos** (obligatorio)  | solo `main`      | `PEDERNAL_DB_DUENO_DIRECTA` (obligatorio); `PEDERNAL_CLAVE_CONTEXTO`, `NEON_API_KEY`, `NEON_PROJECT_ID` (opcionales, ver abajo) |
| `preview`    | **Vos** (obligatorio)  | solo `main`      | `PEDERNAL_DB_DUENO_DIRECTA` (obligatorio, de la rama `preview` de Neon); `PEDERNAL_CLAVE_CONTEXTO` (opcional, la de Preview)    |

- `PEDERNAL_DB_DUENO_DIRECTA`: la cadena de conexión del **dueño** de esa base, **directa** (en Neon: Connect, y apagar
  «Connection pooling» antes de copiarla). Con el host del pooler (`-pooler`) el workflow se niega a migrar.
- `PEDERNAL_CLAVE_CONTEXTO`: la clave de firma de esa rama, **la misma** que cargás en Vercel para el mismo entorno (B.4).
  Si el Environment no la tiene, el workflow no instala ninguna clave.
- `NEON_API_KEY` y `NEON_PROJECT_ID` (solo `produccion`): para la rama de respaldo `antes-de-<NNNN>` antes de migrar. Sin
  ellos se migra **sin respaldo** y el workflow lo avisa. Si los cargaste y el respaldo falla, **no se migra**.
- Revisá que «Required reviewers» de `produccion` **y de `preview`** sea solo vos (decisión del dueño, 2026-11-04) y que
  «Deployment branches» sea solo `main` en los dos: eso es lo que protege el secreto de verdad.
- Ya existe otro workflow, `migrar-base.yml`, con sus propios Environments (`neon-preview`, `neon-production`) y su
  secreto `PEDERNAL_DB_MIGRACIONES`. Hacen lo mismo que `migrar.yml` sin respaldo ni clave de contexto. Cuando confirmes que
  `migrar.yml` anda, conviene borrar `migrar-base.yml` y esos dos Environments para que haya una sola puerta.

### B.2 Neon: las ramas

Proyecto `flat-flower-36030007`, región `aws-sa-east-1`. Dos ramas persistentes: `production` (la de los clientes) y
`preview` (sin datos de clientes, para las pruebas). **Nunca** ramifiques `preview` desde `production` con datos reales.

### B.3 Aplicar las migraciones (con el workflow, nunca desde Vercel)

Actions → **Migrar (preview y producción)** → Run workflow (siempre desde `main`):

1. Ambiente `preview`, acción `ver`: lista lo aplicado y lo pendiente. No cambia nada.
2. Ambiente `preview`, acción `aplicar`, confirmación `MIGRAR PREVIEW`.
3. Lo mismo en `produccion`: acción `ver`; después `aplicar` con la confirmación `MIGRAR PRODUCCION`. Te llega el pedido de
   aprobación; antes de aprobar, mirá en el registro del paso «Ver qué falta aplicar» qué se va a aplicar.

**Permiso de la guarda:** la guarda de migración lee de la tabla `migracion` solo la columna `nombre`, con el rol
`pedernal_app`. Ese permiso lo da la migración **0013** (permisos mínimos, `GRANT SELECT (nombre) ON migracion`): hasta que se
aplique en una base, esa base muestra «En mantenimiento» aunque todo esté bien. Por eso aplicá **todas las migraciones
pendientes, hasta la `0019`**, en `preview` y en `produccion` **antes** de encender el despliegue. `MIGRACION_REQUERIDA`
del código vale `"0019"` (`src/composicion/guarda-de-migracion.ts`, línea 19) y una prueba la mantiene igual a la última
de `migraciones/` (`0019_contacto_de_la_sucursal.sql`): si esta guía dice otra cosa, manda el código. «Ver» del workflow
te dice qué falta.

### B.4 Roles de la base y variables de Vercel

`LOGIN` y contraseña de los roles `pedernal_app`, `pedernal_trabajos`, `pedernal_publico` y `pedernal_autenticacion`, **en cada
rama de Neon** (`preview` y `production`). El comando que ya existe lo hace y, con `--vercel`, escribe las contraseñas
directamente en las variables de Vercel (tipo sensible), sin mostrártelas:

```text
# En tu terminal (nunca en un archivo del repositorio). Las dos variables van cargadas en la terminal:
#   PEDERNAL_DB_MIGRACIONES = la cadena DIRECTA del dueño de la rama (la misma que el secreto de B.1)
#   PEDERNAL_VERCEL_TOKEN   = un token de Vercel con alcance al equipo «alepozod» y vencimiento corto
npm run migrar -- --preparar-roles --con-autenticacion --vercel preview
npm run migrar -- --preparar-roles --con-autenticacion --vercel production --confirmo production
```

Dos avisos importantes:

- `--preparar-roles` **también aplica las migraciones pendientes** (es parte de lo que hace). En producción, corré primero el
  workflow (B.3: aprobación y respaldo) y recién después este comando, que ya no va a encontrar nada pendiente.
- **No uses `--secretos` para la clave de contexto** (el workflow de B.4 bis sí la instala bien). Ese modo genera `PEDERNAL_CLAVE_CONTEXTO` y la carga en Vercel como
  sensible (no se puede volver a leer) y **no la instala en la base**: sin la clave instalada en `contexto_clave`, la base
  rechaza todo contexto firmado. En su lugar, generá la clave vos y usala en los dos lados:
  1. En tu terminal: `node -e "console.log('1:' + require('node:crypto').randomBytes(32).toString('hex'))"` (formato
     `<kid>:<64 dígitos hexadecimales>`). Es un secreto: no lo pegues en ningún chat ni archivo.
  2. Cargala como `PEDERNAL_CLAVE_CONTEXTO` en Vercel (el entorno que corresponda) **y** como secreto
     `PEDERNAL_CLAVE_CONTEXTO` del Environment de GitHub (`produccion` o `preview`).
  3. Corré `migrar.yml` con `aplicar`: instala esa clave en la base de esa rama. Para rotarla, se genera una con otro `kid`
     (`2:…`) y se repite; la anterior queda instalada hasta que se la retire.

### B.4 bis Cargar de una vez las variables que se generan solas (workflow, sin terminal)

El workflow **Cargar entorno (preview y producción)** genera al azar y carga en Vercel (como **sensibles**, solo en el entorno
elegido) las variables que no dependen de vos: `PEDERNAL_SECRETO_INVITACIONES`, `PEDERNAL_AUTH_SECRETO_EMPRESA`, `CRON_SECRET`,
`PEDERNAL_CLAVE_CERTIFICADOS` y `PEDERNAL_CLAVE_CONTEXTO`. No muestra ningún valor: ni en el registro, ni en el informe, ni a vos.

- **Lo que cargás UNA vez** (Settings → Environments → cada Environment → Secrets): `PEDERNAL_VERCEL_TOKEN`, un token de Vercel con
  alcance al equipo `alepozod` y vencimiento corto. `PEDERNAL_DB_DUENO_DIRECTA` ya lo cargaste en B.1. El proyecto y el equipo de
  Vercel no son secretos y están en el código: no hay variables que cargar.
- **Cómo se corre**: Actions → Cargar entorno (preview y producción) → Run workflow (siempre desde `main`). Elegís el ambiente y
  escribís `CARGAR PREVIEW` o `CARGAR PRODUCCION`. Te llega el pedido de aprobación en los dos ambientes (revisor obligatorio en `preview` y en `produccion`), igual que en
  `migrar.yml`. La casilla «dar LOGIN a los roles» viene **apagada** por defecto (`default: false` en `cargar-entorno.yml`): sin tildarla,
  el flujo solo CREA en Vercel lo que falta y no borra ni cambia nada. Las cadenas `PEDERNAL_DB_APP`, `PEDERNAL_DB_TRABAJOS`,
  `PEDERNAL_DB_PUBLICO` y `PEDERNAL_DB_AUTENTICACION` **no** las genera «Cargar entorno»: las carga esa casilla (tildada) o el
  comando de B.4 desde tu terminal. Sin ellas la app no sirve.
  La casilla opcional «dar LOGIN a los roles» **cambia y BORRA cosas**: hace antes lo de B.4 (`--preparar-roles
--con-autenticacion --vercel`) sin mostrar contraseñas, y eso (1) da LOGIN a los roles con contraseñas **nuevas**, (2) **borra**
  de Vercel, en ese entorno, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, todo `POSTGRES_*`, todo `BETTER_AUTH_*`, `AUTH_SECRET`,
  `AUTH_URL` y `PEDERNAL_DB_MIGRACIONES` (si una vale también para el otro entorno, solo se le quita este) y (3) el comando
  **aplica las migraciones pendientes**, sin la rama de respaldo de `migrar.yml`. Por eso el workflow se corta antes si hay
  migraciones pendientes (corré primero `migrar.yml`); una que apareciera justo en el medio se aplicaría igual. Si una carga de
  contraseñas falla a la mitad, las que no llegaron a Vercel **no se muestran**: hay que repetir con `--rotar` desde tu terminal.
  El workflow comparte el grupo de concurrencia `migrar-<ambiente>` con `migrar.yml`: no corren a la vez para el mismo entorno
  (GitHub guarda una sola corrida en espera por grupo).
- **Nunca sobrescribe.** Si una variable ya existe en Vercel para ese entorno (se mira por nombre), la saltea y dice «ya existía».
  Repetir el workflow es seguro. `PEDERNAL_CLAVE_CERTIFICADOS` **no se puede rotar** (cambiarla deja ilegibles los certificados
  cargados) y, como nadie la ve, **no queda copia** (decisión del dueño, 2026-11-04): si se borra de Vercel, se repite el trámite
  del certificado.
- **La clave de contexto** se instala primero en la base de esa rama y recién después se carga en Vercel; si la instalación falla,
  no se carga. Si la base **ya tiene** una clave y Vercel no tiene `PEDERNAL_CLAVE_CONTEXTO`, el workflow **se detiene sin cambiar
  nada**: no la copia a Vercel ni genera otra (reemplazarla dejaría a la aplicación sin poder firmar). Lo decidís vos (cargar a mano la que tengas guardada, o
  rotar con otro `kid`, como en B.4). Sin `PEDERNAL_DB_DUENO_DIRECTA` en el Environment, esta clave queda para vos y las otras se cargan igual.
  Si la clave quedó instalada en la base pero Vercel no la aceptó, el informe lo dice y la corrida siguiente se detiene por lo
  mismo: también lo decidís vos.
  Con este flujo el secreto `PEDERNAL_CLAVE_CONTEXTO` del Environment de GitHub (B.1) no hace falta: si lo tenés, borralo,
  porque `migrar.yml` intentaría instalar ese valor con el mismo `kid 1` y fallaría.
- **Lo que sigue siendo a mano** (el workflow solo dice si ya está o falta, por nombre): `PEDERNAL_RESEND_API_KEY`,
  `PEDERNAL_CORREO_REMITENTE`, `PEDERNAL_NOMBRE_DE_MARCA`, `PEDERNAL_URL_BASE`, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
- **Lo que informa**: una lista de nombres con «creada» o «ya existía», las de arriba, y cuáles de «Lo que NO debe existir» (B.5)
  están en el entorno. El flujo no borra nada de eso (la casilla de los roles sí, porque es lo que hace el comando de B.4). La
  corrida termina en rojo mientras quede algo sin cargar o algo prohibido en el entorno.
- **La protección real de los secretos es configuración de GitHub que el código no puede verificar.** Revisala en Settings →
  Environments: **«Deployment branches: solo `main`» en AMBOS Environments** (`preview` y `produccion`) y **revisor obligatorio
  (vos) en AMBOS** (decisión del dueño, 2026-11-04: `preview` también lleva revisor). Sin ese revisor, quien tenga permiso de
  escritura en el repositorio y corra el workflow desde `main` lo dispararía sin aprobación, con el token de Vercel y la cadena
  del dueño de la base de ese Environment. El token de Vercel es **de equipo** (alcance a `alepozod`): un token cargado en `preview` también puede escribir en Production; por eso conviene
  vencimiento corto y revisar quién tiene acceso al repositorio.
- **NO VERIFICADO**: que Vercel rechace (409) crear una variable que ya existe cuando no se pide `upsert`. El Vercel de las
  pruebas lo hace; en el primer uso real, el informe lo va a decir si no.

### B.5 Variables de entorno de Vercel (solo nombres)

Settings del proyecto `pedernal-erp` → Environment Variables. **Production** y **Preview** con valores distintos. La lista
sale de `NOMBRES_DE_ENTORNO` en `src/composicion/entorno.ts` (verificada contra `main` el 2026-11-04: son **exactamente
estas 15**) y la columna «Quién la carga» sale de `VARIABLES_GENERABLES` y `VARIABLES_A_MANO`
(`src/adaptadores/vercel/`) y de lo que escribe `--preparar-roles`:

| Nombre                          | Para qué                                                                                        | Quién la carga                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `PEDERNAL_CLAVE_CONTEXTO`       | Firmar el contexto; la misma clave se instala en `contexto_clave` de esa rama                   | Vos (B.4, a mano) o workflow (B.4 bis)              |
| `PEDERNAL_SECRETO_INVITACIONES` | Firmar los enlaces de invitación                                                                | Workflow (B.4 bis), `--secretos` o a mano           |
| `PEDERNAL_CLAVE_CERTIFICADOS`   | Cifrar claves de ARCA (`<kid>:<64 hex>`, distinta de la de contexto). Solo la pide lo fiscal    | Vos (B.4, a mano) o workflow (B.4 bis)              |
| `PEDERNAL_RESEND_API_KEY`       | Mandar mails (Resend)                                                                           | Vos                                                 |
| `PEDERNAL_CORREO_REMITENTE`     | Remitente de los mails                                                                          | Vos                                                 |
| `PEDERNAL_NOMBRE_DE_MARCA`      | Nombre que firma el mail hasta que existan los mails por marca                                  | Vos                                                 |
| `PEDERNAL_URL_BASE`             | Origen de los enlaces del mail (por ejemplo, el host de la app del entorno)                     | Vos                                                 |
| `PEDERNAL_DB_APP`               | Cadena **con pooler** del rol `pedernal_app`                                                    | Comando de roles (B.4) o casilla de roles (B.4 bis) |
| `PEDERNAL_DB_TRABAJOS`          | Cadena con pooler del rol `pedernal_trabajos`                                                   | `--preparar-roles --vercel`                         |
| `PEDERNAL_DB_PUBLICO`           | Cadena con pooler del rol `pedernal_publico` (resolver la marca por host)                       | `--preparar-roles --vercel`                         |
| `PEDERNAL_DB_AUTENTICACION`     | Cadena con pooler del rol `pedernal_autenticacion`                                              | `--preparar-roles --con-autenticacion --vercel`     |
| `PEDERNAL_AUTH_SECRETO_EMPRESA` | Secreto de la sesión de la app de empresa (texto largo al azar)                                 | Workflow (B.4 bis) o vos                            |
| `GOOGLE_CLIENT_ID`              | Cliente OAuth de Google (uno para Production y otro para Preview)                               | Vos                                                 |
| `GOOGLE_CLIENT_SECRET`          | Ídem                                                                                            | Vos                                                 |
| `CRON_SECRET`                   | Autoriza la llamada del cron de Vercel. **Al menos 16 caracteres y 10 distintos**, sin espacios | Workflow (B.4 bis) o vos (al azar, largo)           |

Las de sistema (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`) las pone Vercel; no las cargues.

Diferencias con el plan, para que no te sorprendan: (1) `CRON_SECRET` no estaba declarada en el código; W6 la sumó a
`entorno.ts` con su validación (≥ 16 caracteres) y su prueba. (2) `PEDERNAL_CLAVE_CERTIFICADOS` (cifrado de las claves de
ARCA y de sus tickets) la declara el cableado fiscal. Solo hace falta cuando se use la facturación (el módulo es «disponible»
desde 2026-11-04, pero no nace activo: lo activa la plataforma empresa por empresa): sin ella la web arranca y lo fiscal falla cerrado. Se genera con SU PROPIO comando (abajo), una por entorno, y **no
puede ser la de contexto** (ni tener sus mismos bytes): la composición la rechaza. (3) La cadena de `pedernal_captacion`
(`PEDERNAL_DB_CAPTACION`) la crea el comando con un nombre provisorio pero la aplicación todavía no la usa: no la cargues.

#### La clave de los certificados (`PEDERNAL_CLAVE_CERTIFICADOS`)

- **Decisión del dueño, 2026-11-04: se genera por el workflow de B.4 bis, sin copia.** Nadie la ve, así que no hay copia posible
  (ver «Si la perdés»). Si alguna vez se prefiere generarla a mano, con su propio comando, distinto del de la de contexto, y
  cargarla solo en Vercel (el entorno que corresponda) guardando la copia:
  `node -e "console.log('c1:' + require('node:crypto').randomBytes(32).toString('hex'))"` (formato `<kid>:<64 dígitos
hexadecimales>`; el `kid` es un texto corto de letras o números). Es un secreto: no lo pegues en ningún chat ni archivo.
- **No puede ser la de contexto.** `PEDERNAL_CLAVE_CONTEXTO` se instala en la base (`contexto_clave`): si la de los
  certificados fuera la misma, quien lea esa tabla descifraría las claves de ARCA y el cifrado en reposo no serviría. La
  composición rechaza una clave con los mismos bytes que la de contexto, y también una con muy pocos caracteres distintos
  (la misma exigencia que `CRON_SECRET`: 10), como `000…0`.
- **Todavía NO se puede rotar.** La composición pasa solo la clave activa, sin claves anteriores: cambiar el valor (o el
  `kid`) deja ilegibles los certificados y los tickets ya guardados, y hay que volver a cargarlos.
- **Si la perdés, perdés los certificados cargados.** No hay forma de recuperarlos sin la clave: si la generaste a mano,
  guardá una copia en tu gestor de secretos antes de cargar el primer certificado. Con el workflow no hay copia (decisión del
  dueño, 2026-11-04): si se borra de Vercel se repite el trámite del certificado. Rotarla (aceptar claves anteriores para descifrar) es una tarea
  pendiente.
- **El despacho inmediato (`after()`) espera el trabajo completo** (una autorización de ARCA puede tardar hasta 25 s, más
  el login de WSAA de hasta 20 s). Para que la plataforma no lo corte antes, la página que aloje las acciones de facturación
  tiene que declarar `maxDuration` (Next: «se fija a nivel de página para todas las Server Actions de esa página»). **Ya hay
  pantallas que las usan** (`/s/app/facturacion/comprobantes/emitir` y las de anular y configuración fiscal) y hoy **ninguna
  declara `maxDuration`**: solo lo declara la ruta del cron (`apps/web/app/api/trabajos/cron/route.ts`, 60). Con el límite
  por defecto del plan de Vercel una autorización lenta de ARCA podría cortarse a mitad de camino: **NO VERIFICADO** (depende
  del plan; ver G.11). Para la prueba de homologación, mirá el registro si una emisión queda «pendiente».

#### Lo que NO debe existir (ni en Production ni en Preview)

Las cuatro primeras viñetas (`BETTER_AUTH_*`, `AUTH_*`, `DATABASE_URL*` y `POSTGRES_*`) hacen que la aplicación **no arranque**
(falla cerrado: lista de variables prohibidas y prefijo prohibido de `src/composicion/entorno.ts`). Las dos últimas (la cadena
del dueño y los roles que la web no recibe) **no las rechaza la web**: son regla de despliegue y el informe de «Cargar entorno»
las avisa por nombre. El comando de B.4 (y la casilla de roles) borra de Vercel las prohibidas y `PEDERNAL_DB_MIGRACIONES`;
**no** borra `PEDERNAL_DB_DUENO_DIRECTA`, `PEDERNAL_DB_PLATAFORMA` ni `PEDERNAL_DB_GRUPO` (el código solo las avisa,
`src/adaptadores/vercel/plan-de-variables.ts`): si aparecen, las sacás vos.

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_TELEMETRY`,
  `BETTER_AUTH_TELEMETRY_ENDPOINT`, `BETTER_AUTH_TELEMETRY_ID`
- `AUTH_SECRET`, `AUTH_URL`
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
- todo lo que empiece con `POSTGRES_` (la integración de Neon con Vercel las inyecta: **no la instales**)
- la cadena del dueño de la base (`PEDERNAL_DB_MIGRACIONES` o `PEDERNAL_DB_DUENO_DIRECTA`): vive solo en GitHub y en tu terminal
- `PEDERNAL_DB_PLATAFORMA` y `PEDERNAL_DB_GRUPO`: la web no recibe esos roles

### B.6 Vercel: el proyecto

Proyecto `pedernal-erp` (equipo `alepozod`):

1. **Root Directory = `apps/web`** (el dueño lo confirma **antes** del merge a `main`: es lo que hace que Vercel lea
   `apps/web/vercel.json` y que `main` y las demás ramas, apagadas de verdad, no publiquen nada) y activado «Include source files outside of the Root Directory in the Build Step»
   (la función necesita `src/` y `migraciones/`, que viven afuera). Vercel lee `apps/web/vercel.json` desde ahí.
2. **Node.js Version = 24** (Settings → Build and Deployment).
3. **Región de funciones = `gru1`** (también la declara `vercel.json`).
4. **Deployment Protection**: «Vercel Authentication» (Standard) para los previews.
5. El comando de instalación lo fija `apps/web/vercel.json` (`cd ../.. && npm ci --ignore-scripts`, desde la raíz del
   repositorio): con Root Directory `apps/web` Vercel instalaba solo el workspace y la compilación fallaba con «Module not
   found» (primer despliegue, 2026-11-05). **No lo cargues a mano en el panel** (Install Command): el archivo lo pisa y el
   panel puede quedar en el predeterminado. El de compilación queda el predeterminado. Si esto dejara de funcionar, ver el plan B (sección D).
6. Las variables de B.5 cargadas. **Ninguna** de la lista «no debe existir».

### B.7 Dominios y DNS

En Vercel (Domains) y en el DNS de `pedernal.com.ar`:

| Host                         | Superficie           | Nota                                                     |
| ---------------------------- | -------------------- | -------------------------------------------------------- |
| `pedernal.com.ar`            | landing              | indexable en producción                                  |
| `www.pedernal.com.ar`        | —                    | redirección 308 a `pedernal.com.ar`                      |
| `app.pedernal.com.ar`        | app                  | nunca indexable; dirección de retorno de Google          |
| `app-prueba.pedernal.com.ar` | app (base `preview`) | dominio fijo de prueba para Google (no acepta comodines) |

`*.vercel.app` siempre muestra la página neutra. No agregues `carta.pedernal.com.ar` todavía (es de la etapa 2). **Además**,
cada host tiene que estar **registrado como dato** en la base de esa rama (sin eso, la puerta muestra la neutra aunque el DNS
esté bien): eso lo hace el caso de plataforma `agregarDominio` (sección E, pendiente).

### B.8 Google (inicio de sesión)

Un cliente OAuth para Production y otro para Preview. Dirección de retorno autorizada (la ruta por defecto de la
librería, **NO VERIFICADO** hasta probarlo con Google real): `https://app.pedernal.com.ar/api/auth/callback/google` en
Production y `https://app-prueba.pedernal.com.ar/api/auth/callback/google` en Preview.

### B.9 Un despliegue de prueba, sin encender el automático

Un push a `preview` publica un despliegue de _preview_ solo (es la única rama encendida); un push a `main` o a cualquier otra no
publica nada. Para una URL de prueba sin tocar `preview`, también se puede crear **a mano** un despliegue de _preview_ (no de producción) con la CLI de Vercel, desde la raíz del
repositorio: `npx vercel deploy` (usa el Root Directory del proyecto). **NO VERIFICADO**: es la forma esperada; si Vercel pide
otra cosa, el chequeo 1 de la sección C lo dirá. Después, la sección C.

### B.10 ÚLTIMO PASO: pedir la aprobación para encender el despliegue

> **No hagas este paso hasta que todos los chequeos de la sección C estén bien y la sección E esté resuelta.**
>
> Se le pide a quien mantiene el código que sume `main` a `git.deploymentEnabled` (con valor `true`) en `apps/web/vercel.json`, y a
> la vez `"main"` a la constante `RAMAS_CON_DESPLIEGUE_APROBADO_POR_EL_DUENO` en `test/arquitectura/vercel-json.test.ts` (si no,
> el CI no deja pasar el cambio). Ese cambio es **tuyo** de aprobar: sin tu visto bueno explícito, no se hace. Después, el primer push a `main`
> publica en producción.

### B.11 Verificación después de mergear el cambio que enciende solo `preview`

1. Tras el merge a `main`, entrá a Vercel → proyecto `pedernal-erp` → Deployments y comprobá que **NO aparezca un despliegue
   nuevo de `main`**. Si aparece, apagá el despliegue automático desde Settings (Git) y avisá antes de seguir: la regla
   `"**": false` no se está respetando.
2. Un push a `preview` sí debe crear un despliegue de _preview_.
3. Recomendado: proteger la rama `preview` en GitHub (regla de rama o conjunto de reglas) para que nadie la borre ni la
   reemplace. Es la única rama que publica: quien pueda empujar a `preview` publica en `app-prueba.pedernal.com.ar`.

---

## C. Lista de chequeo del primer despliegue (con `curl`, sin secretos en ningún lado)

`<URL>` es la del despliegue de prueba (B.9). Para los pedidos que llevan secreto, cargalo antes en la terminal **sin
mostrarlo** (por ejemplo `read -rs CRON_SECRET; export CRON_SECRET`) y no lo copies a ningún lado.

| #   | Qué se comprueba                                                                               | Cómo                                                                                                                                                                                                                                                                                                        | Resultado esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Forma del repositorio**: Vercel instaló y compiló el workspace                               | El despliegue de B.9 termina en «Ready»; mirá el registro de la compilación                                                                                                                                                                                                                                 | Compila `apps/web` y la función incluye `src/`. Si falla: plan B (sección D)                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | **Node 24** y **región `gru1`**                                                                | En el despliegue (Functions / Settings), mirá la versión de Node y la región                                                                                                                                                                                                                                | Node 24 y `gru1`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | **Qué cabecera trae el host**                                                                  | `curl -sI -H 'Host: otro.com' <URL>/`                                                                                                                                                                                                                                                                       | 404 neutro, `x-robots-tag: noindex`, sin `set-cookie` ni `x-powered-by`. Anotá qué cabeceras de host reenviadas aparecen                                                                                                                                                                                                                                                                                                                                                    |
| 4   | **`x-pd-*` y el host reenviado no pisan `host`**                                               | `curl -sI -H 'x-pd-marca: x' -H 'X-Forwarded-Host: otra.com' <URL>/`                                                                                                                                                                                                                                        | La misma respuesta que sin esas cabeceras                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | **HSTS**                                                                                       | `curl -sI https://<dominio>/`                                                                                                                                                                                                                                                                               | Trae `strict-transport-security` (la pone la aplicación; si Vercel agrega la suya, no se duplica con un valor distinto)                                                                                                                                                                                                                                                                                                                                                     |
| 6   | **Archivos y rutas sueltas**                                                                   | `/favicon.ico`, `/robots.txt`, `/api/auth/x` en un host sin registrar                                                                                                                                                                                                                                       | La misma neutra (404), nunca un archivo                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | **Previews = página neutra**                                                                   | Abrí la URL `*.vercel.app` en el navegador                                                                                                                                                                                                                                                                  | La página neutra, sin ninguna marca                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | **Salud**                                                                                      | `curl -si <URL>/api/salud` (funciona con cualquier host, también `*.vercel.app`)                                                                                                                                                                                                                            | 200 con `{"ok":true}` (o 503 con `{"ok":false}` si la base no responde); sin cookies y con `cache-control: private, no-store`                                                                                                                                                                                                                                                                                                                                               |
| 9   | **Cron sin secreto**                                                                           | `curl -si <URL>/api/trabajos/cron`                                                                                                                                                                                                                                                                          | **401**, sin cuerpo                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | **Cron autorizado**                                                                            | `curl -si -H "Authorization: Bearer $CRON_SECRET" <URL>/api/trabajos/cron`                                                                                                                                                                                                                                  | **200** con cuentas (`despacho`, `barrido`). **NO VERIFICADO**: que _Vercel_ mande el secreto así cuando corre solo. Mirá el registro del primer cron (Vercel → Logs → Cron) y confirmá un 200, no un 401                                                                                                                                                                                                                                                                   |
| 11  | **Mantenimiento**                                                                              | Con la base sin la migración requerida (por ejemplo, el despliegue antes de aplicar una migración nueva): abrí `/`                                                                                                                                                                                          | «En mantenimiento» (503) con una referencia `PD-XXXX-XXXX`; la referencia aparece en el registro del servidor. Apenas migrás, vuelve sola                                                                                                                                                                                                                                                                                                                                   |
| 12  | **La salud y el cron siguen en mantenimiento**                                                 | Con la base atrasada: `/api/salud` y el cron                                                                                                                                                                                                                                                                | Responden igual que siempre (no quedan atrás del mantenimiento)                                                                                                                                                                                                                                                                                                                                                                                                             |
| 13  | **Ningún otro `/api/**` se abrió\*\*                                                           | `curl -si -H 'Host: otro.com' <URL>/api/otra` y `<URL>/api/trabajos/cron/x`                                                                                                                                                                                                                                 | 404 neutro                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 14  | **La IP de confianza llega y no se deja falsificar** (`x-vercel-forwarded-for`, NO VERIFICADO) | Pedí el inicio de sesión de dos maneras y mirá el registro de la función (Vercel → Logs): (a) normal, `curl -si -X POST -H 'content-type: application/json' -d '{"provider":"google","callbackURL":"/"}' <URL>/api/auth/sign-in/social`; (b) igual pero con `-H 'x-vercel-forwarded-for: 1.1.1.1, 2.2.2.2'` | En (a) y en (b) **no** aparece el aviso «falling back to a single shared per-path bucket». Si aparece en (a), el encabezado no llega; si aparece en (b), Vercel **no** lo pisa y un cliente lo falsifica. En cualquiera de los dos casos NO se enciende: se pasa a `x-real-ip` o `x-forwarded-for` (Vercel documenta que los pisa) cambiando `ENCABEZADO_DE_IP`. Nunca se registra ni se copia el valor de la IP; solo se anota si el encabezado llegó y con un único valor |
| 15  | **Ingreso con Google sin JavaScript** (`form-action 'self'`, NO VERIFICADO)                    | En Chrome con JavaScript desactivado (Configuración → Privacidad y seguridad → Configuración de sitios → JavaScript → No permitir), tocá «Ingresar con Google» en el despliegue de prueba                                                                                                                   | Te lleva a `accounts.google.com`. Si Chrome lo bloquea por la política `form-action 'self'` (consola: «Refused to send form data»), se anota y se ajusta la política en un cambio aparte; con JavaScript el ingreso anda igual                                                                                                                                                                                                                                              |

---

## D. Plan B si Vercel no entiende el workspace

El chequeo 1 se resuelve con `installCommand` desde la raíz (B.6 punto 5). Este plan B queda solo como alternativa si eso dejara de
funcionar: si el chequeo 1 falla porque Vercel no instala desde la raíz o no resuelve `src/` fuera de `apps/web` (plan B del plan,
§5.1): sin Root Directory propio. En Vercel, Root Directory = `.` (la raíz); `vercel.json` vuelve a la raíz **y** el comando de
compilación pasa a `next build apps/web` (con `installCommand` el predeterminado). Es un cambio chico de `vercel.json` y de la
prueba `vercel-json.test.ts` (que hoy exige el archivo en `apps/web`). **NO se hizo por adelantado** porque no se pudo probar
sin Vercel y no se inventa lo que no se verifica.

---

## E. Alta de la primera empresa (runbook, §6.3) y qué falta

Orden, cuando todo lo anterior ande:

1. Rama `production` con las migraciones aplicadas por `migrar.yml`, la clave de contexto instalada y `LOGIN` en los roles (B.3–B.4).
2. `crear-primer-admin` con tu email (no puede ser miembro de ninguna empresa).
3. `ejecutar-caso-de-plataforma`: crear el plan por defecto y publicarlo; confirmar la versión 1 de la marca Pedernal; registrar
   `pedernal.com.ar` (landing) y `app.pedernal.com.ar` (app, canónico).
4. Abrir `https://app.pedernal.com.ar`: tiene que mostrar el ingreso con la marca, y un host inventado la página neutra.
5. `altaDeEmpresa` con los datos del cliente → sale el mail al gerente; `activarModuloDeEmpresa` con `facturacion` (el plan de la empresa tiene que incluirla, si no da `MODULO_FUERA_DEL_PLAN`).
6. El gerente sigue el camino de la §1.3 del plan.

Esos scripts se corren en **tu computadora**, no en un workflow de GitHub: los datos del cliente (CUIT, razón social, email)
no tienen que quedar en el registro de una ejecución.

_Excepción para la empresa de PRUEBAS en Preview (2026-11-05, pedido del dueño que no usa terminal)_: el workflow manual
`preparar-empresa-de-pruebas.yml` corre estos pasos sin que los datos pasen por el formulario: salen de un secreto del Environment
`preview` (`PEDERNAL_PREPARAR_PREVIEW`) y se tapan en el registro. Le da login al rol de plataforma solo durante la corrida y lo cierra siempre. Está en borrador: ver su PR.

**Secretos del Environment `preview`** para ese workflow: `PEDERNAL_DB_DUENO_DIRECTA`, `PEDERNAL_SECRETO_INVITACIONES` (hexadecimal, 64 o más dígitos) y
`CRON_SECRET` (24 o más caracteres) —los dos últimos con el MISMO valor que en Vercel Preview, fijados por el dueño, y después un Redeploy de
preview— y `PEDERNAL_PREPARAR_PREVIEW`, un JSON en UNA línea. Plantilla con valores FICTICIOS (`adminEmail` y `emailGerente` tienen que ser
DISTINTOS: el administrador de plataforma no puede ser miembro de ninguna empresa; `vigenteDesde` es un instante FUTURO de 5 a 8 minutos desde la
corrida —la confirmación de la marca no admite una fecha pasada y el alta exige la marca ya vigente, así que el flujo espera a que llegue— y
`verificadoEn`, uno pasado; si el Environment tarda en aprobarse y `vigenteDesde` queda en el pasado, el flujo cierra bien el login y rechaza: se edita el JSON y se repite):

```json
{
  "adminEmail": "admin.ficticio@ejemplo.test",
  "vigenteDesde": "2026-11-06T12:00:00-03:00",
  "marca": { "codigo": "marca-ficticia", "nombreVisible": "Marca Ficticia" },
  "plan": {
    "codigo": "plan-ficticio",
    "nombreComercial": "Plan Ficticio",
    "modulos": ["administracion", "facturacion"],
    "perillas": { "empresas_por_tenant": { "tipo": "LIMITE", "limite": 1 } }
  },
  "dominio": {
    "host": "app-prueba.pedernal.com.ar",
    "titular": "OPERADOR",
    "verificadoEn": "2026-11-05T09:00:00-03:00"
  },
  "empresa": {
    "nombreDeTenant": "Cliente Ficticio",
    "cuit": "20123456786",
    "razonSocial": "Empresa Ficticia SRL",
    "zonaHoraria": "America/Argentina/Buenos_Aires",
    "moneda": "ARS",
    "emailGerente": "gerente.ficticio@ejemplo.test"
  }
}
```

**Estado hoy (honesto, 2026-10-22; el último párrafo se actualizó el 2026-11-04):** los scripts del paso 2 y 3 **existen** y se corren con
`npm run plataforma:primer-admin` y `npm run plataforma:caso` (con `node --import ./scripts/cargador-de-ts.mjs`; no hace
falta `tsx`). Los casos de uso de marca, plan y alta de empresa (M5/M6) están en `main`, y la resolución de hosts ya lee la
base. Lo que **sigue sin poder ejecutarse** es todo lo que depende de tus pasos de la sección B (rama `preview`, migraciones
aplicadas por `migrar.yml`, variables y dominios) y la activación del módulo `facturacion` en la empresa (paso 5). Al 2026-11-04 el backend fiscal **sí está cableado a la web**
(rutas `/s/app/facturacion/*` y `/s/app/configuracion-fiscal/*` en el `build:web`), pero el cableado nunca se probó contra
ARCA ni contra una base real: **NO VERIFICADO** hasta la prueba de homologación.

---

## F. Marcha atrás

- **Código**: _Instant Rollback_ de Vercel al despliegue anterior (qué tan atrás deja volver el plan Hobby: **NO VERIFICADO**).
  Como las migraciones son «expandir y contraer», volver el código no obliga a tocar la base.
- **Base**: hacia adelante (una migración nueva que corrige). En una emergencia, la rama de respaldo `antes-de-<NNNN>` de Neon.
  Las reversiones de `migraciones/reversiones/` las aplicás solo vos, con aprobación, y nunca sobre datos de clientes sin
  respaldo.
- **Un dominio**: quitar el registro de dominio como dato (la página neutra en menos de 60 s) antes que tocar el DNS.

---

## G. Lo que no se pudo verificar sin Vercel

1. Que Vercel instale y compile el workspace con Root Directory `apps/web` (chequeo 1): la rama `preview` compiló el 2026-11-05 con el
   `installCommand` cargado a mano en el panel; falta confirmar el mismo resultado leyéndolo desde `vercel.json` (plan B en la sección D).
2. Que el despliegue de prueba de B.9 se pueda crear con la CLI sin depender del automático (que solo cubre la rama `preview`).
3. La versión de Node por defecto, y que `regions` en `vercel.json` valga en el plan Hobby (chequeo 2).
4. Que Vercel mande `Authorization: Bearer <CRON_SECRET>` a la ruta del cron (chequeo 10) y que Hobby acepte el cron diario.
5. Que `maxDuration = 60` de la ruta del cron entre en el límite del plan (si Vercel lo rechaza, se baja).
6. Que Vercel no deje falsificar `host` ni `X-Forwarded-Host` (chequeos 3 y 4).
7. Que los Environments de GitHub con revisores obligatorios funcionen en este repositorio (B.1) y que la API de Neon cree la
   rama de respaldo con la llamada del workflow (se ve en la primera corrida real de `produccion`).
8. La dirección de retorno de Google (B.8).
9. Que `x-vercel-forwarded-for` llegue con un único valor y que Vercel lo pise cuando el cliente manda uno (chequeo 14). Si
   no, la clave del límite de intentos de ingreso es una sola para todos y un poco de tráfico bloquea a todos: no se
   enciende el despliegue hasta resolverlo (plan: `x-real-ip` o `x-forwarded-for`).
10. Que el ingreso con Google sin JavaScript no lo bloquee Chrome por `form-action 'self'` (chequeo 15).
11. El `maxDuration` de la página que aloje las acciones de facturación (el despacho con `after()` espera hasta que ARCA
    responda: autorizar tiene un tiempo límite de 25 s, WSAA de 20 s y WSFE de 15 s). Las pantallas ya existen y ninguna lo
    declara (sección B.5). Qué valor admite el plan de Vercel no se pudo verificar: queda como pregunta pendiente, con 60
    (como el cron) como opción recomendada si el plan lo admite. No se tocó en este cambio (solo documentación).
12. Que el Root Directory `apps/web` y «Include source files outside of the Root Directory» alcancen para `src/` y `migraciones/`
    (ya en G.1): la compilación sin secretos en un clon limpio sí se verificó (`npm ci` y `npm run build:web`, 2026-11-04);
    lo de Vercel no.
