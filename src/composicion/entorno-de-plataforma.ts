import { ZULUHUB_AUTH_SECRETO_PLATAFORMA } from "../adaptadores/autenticacion/configuracion";
import { ZULUHUB_CLAVE_CONTEXTO } from "../adaptadores/postgres/contexto-firmado";
import { ZULUHUB_SECRETO_INVITACIONES } from "../adaptadores/tokens/tokens-hmac";
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
 * y `plataforma.ts` a `scripts/`, las pruebas y `apps/plataforma/servidor/` (no a `apps/web` ni al resto de `src/`). Falla que previene: que un error
 * de la web pueda actuar como plataforma. La validación es la misma que la de la web (`validarPieza`):
 * perezosa, con las variables prohibidas, y su error nombra la variable, nunca el valor.
 */

/** La cadena del rol `zuluhub_plataforma`. Sin pooler o con él: las transacciones SERIALIZABLE funcionan en ambos. */
export const ZULUHUB_DB_PLATAFORMA = "ZULUHUB_DB_PLATAFORMA";

export const NOMBRES_DE_ENTORNO_DE_PLATAFORMA = [
  {
    nombre: ZULUHUB_DB_PLATAFORMA,
    forma: FORMA_DE_CADENA_DE_POSTGRES,
    piezas: ["transacciones-de-plataforma"],
  },
  // La misma clave con la que la base verifica el contexto (la que la web tiene en Vercel para esa rama).
  {
    nombre: ZULUHUB_CLAVE_CONTEXTO,
    forma: FORMA_DE_TEXTO,
    piezas: ["transacciones-de-plataforma"],
  },
  // Las invitaciones que emite el alta de una empresa llevan un token firmado con este secreto.
  {
    nombre: ZULUHUB_SECRETO_INVITACIONES,
    forma: FORMA_DE_TEXTO,
    piezas: ["tokens-de-plataforma"],
  },
  // El secreto de Better Auth de la consola (P8a): firma sus cookies y cifra el secreto TOTP. Propio de la consola y
  // distinto del de empresa; se valida con `leerSecretoDeAutenticacionDePlataforma` (largo, variedad, nunca igual al de
  // empresa). Vive acá y no en `entorno.ts` porque ese lo importa la web, y la web no recibe credenciales de plataforma.
  {
    nombre: ZULUHUB_AUTH_SECRETO_PLATAFORMA,
    forma: FORMA_DE_TEXTO,
    piezas: ["autenticacion-de-plataforma"],
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
