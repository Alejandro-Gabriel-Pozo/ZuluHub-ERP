import { z } from "zod";
import {
  ZULUHUB_CORREO_REMITENTE,
  ZULUHUB_NOMBRE_DE_MARCA,
  ZULUHUB_RESEND_API_KEY,
  ZULUHUB_URL_BASE,
} from "../adaptadores/correo/configuracion";
import { ZULUHUB_CLAVE_CONTEXTO } from "../adaptadores/postgres/contexto-firmado";
import { ErrorDeConfiguracion } from "../adaptadores/postgres/errores";
import { ZULUHUB_SECRETO_INVITACIONES } from "../adaptadores/tokens/tokens-hmac";

/**
 * Variables de entorno de la aplicación web (web-armazon-y-despliegue §3.4 y §5.2). Acá viven los
 * NOMBRES y su validación; los valores los carga el dueño en Vercel y no pasan nunca por el
 * repositorio. Este archivo es el ÚNICO que lee `process.env` (regla R-W1).
 *
 * Reglas:
 *  - Perezosa: nada se lee ni se valida al importar este archivo ni al compilar. Cada pieza pide
 *    sus variables la primera vez que se usa (`valoresDeLaPieza`). Previene una compilación que
 *    necesita secretos (y los deja en el paquete o en los registros). Chequeo: P-12.
 *  - Falla cerrado: una variable que falta o no sirve lanza `ErrorDeEntorno`, cuyo mensaje es
 *    genérico. El NOMBRE (y nunca el valor) va al registro del servidor con `detalleParaElRegistro`.
 *  - Prohibidas: si existe alguna de `VARIABLES_PROHIBIDAS`, no se arma nada.
 *
 * La forma de cada variable (Zod) es gruesa a propósito: texto no vacío, o una cadena de Postgres.
 * El formato fino (hexadecimal, `<kid>:<hex>`, https) lo sigue validando el adaptador que la usa,
 * que es su dueño; acá no se repite para no tener dos definiciones de lo que es válido.
 */

const texto = z.string().trim().min(1);
const cadenaDePostgres = z
  .string()
  .trim()
  .regex(/^postgres(?:ql)?:\/\/\S+$/);

/**
 * Cada variable con su forma y las piezas de la composición que la usan. Una pieza valida solo las
 * suyas: pedir las transacciones de la aplicación no exige la clave de Resend.
 */
export const NOMBRES_DE_ENTORNO = [
  {
    nombre: ZULUHUB_CLAVE_CONTEXTO,
    forma: texto,
    piezas: ["transacciones-app", "transacciones-trabajos"],
  },
  { nombre: "ZULUHUB_DB_APP", forma: cadenaDePostgres, piezas: ["transacciones-app"] },
  { nombre: "ZULUHUB_DB_TRABAJOS", forma: cadenaDePostgres, piezas: ["transacciones-trabajos"] },
  { nombre: ZULUHUB_SECRETO_INVITACIONES, forma: texto, piezas: ["tokens"] },
  { nombre: ZULUHUB_RESEND_API_KEY, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_CORREO_REMITENTE, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_URL_BASE, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_NOMBRE_DE_MARCA, forma: texto, piezas: ["correo"] },
] as const;

/**
 * Variables que no deben existir en el entorno (§3.4): las lee sola una librería o las inyecta una
 * integración con un rol que se salta el aislamiento. Con una presente, la composición no arma nada.
 * Previene: el rol dueño de Neon (`BYPASSRLS`) entrando por `DATABASE_URL`, o Better Auth leyendo un
 * secreto y un origen que nadie eligió. Chequeo: P-13.
 */
export const VARIABLES_PROHIBIDAS: readonly string[] = [
  "BETTER_AUTH_TELEMETRY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
];

/** Familia entera prohibida (la integración de Neon inyecta `POSTGRES_URL`, `POSTGRES_USER`, ...). */
export const PREFIJO_PROHIBIDO = "POSTGRES_";

type Entrada = (typeof NOMBRES_DE_ENTORNO)[number];
export type NombreDeEntorno = Entrada["nombre"];
export type Pieza = Entrada["piezas"][number];

type NombresDeLaPieza<E, P> = E extends { nombre: infer N; piezas: readonly (infer Ps)[] }
  ? P extends Ps
    ? N
    : never
  : never;

/** Los valores ya validados (y sin blancos en los extremos) de las variables de una pieza. */
export type ValoresDeLaPieza<P extends Pieza> = Readonly<
  Record<Extract<NombresDeLaPieza<Entrada, P>, string>, string>
>;

export type FuenteDeEntorno = Readonly<Record<string, string | undefined>>;

const MENSAJE_PUBLICO = "el entorno del servidor no está bien configurado";

/**
 * El entorno falta, no sirve o tiene algo prohibido. Su `message` es genérico y puede viajar a una
 * respuesta; el detalle (con los NOMBRES de las variables, jamás sus valores) es privado y solo sale
 * por `detalleParaElRegistro`, para el registro del servidor. Es privado de verdad (`#`): ni
 * `JSON.stringify` ni un `console.log` del error lo muestran.
 */
export class ErrorDeEntorno extends ErrorDeConfiguracion {
  readonly #detalle: string;

  constructor(detalle: string) {
    super(MENSAJE_PUBLICO);
    this.name = "ErrorDeEntorno";
    this.#detalle = detalle;
  }

  detalleParaElRegistro(): string {
    return this.#detalle;
  }
}

function esProhibida(nombre: string): boolean {
  return VARIABLES_PROHIBIDAS.includes(nombre) || nombre.startsWith(PREFIJO_PROHIBIDO);
}

/** Los nombres prohibidos que existen en la fuente (ordenados). Una variable `undefined` no existe. */
export function prohibidasPresentes(fuente: FuenteDeEntorno): string[] {
  return Object.keys(fuente)
    .filter((nombre) => fuente[nombre] !== undefined && esProhibida(nombre))
    .sort();
}

/**
 * Valida las variables de una pieza y devuelve sus valores. Pura: recibe la fuente, no lee
 * `process.env`. Orden: primero las prohibidas (si hay una, no se mira nada más); después las
 * variables de la pieza, todas juntas, para que un solo intento muestre todo lo que falta. Los
 * mensajes de Zod no se usan: podrían repetir el valor.
 */
export function valoresDeLaPieza<P extends Pieza>(
  fuente: FuenteDeEntorno,
  pieza: P,
): ValoresDeLaPieza<P> {
  const prohibidas = prohibidasPresentes(fuente);
  if (prohibidas.length > 0) {
    throw new ErrorDeEntorno(`variables prohibidas presentes: ${prohibidas.join(", ")}`);
  }
  const problemas: string[] = [];
  const valores: Record<string, string> = {};
  for (const entrada of NOMBRES_DE_ENTORNO) {
    if (!(entrada.piezas as readonly string[]).includes(pieza)) continue;
    const crudo = fuente[entrada.nombre];
    if (crudo === undefined) {
      problemas.push(`${entrada.nombre} falta`);
      continue;
    }
    const analizado = entrada.forma.safeParse(crudo);
    if (analizado.success) valores[entrada.nombre] = analizado.data;
    else problemas.push(`${entrada.nombre} inválida`);
  }
  if (problemas.length > 0) {
    throw new ErrorDeEntorno(`pieza ${pieza}: ${problemas.join("; ")}`);
  }
  return valores as ValoresDeLaPieza<P>;
}

/**
 * Corre `armar` (que lee y valida variables) y deja un solo tipo de error de entorno: el
 * `ErrorDeConfiguracion` que lanzan los adaptadores (su mensaje nombra la variable y el motivo,
 * nunca el valor) se vuelve un `ErrorDeEntorno` con mensaje genérico. Los demás errores pasan tal
 * cual. Cada error de entorno va, con su detalle, a `registrar` (el registro del servidor); si
 * `registrar` falla, no tapa el error real.
 */
export function registrandoFallosDeEntorno<T>(
  registrar: (detalle: string) => void,
  armar: () => T,
): T {
  try {
    return armar();
  } catch (error) {
    const deEntorno =
      error instanceof ErrorDeEntorno
        ? error
        : error instanceof ErrorDeConfiguracion
          ? new ErrorDeEntorno(error.message)
          : null;
    if (deEntorno === null) throw error;
    try {
      registrar(deEntorno.detalleParaElRegistro());
    } catch {
      // Un registro que falla no puede tapar el error de entorno.
    }
    throw deEntorno;
  }
}

/** La fuente real. Es lo único de este archivo que toca `process.env`; las pruebas pasan la suya. */
export function entornoDelProceso(): FuenteDeEntorno {
  return process.env;
}
