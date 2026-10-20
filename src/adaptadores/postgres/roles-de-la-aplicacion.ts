import { randomBytes } from "node:crypto";

/**
 * Lo puro de «preparar los roles» de la aplicación (`scripts/migrar-base.ts --preparar-roles`): qué
 * roles y con qué variable de Vercel, la contraseña al azar y la cadena de conexión de cada rol. Sin
 * base de datos ni archivos: se prueba y se muta sin nada alrededor.
 */

export type RolPorPreparar = Readonly<{ rol: string; variable: string }>;

/** Los roles con los que entra la aplicación web (las variables son las que declara `composicion/entorno.ts`). */
const ROLES_DE_LA_APLICACION: readonly RolPorPreparar[] = [
  { rol: "pedernal_app", variable: "PEDERNAL_DB_APP" },
  { rol: "pedernal_trabajos", variable: "PEDERNAL_DB_TRABAJOS" },
  { rol: "pedernal_publico", variable: "PEDERNAL_DB_PUBLICO" },
];

/**
 * Los roles de la librería de autenticación y de la landing. La aplicación todavía no declara una
 * variable para ellos: los nombres son provisorios y el comando lo avisa.
 */
const ROLES_DE_AUTENTICACION: readonly RolPorPreparar[] = [
  { rol: "pedernal_autenticacion", variable: "PEDERNAL_DB_AUTENTICACION" },
  { rol: "pedernal_captacion", variable: "PEDERNAL_DB_CAPTACION" },
];

/**
 * El rol exclusivo de respaldo (`respaldo-y-recuperacion.md` §B.3): solo lectura y el único que salta el
 * aislamiento. Su cadena NUNCA va a Vercel (la aplicación no puede tener una credencial que saltea la RLS): va al
 * secreto del Environment `respaldo` de GitHub, con el host directo (`pg_dump` necesita una sesión propia).
 */
export const ROL_DE_RESPALDO: RolPorPreparar = {
  rol: "pedernal_respaldo",
  variable: "PEDERNAL_DB_RESPALDO",
};

/**
 * Exactamente estos roles y ningún otro: `pedernal_grupo` y `pedernal_plataforma` no se tocan nunca, y el de
 * respaldo solo si se pide (`conRespaldo`), nunca por defecto.
 */
export function rolesPorPreparar(
  conAutenticacion: boolean,
  conRespaldo = false,
): readonly RolPorPreparar[] {
  const base = conAutenticacion
    ? [...ROLES_DE_LA_APLICACION, ...ROLES_DE_AUTENTICACION]
    : ROLES_DE_LA_APLICACION;
  return conRespaldo ? [...base, ROL_DE_RESPALDO] : base;
}

/** ¿Es la variable del rol de respaldo? Su cadena se muestra aparte y nunca se carga en Vercel. */
export function esVariableDeRespaldo(variable: string): boolean {
  return variable === ROL_DE_RESPALDO.variable;
}

/** Los nombres de variable que todavía no existen en la aplicación. */
export function esVariableProvisoria(variable: string): boolean {
  return ROLES_DE_AUTENTICACION.some((r) => r.variable === variable);
}

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const LARGO_DE_CLAVE = 32;
// 62 × 4 = 248: un byte de 248 a 255 se descarta, porque `byte % 62` favorecería a las primeras letras.
const LIMITE_SIN_SESGO = 248;

/** 32 caracteres, solo letras y números, uniformes (sin sesgo de módulo). `bytesAlAzar` se inyecta para probar. */
export function claveAlAzar(
  bytesAlAzar: (cuantos: number) => Uint8Array = (cuantos) => randomBytes(cuantos),
): string {
  let clave = "";
  while (clave.length < LARGO_DE_CLAVE) {
    for (const byte of bytesAlAzar(LARGO_DE_CLAVE * 2)) {
      if (byte < LIMITE_SIN_SESGO && clave.length < LARGO_DE_CLAVE) {
        clave += ALFABETO.charAt(byte % ALFABETO.length);
      }
    }
  }
  return clave;
}

export type CadenaDeRol = Readonly<{ cadena: string; pooler: boolean }>;

/**
 * La cadena de un rol: el host y la base de la cadena recibida, con el usuario y la contraseña del rol.
 * Con `pooler`, el host pasa al del pooler de Neon (`ep-xxx` → `ep-xxx-pooler`); si el host no es de
 * Neon no se puede deducir y queda el directo (`pooler: false` lo dice). `channel_binding` se quita: el
 * pooler (PgBouncer) no lo soporta.
 */
export function cadenaDeRol(
  cadenaRecibida: string,
  rol: string,
  clave: string,
  conPooler: boolean,
): CadenaDeRol {
  const url = new URL(cadenaRecibida);
  url.username = rol;
  url.password = clave;
  url.searchParams.delete("channel_binding");
  let pooler = false;
  if (conPooler) {
    const partes = url.hostname.split(".");
    const etiqueta = partes[0] as string;
    const resto = partes.slice(1);
    if (/^ep-[a-z0-9-]+$/.test(etiqueta) && url.hostname.endsWith(".neon.tech")) {
      url.hostname = [`${etiqueta}-pooler`, ...resto].join(".");
      pooler = true;
    }
  }
  return { cadena: url.toString(), pooler };
}
