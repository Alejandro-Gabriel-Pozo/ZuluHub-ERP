# Primer despliegue de la consola de plataforma

La consola (`apps/plataforma`) es una aplicación **aparte** de la web de los clientes: su propio proyecto de Vercel, sus propias
credenciales y sus propias cookies. La web de los clientes nunca recibe nada de esto. Esta guía es para el dueño: los
valores se cargan en Vercel y en Google; **no se escriben nunca en el repositorio, en un mensaje ni en un commit**.

El despliegue automático está apagado (`vercel.json` → `deploymentEnabled: false`) y sigue así hasta que el dueño apruebe.

## 1. Lo que se necesita antes

1. Las migraciones **0013 a 0015** aplicadas (preview y después producción, con `migrar.yml`). Sin la 0015, la consola
   responde «En mantenimiento».
2. Un primer administrador cargado con el script del dueño: `npm run plataforma:primer-admin -- <email>`. Sin esto, nadie
   puede entrar a la consola.
3. Un **cliente de Google propio de la consola**, distinto del de la web (ni el mismo identificador ni el mismo secreto).
   En Google Cloud: tipo «Aplicación web»; origen autorizado `https://platform.pedernal.com.ar`; URI de redirección
   autorizada `https://platform.pedernal.com.ar/api/auth/callback/google`.

## 2. El proyecto de Vercel (lo crea el dueño)

- Nuevo proyecto desde este mismo repositorio, **directorio raíz `apps/plataforma`**.
- Activar **«Include files outside root directory in the Build Step»** (Settings → General → Root Directory). Sin esto la
  compilación falla: la consola importa la interfaz de `apps/web/ui` y la composición de `src/`.
- Región de funciones `gru1` (ya está en `vercel.json`).
- Dominio: `platform.pedernal.com.ar`.
- No activar despliegues automáticos hasta la aprobación final.

## 3. Variables de entorno del proyecto (solo los nombres; los valores los carga el dueño)

| Nombre                             | Para qué                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `PEDERNAL_HOST_DE_LA_CONSOLA`      | El host de la consola (el dominio de arriba, sin `https://`). De acá sale el origen del ingreso y contra él se compara cada sesión. |
| `PEDERNAL_AUTH_SECRETO_PLATAFORMA` | Secreto de ingreso de la consola. Distinto del de la web.                                                                           |
| `GOOGLE_CLIENT_ID_PLATAFORMA`      | Identificador del cliente de Google de la consola.                                                                                  |
| `GOOGLE_CLIENT_SECRET_PLATAFORMA`  | Secreto del cliente de Google de la consola.                                                                                        |
| `PEDERNAL_DB_AUTENTICACION`        | Conexión del rol de autenticación (segundo factor y sesiones).                                                                      |
| `PEDERNAL_DB_PLATAFORMA`           | Conexión del rol de plataforma. **Solo existe en este proyecto.**                                                                   |
| `PEDERNAL_CLAVE_CONTEXTO`          | Clave que firma el contexto de cada pedido.                                                                                         |
| `PEDERNAL_SECRETO_INVITACIONES`    | Secreto de las invitaciones: lo necesita el alta de empresa **y también suspender una persona**.                                    |

Si falta alguna, el pedido falla cerrado con una referencia `PD-XXXX-XXXX`; el **nombre** de la variable que falta queda
en los registros de la función, nunca en la pantalla.

### 3.1 Cargar las cuatro variables de base y de claves sin ver ningún valor (solo `preview`)

Las cuatro que son secretos de base o de firma (`PEDERNAL_DB_AUTENTICACION`, `PEDERNAL_DB_PLATAFORMA`, `PEDERNAL_CLAVE_CONTEXTO`,
`PEDERNAL_SECRETO_INVITACIONES`) no se pegan a mano: las genera y las carga el flujo **Cargar entorno de la consola (solo preview)**
(`cargar-entorno-consola.yml`), con tu aprobación en GitHub. Nadie ve ningún valor. Las otras cuatro (host, secreto de ingreso y
cliente de Google) las seguís cargando vos; el flujo solo avisa por nombre si están o faltan.

Una sola vez, antes de la primera corrida:

1. **Migrar la base de preview.** En GitHub, Actions, **Migrar (preview y producción)**, elegí `main`, ambiente `preview` y `aplicar`.
   Aplica la migración 0088 (el rol de ingreso propio de la consola). Si el Environment `preview` tiene el secreto
   `PEDERNAL_CLAVE_CONTEXTO` con la clave de la web, dejalo como está: no hace falta tocarlo.
2. **Crear el token de Vercel del flujo.** En vercel.com, Settings de tu cuenta, Tokens, **Create**: nombre `pedernal-consola-preview`, equipo
   `alepozod`, **alcance a los dos proyectos** (`pedernal-erp` y `pedernal-plataforma`) y vencimiento corto (7 días). Copialo una vez.
3. **Cargarlo en GitHub.** Settings del repositorio, Environments, `preview`, **Add secret**: nombre exacto `PEDERNAL_VERCEL_TOKEN_CONSOLA`
   (no es el mismo que `PEDERNAL_VERCEL_TOKEN`). Pegá el token ahí y en ningún otro lugar. Cuando venza, creá otro y reemplazalo.
4. **Correr el flujo.** Actions, **Cargar entorno de la consola (solo preview)**, `main`, escribí `CARGAR CONSOLA PREVIEW` y, **la primera
   vez, marcá «rotar»** (los valores que cargaste a mano antes no se pueden leer ni comparar: se reemplazan por valores nuevos que
   coinciden entre sí). Aprobá el Environment. El informe nombra qué se cargó; no muestra valores.
5. **Redesplegar** el último despliegue de preview de la consola (y el de la web: el secreto de invitaciones cambió). Las invitaciones de
   preview que estaban pendientes hay que **reenviarlas**.

Después: corrida normal (sin «rotar») cada menos de 90 días. No cambia nada de lo cargado y renueva la vigencia del login de los dos roles; si
pasan 90 días sin correrlo, la consola de preview deja de poder entrar a la base (falla cerrada) hasta que se corra de nuevo. Si una corrida
falla a mitad, el informe nombra lo que ya quedó escrito en Vercel: repetirla con «rotar» lo deja consistente.

## 4. Primera vista previa: qué comprobar

1. Abrir `/ingreso`: se ve «Ingresar con Google». Con una cuenta que **no** es de la lista aparece «No pudimos iniciar
   sesión…». Con el administrador cargado, Google vuelve a la consola.
2. **Primera vez:** la consola lleva a `/ingreso/alta`: QR, clave en texto y diez códigos de recuperación (se ven una sola
   vez). Escanear con la aplicación de autenticación, tildar «Guardé los códigos» y confirmar con el primer código.
3. **Siguientes veces:** Google y después las seis cifras (`/ingreso/codigo`). Un código equivocado y una cuenta no
   habilitada muestran **exactamente el mismo texto**.
4. Dejar la consola quieta 25 minutos: aparece «¿Seguís ahí?». «Seguir» renueva; a los 30 minutos sin uso la sesión se
   cierra y se vuelve al ingreso.
5. «Cerrar sesión» vuelve a `/ingreso`; atrás en el navegador no deja ver la consola.
6. Comprobar en las herramientas del navegador que la cookie es `__Host-pd_plat.session_token` y que **no** existe ninguna
   `pd_emp` ni `pd_empresa`.
7. Comprobar que `/ingreso/alta` responde con `Cache-Control: private, no-store`.
8. Comprobar el encabezado de IP de confianza para el límite de intentos (mismo punto 14 de la guía de la web).
