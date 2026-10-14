# Puesta en marcha y primer despliegue de ZuluHub (guía del dueño y lista de chequeo)

Esta guía es la §6.3 del plan (`ZuluHub-docs/11-especificaciones/web-armazon-y-despliegue.md`) completada con lo que
quedó construido en W6. **El despliegue está APAGADO** (`git.deploymentEnabled: false` en `apps/web/vercel.json`) y
**solo el dueño lo enciende**: es el ÚLTIMO paso de esta guía (más abajo, marcado). Hasta entonces, ninguna rama ni
ningún merge publica nada.

**Reglas que valen en todos los pasos**

- Ningún valor de variable, clave ni cadena de conexión pasa por el repositorio, por un chat ni por un informe. Los
  valores los cargás vos en Vercel, en Neon y en los Environments de GitHub. En esta guía solo hay **nombres**.
- Producción y Preview llevan valores **distintos** (otra base, otras claves, otro cliente de Google).
- Vercel **nunca** tiene la cadena del dueño de la base. La compilación **nunca** migra: migra el workflow manual
  `migrar.yml`, con tu aprobación.
- Lo que no se pudo comprobar sin Vercel está marcado **NO VERIFICADO**. Cada uno tiene su chequeo en la sección C.

---

## A. Qué hay listo en el repositorio

| Pieza                                          | Dónde                                                                   | Qué hace                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuración de Vercel                        | `apps/web/vercel.json`                                                  | Región `gru1`, despliegue automático apagado, un cron diario. Vercel la lee desde la carpeta raíz del proyecto (`apps/web`).                                                                                                                                        |
| Cron de trabajos                               | `app/api/trabajos/cron`                                                 | Una vez por día (06:17 UTC): despacha la cola de trabajos (mails, reintentos) y barre las sesiones vencidas. Solo responde con `CRON_SECRET`; sin él, 401 sin cuerpo.                                                                                               |
| Despacho inmediato                             | `servidor/despacho-inmediato.ts`                                        | `despacharDespuesDeConfirmar(ids)` (con `after()` de Next): las acciones que encolan lo usan para que el mail salga en segundos; el cron es el respaldo. Hoy ninguna acción lo llama todavía (no hay acciones que encolen en la web).                               |
| Salud                                          | `app/api/salud`                                                         | `{"ok":true}` (200) o `{"ok":false}` (503), sin ningún detalle. Hace un `SELECT 1` con el rol limitado de la aplicación.                                                                                                                                            |
| Guarda de migración                            | `src/composicion/guarda-de-migracion.ts`                                | Si la base no tiene la migración que el código necesita (`MIGRACION_REQUERIDA`), toda la app responde «En mantenimiento» (503 con una referencia `ZH-…`) en vez de fallar a mitad de una factura. Vuelve sola, a los pocos segundos, apenas se migra.               |
| Migrar la base                                 | `.github/workflows/migrar.yml`                                          | Workflow manual. `produccion` pide tu aprobación; antes de aplicar en producción crea la rama de respaldo `antes-de-<NNNN>` en Neon (si cargaste `NEON_API_KEY` y `NEON_PROJECT_ID`) y después instala la clave de contexto (si cargaste `ZULUHUB_CLAVE_CONTEXTO`). |
| Instalar la clave de contexto                  | `npm run instalar-clave`                                                | Instala en la base la clave con la que se firma el contexto. Idempotente. Lo usa el workflow y también sirve en tu terminal.                                                                                                                                        |
| Migrar / dar LOGIN a los roles / cargar Vercel | `npm run migrar -- --ver \| --aplicar \| --preparar-roles [--vercel …]` | Ya existía (tanda 4/5). Ver la sección B.4.                                                                                                                                                                                                                         |
| Un freno contra encender el despliegue de paso | `test/arquitectura/vercel-json.test.ts`                                 | Falla si `deploymentEnabled` deja de ser `false` sin cambiar a propósito la constante `DESPLIEGUE_APROBADO_POR_EL_DUENO` del mismo archivo.                                                                                                                         |

**Todavía NO está** (y por eso el primer cliente no puede entrar aún; ver la sección E): los scripts `crear-primer-admin` y
`ejecutar-caso-de-plataforma`, los casos de uso de marca/plan/alta de empresa que usarían, y el enchufe de la resolución
de hosts a la base (`apps/web/servidor/fuente-de-puertas.ts` sigue siendo un falso: todo host responde la página neutra).

---

## B. Pasos del dueño, en orden

> Cada paso dice qué hacés, dónde y qué tiene que pasar. Los pasos 1 a 5 no tocan la aplicación: se pueden hacer antes
> de que exista ningún despliegue.

### B.1 GitHub: los dos Environments

Settings → Environments → New environment. Dos, con estos nombres exactos:

| Environment  | Revisores obligatorios | Ramas permitidas | Secretos (Environment secrets)                                                                                                |
| ------------ | ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `produccion` | **Vos** (obligatorio)  | solo `main`      | `ZULUHUB_DB_DUENO_DIRECTA` (obligatorio); `ZULUHUB_CLAVE_CONTEXTO`, `NEON_API_KEY`, `NEON_PROJECT_ID` (opcionales, ver abajo) |
| `preview`    | ninguno                | solo `main`      | `ZULUHUB_DB_DUENO_DIRECTA` (obligatorio, de la rama `preview` de Neon); `ZULUHUB_CLAVE_CONTEXTO` (opcional, la de Preview)    |

- `ZULUHUB_DB_DUENO_DIRECTA`: la cadena de conexión del **dueño** de esa base, **directa** (en Neon: Connect, y apagar
  «Connection pooling» antes de copiarla). Con el host del pooler (`-pooler`) el workflow se niega a migrar.
- `ZULUHUB_CLAVE_CONTEXTO`: la clave de firma de esa rama, **la misma** que cargás en Vercel para el mismo entorno (B.4).
  Si el Environment no la tiene, el workflow no instala ninguna clave.
- `NEON_API_KEY` y `NEON_PROJECT_ID` (solo `produccion`): para la rama de respaldo `antes-de-<NNNN>` antes de migrar. Sin
  ellos se migra **sin respaldo** y el workflow lo avisa. Si los cargaste y el respaldo falla, **no se migra**.
- Revisá que «Required reviewers» de `produccion` sea solo vos y que «Deployment branches» sea solo `main`: eso es lo que
  protege el secreto de verdad.
- Ya existe otro workflow, `migrar-base.yml`, con sus propios Environments (`neon-preview`, `neon-production`) y su
  secreto `ZULUHUB_DB_MIGRACIONES`. Hacen lo mismo que `migrar.yml` sin respaldo ni clave de contexto. Cuando confirmes que
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
`zuluhub_app`. Ese permiso lo da la migración **0013** (permisos mínimos): hasta que se aplique en una base, esa base
muestra «En mantenimiento» aunque todo esté bien. Por eso aplicá 0013 en `preview` y en `produccion` **antes** de encender
el despliegue. `MIGRACION_REQUERIDA` del código vale `"0013"`.

### B.4 Roles de la base y variables de Vercel

`LOGIN` y contraseña de los roles `zuluhub_app`, `zuluhub_trabajos`, `zuluhub_publico` y `zuluhub_autenticacion`, **en cada
rama de Neon** (`preview` y `production`). El comando que ya existe lo hace y, con `--vercel`, escribe las contraseñas
directamente en las variables de Vercel (tipo sensible), sin mostrártelas:

```text
# En tu terminal (nunca en un archivo del repositorio). Las dos variables van cargadas en la terminal:
#   ZULUHUB_DB_MIGRACIONES = la cadena DIRECTA del dueño de la rama (la misma que el secreto de B.1)
#   ZULUHUB_VERCEL_TOKEN   = un token de Vercel con alcance al equipo «alepozod» y vencimiento corto
npm run migrar -- --preparar-roles --con-autenticacion --vercel preview
npm run migrar -- --preparar-roles --con-autenticacion --vercel production --confirmo production
```

Dos avisos importantes:

- `--preparar-roles` **también aplica las migraciones pendientes** (es parte de lo que hace). En producción, corré primero el
  workflow (B.3: aprobación y respaldo) y recién después este comando, que ya no va a encontrar nada pendiente.
- **No uses `--secretos` para la clave de contexto.** Ese modo genera `ZULUHUB_CLAVE_CONTEXTO` y la carga en Vercel como
  sensible (no se puede volver a leer) y **no la instala en la base**: sin la clave instalada en `contexto_clave`, la base
  rechaza todo contexto firmado. En su lugar, generá la clave vos y usala en los dos lados:
  1. En tu terminal: `node -e "console.log('1:' + require('node:crypto').randomBytes(32).toString('hex'))"` (formato
     `<kid>:<64 dígitos hexadecimales>`). Es un secreto: no lo pegues en ningún chat ni archivo.
  2. Cargala como `ZULUHUB_CLAVE_CONTEXTO` en Vercel (el entorno que corresponda) **y** como secreto
     `ZULUHUB_CLAVE_CONTEXTO` del Environment de GitHub (`produccion` o `preview`).
  3. Corré `migrar.yml` con `aplicar`: instala esa clave en la base de esa rama. Para rotarla, se genera una con otro `kid`
     (`2:…`) y se repite; la anterior queda instalada hasta que se la retire.

### B.5 Variables de entorno de Vercel (solo nombres)

Settings del proyecto `zuluhub-erp` → Environment Variables. **Production** y **Preview** con valores distintos. La lista
sale de `src/composicion/entorno.ts` (la verificó W6; coincide con la del plan más `CRON_SECRET`):

| Nombre                         | Para qué                                                                                        | Quién la carga                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `ZULUHUB_CLAVE_CONTEXTO`       | Firmar el contexto; la misma clave se instala en `contexto_clave` de esa rama                   | Vos (B.4, a mano)                               |
| `ZULUHUB_SECRETO_INVITACIONES` | Firmar los enlaces de invitación                                                                | `--secretos` o a mano                           |
| `ZULUHUB_RESEND_API_KEY`       | Mandar mails (Resend)                                                                           | Vos                                             |
| `ZULUHUB_CORREO_REMITENTE`     | Remitente de los mails                                                                          | Vos                                             |
| `ZULUHUB_NOMBRE_DE_MARCA`      | Nombre que firma el mail hasta que existan los mails por marca                                  | Vos                                             |
| `ZULUHUB_URL_BASE`             | Origen de los enlaces del mail (por ejemplo, el host de la app del entorno)                     | Vos                                             |
| `ZULUHUB_DB_APP`               | Cadena **con pooler** del rol `zuluhub_app`                                                     | `--preparar-roles --vercel` (B.4)               |
| `ZULUHUB_DB_TRABAJOS`          | Cadena con pooler del rol `zuluhub_trabajos`                                                    | `--preparar-roles --vercel`                     |
| `ZULUHUB_DB_PUBLICO`           | Cadena con pooler del rol `zuluhub_publico` (resolver la marca por host)                        | `--preparar-roles --vercel`                     |
| `ZULUHUB_DB_AUTENTICACION`     | Cadena con pooler del rol `zuluhub_autenticacion`                                               | `--preparar-roles --con-autenticacion --vercel` |
| `ZULUHUB_AUTH_SECRETO_EMPRESA` | Secreto de la sesión de la app de empresa (texto largo al azar)                                 | Vos                                             |
| `GOOGLE_CLIENT_ID`             | Cliente OAuth de Google (uno para Production y otro para Preview)                               | Vos                                             |
| `GOOGLE_CLIENT_SECRET`         | Ídem                                                                                            | Vos                                             |
| `CRON_SECRET`                  | Autoriza la llamada del cron de Vercel. **Al menos 16 caracteres y 10 distintos**, sin espacios | Vos (al azar, largo)                            |

Las de sistema (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`) las pone Vercel; no las cargues.

Diferencias con el plan, para que no te sorprendan: (1) `CRON_SECRET` no estaba declarada en el código; W6 la sumó a
`entorno.ts` con su validación (≥ 16 caracteres) y su prueba. (2) `ZULUHUB_CLAVE_CERTIFICADOS` (cifrado de las claves de
ARCA) la declara la facturación fiscal, no esta lista; se carga cuando ese tramo llegue. (3) La cadena de `zuluhub_captacion`
(`ZULUHUB_DB_CAPTACION`) la crea el comando con un nombre provisorio pero la aplicación todavía no la usa: no la cargues.

#### Lo que NO debe existir (ni en Production ni en Preview)

Si alguna existe, la aplicación **no arranca** (falla cerrado) y el comando de B.4 las borra:

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_TELEMETRY`,
  `BETTER_AUTH_TELEMETRY_ENDPOINT`, `BETTER_AUTH_TELEMETRY_ID`
- `AUTH_SECRET`, `AUTH_URL`
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
- todo lo que empiece con `POSTGRES_` (la integración de Neon con Vercel las inyecta: **no la instales**)
- la cadena del dueño de la base (`ZULUHUB_DB_MIGRACIONES` o `ZULUHUB_DB_DUENO_DIRECTA`): vive solo en GitHub y en tu terminal
- `ZULUHUB_DB_PLATAFORMA` y `ZULUHUB_DB_GRUPO`: la web no recibe esos roles

### B.6 Vercel: el proyecto

Proyecto `zuluhub-erp` (equipo `alepozod`):

1. **Root Directory = `apps/web`** (el dueño lo confirma **antes** del merge a `main`: es lo que hace que Vercel lea
   `apps/web/vercel.json` y que el despliegue apagado de verdad no publique nada) y activado «Include source files outside of the Root Directory in the Build Step»
   (la función necesita `src/` y `migraciones/`, que viven afuera). Vercel lee `apps/web/vercel.json` desde ahí.
2. **Node.js Version = 24** (Settings → Build and Deployment).
3. **Región de funciones = `gru1`** (también la declara `vercel.json`).
4. **Deployment Protection**: «Vercel Authentication» (Standard) para los previews.
5. No se cambia el comando de instalación ni el de compilación: queda el predeterminado. Si en el primer despliegue Vercel no
   instala o no compila el workspace, ver el plan B (sección D). **NO VERIFICADO.**
6. Las variables de B.5 cargadas. **Ninguna** de la lista «no debe existir».

### B.7 Dominios y DNS

En Vercel (Domains) y en el DNS de `zuluhub.com.ar`:

| Host                        | Superficie           | Nota                                                     |
| --------------------------- | -------------------- | -------------------------------------------------------- |
| `zuluhub.com.ar`            | landing              | indexable en producción                                  |
| `www.zuluhub.com.ar`        | —                    | redirección 308 a `zuluhub.com.ar`                       |
| `app.zuluhub.com.ar`        | app                  | nunca indexable; dirección de retorno de Google          |
| `app-prueba.zuluhub.com.ar` | app (base `preview`) | dominio fijo de prueba para Google (no acepta comodines) |

`*.vercel.app` siempre muestra la página neutra. No agregues `carta.zuluhub.com.ar` todavía (es de la etapa 2). **Además**,
cada host tiene que estar **registrado como dato** en la base de esa rama (sin eso, la puerta muestra la neutra aunque el DNS
esté bien): eso lo hace el caso de plataforma `agregarDominio` (sección E, pendiente).

### B.8 Google (inicio de sesión)

Un cliente OAuth para Production y otro para Preview. Dirección de retorno autorizada (la ruta por defecto de la
librería, **NO VERIFICADO** hasta probarlo con Google real): `https://app.zuluhub.com.ar/api/auth/callback/google` en
Production y `https://app-prueba.zuluhub.com.ar/api/auth/callback/google` en Preview.

### B.9 Un despliegue de prueba, sin encender el automático

Con `deploymentEnabled: false`, un push no publica nada. Para tener una URL contra la que correr los chequeos de la sección C
sin encender nada, se crea **a mano** un despliegue de _preview_ (no de producción) con la CLI de Vercel, desde la raíz del
repositorio: `npx vercel deploy` (usa el Root Directory del proyecto). **NO VERIFICADO**: es la forma esperada; si Vercel pide
otra cosa, el chequeo 1 de la sección C lo dirá. Después, la sección C.

### B.10 ÚLTIMO PASO: pedir la aprobación para encender el despliegue

> **No hagas este paso hasta que todos los chequeos de la sección C estén bien y la sección E esté resuelta.**
>
> Se le pide a quien mantiene el código que cambie `git.deploymentEnabled` a `true` en `apps/web/vercel.json`, y a la vez la
> constante `DESPLIEGUE_APROBADO_POR_EL_DUENO` a `true` en `test/arquitectura/vercel-json.test.ts` (si no, el CI no deja pasar
> el cambio). Ese cambio es **tuyo** de aprobar: sin tu visto bueno explícito, no se hace. Después, el primer push a `main`
> publica en producción.

---

## C. Lista de chequeo del primer despliegue (con `curl`, sin secretos en ningún lado)

`<URL>` es la del despliegue de prueba (B.9). Para los pedidos que llevan secreto, cargalo antes en la terminal **sin
mostrarlo** (por ejemplo `read -rs CRON_SECRET; export CRON_SECRET`) y no lo copies a ningún lado.

| #   | Qué se comprueba                                                                               | Cómo                                                                                                                                                                                                                                                                                                        | Resultado esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Forma del repositorio**: Vercel instaló y compiló el workspace                               | El despliegue de B.9 termina en «Ready»; mirá el registro de la compilación                                                                                                                                                                                                                                 | Compila `apps/web` y la función incluye `src/`. Si falla: plan B (sección D)                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | **Node 24** y **región `gru1`**                                                                | En el despliegue (Functions / Settings), mirá la versión de Node y la región                                                                                                                                                                                                                                | Node 24 y `gru1`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | **Qué cabecera trae el host**                                                                  | `curl -sI -H 'Host: otro.com' <URL>/`                                                                                                                                                                                                                                                                       | 404 neutro, `x-robots-tag: noindex`, sin `set-cookie` ni `x-powered-by`. Anotá qué cabeceras de host reenviadas aparecen                                                                                                                                                                                                                                                                                                                                                    |
| 4   | **`x-zh-*` y el host reenviado no pisan `host`**                                               | `curl -sI -H 'x-zh-marca: x' -H 'X-Forwarded-Host: otra.com' <URL>/`                                                                                                                                                                                                                                        | La misma respuesta que sin esas cabeceras                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | **HSTS**                                                                                       | `curl -sI https://<dominio>/`                                                                                                                                                                                                                                                                               | Trae `strict-transport-security` (la pone la aplicación; si Vercel agrega la suya, no se duplica con un valor distinto)                                                                                                                                                                                                                                                                                                                                                     |
| 6   | **Archivos y rutas sueltas**                                                                   | `/favicon.ico`, `/robots.txt`, `/api/auth/x` en un host sin registrar                                                                                                                                                                                                                                       | La misma neutra (404), nunca un archivo                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | **Previews = página neutra**                                                                   | Abrí la URL `*.vercel.app` en el navegador                                                                                                                                                                                                                                                                  | La página neutra, sin ninguna marca                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | **Salud**                                                                                      | `curl -si <URL>/api/salud` (funciona con cualquier host, también `*.vercel.app`)                                                                                                                                                                                                                            | 200 con `{"ok":true}` (o 503 con `{"ok":false}` si la base no responde); sin cookies y con `cache-control: private, no-store`                                                                                                                                                                                                                                                                                                                                               |
| 9   | **Cron sin secreto**                                                                           | `curl -si <URL>/api/trabajos/cron`                                                                                                                                                                                                                                                                          | **401**, sin cuerpo                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | **Cron autorizado**                                                                            | `curl -si -H "Authorization: Bearer $CRON_SECRET" <URL>/api/trabajos/cron`                                                                                                                                                                                                                                  | **200** con cuentas (`despacho`, `barrido`). **NO VERIFICADO**: que _Vercel_ mande el secreto así cuando corre solo. Mirá el registro del primer cron (Vercel → Logs → Cron) y confirmá un 200, no un 401                                                                                                                                                                                                                                                                   |
| 11  | **Mantenimiento**                                                                              | Con la base sin la migración requerida (por ejemplo, el despliegue antes de aplicar una migración nueva): abrí `/`                                                                                                                                                                                          | «En mantenimiento» (503) con una referencia `ZH-XXXX-XXXX`; la referencia aparece en el registro del servidor. Apenas migrás, vuelve sola                                                                                                                                                                                                                                                                                                                                   |
| 12  | **La salud y el cron siguen en mantenimiento**                                                 | Con la base atrasada: `/api/salud` y el cron                                                                                                                                                                                                                                                                | Responden igual que siempre (no quedan atrás del mantenimiento)                                                                                                                                                                                                                                                                                                                                                                                                             |
| 13  | **Ningún otro `/api/**` se abrió**                                                             | `curl -si -H 'Host: otro.com' <URL>/api/otra` y `<URL>/api/trabajos/cron/x`                                                                                                                                                                                                                                 | 404 neutro                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 14  | **La IP de confianza llega y no se deja falsificar** (`x-vercel-forwarded-for`, NO VERIFICADO) | Pedí el inicio de sesión de dos maneras y mirá el registro de la función (Vercel → Logs): (a) normal, `curl -si -X POST -H 'content-type: application/json' -d '{"provider":"google","callbackURL":"/"}' <URL>/api/auth/sign-in/social`; (b) igual pero con `-H 'x-vercel-forwarded-for: 1.1.1.1, 2.2.2.2'` | En (a) y en (b) **no** aparece el aviso «falling back to a single shared per-path bucket». Si aparece en (a), el encabezado no llega; si aparece en (b), Vercel **no** lo pisa y un cliente lo falsifica. En cualquiera de los dos casos NO se enciende: se pasa a `x-real-ip` o `x-forwarded-for` (Vercel documenta que los pisa) cambiando `ENCABEZADO_DE_IP`. Nunca se registra ni se copia el valor de la IP; solo se anota si el encabezado llegó y con un único valor |
| 15  | **Ingreso con Google sin JavaScript** (`form-action 'self'`, NO VERIFICADO)                    | En Chrome con JavaScript desactivado (Configuración → Privacidad y seguridad → Configuración de sitios → JavaScript → No permitir), tocá «Ingresar con Google» en el despliegue de prueba                                                                                                                   | Te lleva a `accounts.google.com`. Si Chrome lo bloquea por la política `form-action 'self'` (consola: «Refused to send form data»), se anota y se ajusta la política en un cambio aparte; con JavaScript el ingreso anda igual                                                                                                                                                                                                                                              |

---

## D. Plan B si Vercel no entiende el workspace

Si el chequeo 1 falla porque Vercel no instala desde la raíz o no resuelve `src/` fuera de `apps/web` (plan B del plan,
§5.1): sin Root Directory propio. En Vercel, Root Directory = `.` (la raíz); `vercel.json` vuelve a la raíz **y** el comando de
compilación pasa a `next build apps/web` (con `installCommand` el predeterminado). Es un cambio chico de `vercel.json` y de la
prueba `vercel-json.test.ts` (que hoy exige el archivo en `apps/web`). **NO se hizo por adelantado** porque no se pudo probar
sin Vercel y no se inventa lo que no se verifica.

---

## E. Alta de la primera empresa (runbook, §6.3) y qué falta

Orden, cuando todo lo anterior ande:

1. Rama `production` con las migraciones aplicadas por `migrar.yml`, la clave de contexto instalada y `LOGIN` en los roles (B.3–B.4).
2. `crear-primer-admin` con tu email (no puede ser miembro de ninguna empresa).
3. `ejecutar-caso-de-plataforma`: crear el plan por defecto y publicarlo; confirmar la versión 1 de la marca ZuluHub; registrar
   `zuluhub.com.ar` (landing) y `app.zuluhub.com.ar` (app, canónico).
4. Abrir `https://app.zuluhub.com.ar`: tiene que mostrar el ingreso con la marca, y un host inventado la página neutra.
5. `altaDeEmpresa` con los datos del cliente → sale el mail al gerente; `activarModuloDeEmpresa` con `facturacion`.
6. El gerente sigue el camino de la §1.3 del plan.

Esos scripts se corren en **tu computadora**, no en un workflow de GitHub: los datos del cliente (CUIT, razón social, email)
no tienen que quedar en el registro de una ejecución.

**Estado hoy (honesto):** los pasos 2, 3 y 5 **no se pueden ejecutar todavía**. Los scripts no existen porque faltan sus
cimientos: el caso de uso del primer administrador (H5 P7) y los casos de plataforma de marca, plan y alta de empresa (M5/M6)
no están en el código; solo existen sus dominios y su persistencia. Además, los scripts propuestos usaban `tsx`, que **no está
instalado** ni fue aprobado como dependencia: el plan lo condicionaba a que `node archivo.ts` fallara, y falla (la
mayoría del código importa sin extensión `.ts`, que Node no resuelve). Para el script de la clave de contexto no hizo falta
(se agregó la extensión `.ts` a dos importaciones, igual que ya se hizo con las migraciones); para los otros dos, cuando
existan sus casos de uso, hay que decidir entre aprobar `tsx` o repetir ese arreglo en toda la cadena de importaciones.

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

1. Que Vercel instale y compile el workspace con Root Directory `apps/web` (chequeo 1; plan B en la sección D).
2. Que el despliegue de prueba de B.9 se pueda crear con la CLI estando el automático apagado.
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
