import {
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  PEDERNAL_HOST_DE_LA_CONSOLA,
} from "../adaptadores/autenticacion/configuracion";
import { PEDERNAL_CLAVE_CONTEXTO } from "../adaptadores/postgres/contexto-firmado";
import { PEDERNAL_SECRETO_INVITACIONES } from "../adaptadores/tokens/tokens-hmac";
import {
  FORMA_DE_CADENA_DE_POSTGRES,
  FORMA_DE_TEXTO,
  validarPieza,
  type FuenteDeEntorno,
} from "./entorno";

/**
 * Variables de entorno de la puerta de scripts de plataforma (web-armazon-y-despliegue §6.2): NOMBRES y
 * validación; los valores los carga el dueño en su terminal y no pasan nunca por el repositorio.
 *
 * Viven en un archivo APARTE de `entorno.ts` a propósito: ese lo importa la web, y la web no recibe
 * credenciales de plataforma (R10; `entorno.test.ts` fija que `NOMBRES_DE_ENTORNO` no las nombra). Acá
 * pueden vivir porque la regla de arquitectura `plataforma-solo-desde-scripts` solo deja importar este archivo
 * y `plataforma.ts` a `scripts/`, las pruebas y las piezas de composición de la consola (`puerta-de-consola.ts` e
 * `ingreso-de-consola.ts`; `apps/plataforma/servidor` entra solo por esas dos), nunca a `apps/web` ni al resto de `src/`.
 * Falla que previene: que un error de la web pueda actuar como plataforma. La validación es la misma que la de la web (`validarPieza`):
 * perezosa, con las variables prohibidas, y su error nombra la variable, nunca el valor.
 */

/** La cadena del rol `pedernal_plataforma`. Sin pooler o con él: las transacciones SERIALIZABLE funcionan en ambos. */
export const PEDERNAL_DB_PLATAFORMA = "PEDERNAL_DB_PLATAFORMA";

/**
 * La cadena del rol `pedernal_autenticacion` (las tablas de la librería de ingreso). Es el MISMO nombre que usa la web
 * (`entorno.ts`): la consola es otro proyecto de Vercel y la carga por su cuenta; se declara acá porque la consola no
 * puede leer la lista de la web.
 */
export const PEDERNAL_DB_AUTENTICACION = "PEDERNAL_DB_AUTENTICACION";

export const NOMBRES_DE_ENTORNO_DE_PLATAFORMA = [
  {
    nombre: PEDERNAL_DB_PLATAFORMA,
    forma: FORMA_DE_CADENA_DE_POSTGRES,
    piezas: ["transacciones-de-plataforma"],
  },
  // La misma clave con la que la base verifica el contexto (la que la web tiene en Vercel para esa rama).
  {
    nombre: PEDERNAL_CLAVE_CONTEXTO,
    forma: FORMA_DE_TEXTO,
    piezas: ["transacciones-de-plataforma"],
  },
  // Las invitaciones que emite el alta de una empresa llevan un token firmado con este secreto.
  {
    nombre: PEDERNAL_SECRETO_INVITACIONES,
    forma: FORMA_DE_TEXTO,
    piezas: ["tokens-de-plataforma"],
  },
  // El secreto de Better Auth de la consola (P8a): firma sus cookies y cifra el secreto TOTP. Propio de la consola y
  // distinto del de empresa; se valida con `leerSecretoDeAutenticacionDePlataforma` (largo, variedad, nunca igual al de
  // empresa). Vive acá y no en `entorno.ts` porque ese lo importa la web, y la web no recibe credenciales de plataforma.
  {
    nombre: PEDERNAL_AUTH_SECRETO_PLATAFORMA,
    forma: FORMA_DE_TEXTO,
    piezas: ["autenticacion-de-plataforma"],
  },
  // El cliente de Google de la consola (P8c), APARTE del de la web (aísla revocaciones). Sin el prefijo del producto, igual
  // que `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (nombres que el dueño ya conoce de la consola de Google). Misma pieza que
  // el secreto: un solo intento muestra todo lo que falta del ingreso. Se validan con `leerClienteDeGoogleDePlataforma`
  // (que además exige que no sean los de la web).
  {
    nombre: GOOGLE_CLIENT_ID_PLATAFORMA,
    forma: FORMA_DE_TEXTO,
    piezas: ["autenticacion-de-plataforma"],
  },
  {
    nombre: GOOGLE_CLIENT_SECRET_PLATAFORMA,
    forma: FORMA_DE_TEXTO,
    piezas: ["autenticacion-de-plataforma"],
  },
  // Las tablas de la librería de ingreso (rol `pedernal_autenticacion`). Pieza propia, como en la web: el barrido de
  // sesiones no necesita ni el secreto ni Google.
  {
    nombre: PEDERNAL_DB_AUTENTICACION,
    forma: FORMA_DE_CADENA_DE_POSTGRES,
    piezas: ["conexion-de-autenticacion-de-plataforma"],
  },
  // El host donde atiende la consola (sin esquema). Se valida con `leerHostDeLaConsola` (`configuracionDeHost`).
  {
    nombre: PEDERNAL_HOST_DE_LA_CONSOLA,
    forma: FORMA_DE_TEXTO,
    piezas: ["host-de-la-consola"],
  },
] as const;

type DeLaPieza<P extends string> = Extract<
  (typeof NOMBRES_DE_ENTORNO_DE_PLATAFORMA)[number],
  { piezas: readonly [P] }
>["nombre"];

export type PiezaDePlataforma = (typeof NOMBRES_DE_ENTORNO_DE_PLATAFORMA)[number]["piezas"][number];

/** Los valores ya validados (y sin blancos en los extremos) de las variables de una pieza. */
export type ValoresDeLaPiezaDePlataforma<P extends PiezaDePlataforma> = Readonly<
  Record<DeLaPieza<P>, string>
>;

export function valoresDeLaPiezaDePlataforma<P extends PiezaDePlataforma>(
  fuente: FuenteDeEntorno,
  pieza: P,
): ValoresDeLaPiezaDePlataforma<P> {
  return validarPieza(
    NOMBRES_DE_ENTORNO_DE_PLATAFORMA,
    fuente,
    pieza,
  ) as ValoresDeLaPiezaDePlataforma<P>;
}
