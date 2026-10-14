import { z } from "zod";
import {
  ZULUHUB_CORREO_REMITENTE,
  ZULUHUB_NOMBRE_DE_MARCA,
  ZULUHUB_RESEND_API_KEY,
  ZULUHUB_URL_BASE,
} from "../adaptadores/correo/configuracion";
import {
  CARACTERES_DISTINTOS_MINIMOS,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  ZULUHUB_AUTH_SECRETO_EMPRESA,
  caracteresDistintos,
} from "../adaptadores/autenticacion/configuracion";
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
 * Largo mínimo del secreto del cron. Un secreto corto se adivina a pedidos (la ruta del cron es pública en
 * Internet): lo que no llega a este largo no sirve y el cron falla cerrado. Es nuestra regla, no la de Vercel.
 * Además del largo, la variedad: el MISMO piso de caracteres distintos que el secreto de autenticación
 * (`CARACTERES_DISTINTOS_MINIMOS`), para que `aaaa…` de 16 no pase.
 */
export const LARGO_MINIMO_DEL_SECRETO_DEL_CRON = 16;
const secretoDelCron = z
  .string()
  .trim()
  .min(LARGO_MINIMO_DEL_SECRETO_DEL_CRON)
  .refine((valor) => caracteresDistintos(valor) >= CARACTERES_DISTINTOS_MINIMOS);

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
  // `esquema`: lo que mira la guarda de migración y la salud (W6) con el mismo rol de la aplicación.
  {
    nombre: "ZULUHUB_DB_APP",
    forma: cadenaDePostgres,
    piezas: ["transacciones-app", "esquema"],
  },
  { nombre: "ZULUHUB_DB_TRABAJOS", forma: cadenaDePostgres, piezas: ["transacciones-trabajos"] },
  // La puerta pública (rol `zuluhub_publico`, solo lectura, sin sesión): resolución de marca por host.
  // Es una cadena de conexión propia y distinta de las demás; el valor lo carga el dueño en Vercel.
  { nombre: "ZULUHUB_DB_PUBLICO", forma: cadenaDePostgres, piezas: ["transacciones-publicas"] },
  // La autenticación (W3b): el rol `zuluhub_autenticacion` (solo su esquema, sin DDL) con su propia cadena, el
  // secreto de Better Auth de la app de empresa y el cliente OAuth de Google. La conexión se pide sola (el
  // barrido del cron no necesita ni el secreto ni Google).
  {
    nombre: "ZULUHUB_DB_AUTENTICACION",
    forma: cadenaDePostgres,
    piezas: ["conexion-de-autenticacion"],
  },
  { nombre: ZULUHUB_AUTH_SECRETO_EMPRESA, forma: texto, piezas: ["autenticacion"] },
  { nombre: GOOGLE_CLIENT_ID, forma: texto, piezas: ["autenticacion"] },
  { nombre: GOOGLE_CLIENT_SECRET, forma: texto, piezas: ["autenticacion"] },
  { nombre: ZULUHUB_SECRETO_INVITACIONES, forma: texto, piezas: ["tokens"] },
  { nombre: ZULUHUB_RESEND_API_KEY, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_CORREO_REMITENTE, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_URL_BASE, forma: texto, piezas: ["correo"] },
  { nombre: ZULUHUB_NOMBRE_DE_MARCA, forma: texto, piezas: ["correo"] },
  // El cron de trabajos (W6): Vercel manda `Authorization: Bearer <valor>` si la variable existe en el proyecto
  // (NO VERIFICADO: se mira en el primer despliegue). Nombre fijo de Vercel, por eso sin el prefijo del producto.
  { nombre: "CRON_SECRET", forma: secretoDelCron, piezas: ["cron"] },
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
  // Las que la librería de ingreso 1.7.7 lee sola (verificado en su código) y pisarían lo que la
  // composición le pasa: otros secretos que mandan sobre el nuestro, orígenes confiables de más, el destino y
  // el identificador de la telemetría. Mismo motivo que las de arriba: ambigüedad de qué rige.
  "BETTER_AUTH_SECRETS",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_TELEMETRY_ENDPOINT",
  "BETTER_AUTH_TELEMETRY_ID",
  "AUTH_SECRET",
  "AUTH_URL",
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

/**
 * Variable de SISTEMA que pone Vercel con el tipo de despliegue (`production`, `preview`, `development`).
 * No la carga el dueño ni es un secreto, y ninguna pieza la exige: solo decide si se deja indexar algo
 * (marca, metadatos y SEO §5.1). Vive acá porque este archivo es el único que mira el entorno (R-W1).
 */
export const VARIABLE_DE_TIPO_DE_DESPLIEGUE = "VERCEL_ENV";

/**
 * ¿Es el despliegue de producción? Solo si la variable vale exactamente `production`: ausente, vacía o
 * con cualquier otro texto es «no», así que ante la duda nada se indexa (falla cerrado).
 */
export function esProduccion(fuente: FuenteDeEntorno): boolean {
  return fuente[VARIABLE_DE_TIPO_DE_DESPLIEGUE] === "production";
}

/** La fuente real. Es lo único de este archivo que toca `process.env`; las pruebas pasan la suya. */
export function entornoDelProceso(): FuenteDeEntorno {
  return process.env;
}
