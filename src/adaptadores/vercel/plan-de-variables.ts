import { randomBytes } from "node:crypto";

/**
 * Lo puro de «cargar las variables en Vercel» (`migrar-base --preparar-roles --vercel`): a qué proyecto
 * y destino se escribe, qué variables sobran, cuáles hay que escribir y qué pasos hacen falta para que
 * el destino quede EXACTAMENTE como la aplicación lo exige. Sin red ni archivos: se prueba y se muta
 * sin nada alrededor.
 *
 * Las reglas que no se negocian:
 * - Solo se toca el destino pedido. Una variable de Vercel puede valer para varios destinos a la vez
 *   (`target: ["production", "preview"]`); borrarla entera para limpiar uno vaciaría el otro, así que
 *   en ese caso se le QUITA el destino y se conserva para los demás.
 * - Lo que se escribe es siempre `sensitive` y para un único destino. Una variable existente que
 *   choca (compartida con otro destino, no sensible, o atada a una rama) se libera antes de escribir:
 *   no se confía en cómo resuelve Vercel un `upsert` sobre una variable de otra forma.
 */

/** No son secretos: identifican el proyecto `zuluhub-erp` y el equipo donde vive. */
export const PROYECTO_DE_VERCEL = "prj_BZ5e86RcBcfYCAzSW2vVbPpkj7jG";
export const EQUIPO_DE_VERCEL = "alepozod";

/** El NOMBRE de la variable de entorno de la terminal con el token de la API de Vercel. */
export const VARIABLE_DEL_TOKEN = "ZULUHUB_VERCEL_TOKEN";

/**
 * El nombre de la variable con la cadena DIRECTA (de dueño) de la base. Vive en la terminal del dueño
 * y NUNCA debe existir en Vercel: se borra del destino si el dueño la dejó ahí.
 */
export const NOMBRE_DE_LA_CADENA_DE_DUENO = "ZULUHUB_DB_MIGRACIONES";

export const DESTINOS = ["preview", "production"] as const;
export type Destino = (typeof DESTINOS)[number];

/** `preview` o `production`, tal cual (en minúscula); cualquier otra cosa no es un destino. */
export function leerDestino(texto: string | undefined): Destino | null {
  return DESTINOS.find((destino) => destino === texto) ?? null;
}

/**
 * Lo que la aplicación PROHÍBE que exista (`VARIABLES_PROHIBIDAS` y `PREFIJO_PROHIBIDO` de
 * `src/composicion/entorno.ts`). Se repite acá porque el script se carga con Node sin compilar y ese
 * archivo importa sin extensión; `test/arquitectura/vercel-prohibidas.test.ts` falla si las dos listas
 * se separan.
 */
export const VARIABLES_PROHIBIDAS_EN_VERCEL: readonly string[] = [
  "BETTER_AUTH_TELEMETRY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRETS",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_TELEMETRY_ENDPOINT",
  "BETTER_AUTH_TELEMETRY_ID",
  "AUTH_SECRET",
  "AUTH_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
];
export const PREFIJO_PROHIBIDO_EN_VERCEL = "POSTGRES_";

/** Lo que no debe quedar en Vercel: lo prohibido por la aplicación y la cadena de dueño de la base. */
export function sobraEnVercel(nombre: string): boolean {
  return (
    VARIABLES_PROHIBIDAS_EN_VERCEL.includes(nombre) ||
    nombre.startsWith(PREFIJO_PROHIBIDO_EN_VERCEL) ||
    nombre === NOMBRE_DE_LA_CADENA_DE_DUENO
  );
}

/** Una variable del proyecto tal como la lista Vercel (sin su valor: las sensibles no lo devuelven). */
export type VariableRemota = Readonly<{
  id: string;
  key: string;
  type: string;
  target: readonly string[];
  /** Atada a una rama de preview: pisa a la general en esa rama. */
  gitBranch: string | null;
  customEnvironmentIds: readonly string[];
}>;

function listaDeTextos(valor: unknown): string[] | null {
  if (valor === undefined || valor === null) return [];
  if (typeof valor === "string") return [valor];
  if (Array.isArray(valor) && valor.every((e) => typeof e === "string")) return [...valor];
  return null;
}

/**
 * Las variables de la respuesta de la lista (`{ envs: [...] }`), o `null` si no tiene esa forma. Es
 * estricta a propósito: una respuesta que no se entiende no se interpreta como «no hay variables»
 * (eso haría creer que no sobra nada ni que falta algo).
 */
export function leerVariablesRemotas(cuerpo: unknown): VariableRemota[] | null {
  const envs = (cuerpo as { envs?: unknown } | null)?.envs;
  if (!Array.isArray(envs)) return null;
  const variables: VariableRemota[] = [];
  for (const crudo of envs as unknown[]) {
    const e = crudo as Record<string, unknown> | null;
    const target = listaDeTextos(e?.["target"]);
    const personalizados = listaDeTextos(e?.["customEnvironmentIds"]);
    if (
      typeof e?.["id"] !== "string" ||
      typeof e["key"] !== "string" ||
      target === null ||
      personalizados === null
    ) {
      return null;
    }
    variables.push({
      id: e["id"],
      key: e["key"],
      type: typeof e["type"] === "string" ? e["type"] : "",
      target,
      gitBranch:
        typeof e["gitBranch"] === "string" && e["gitBranch"] !== "" ? e["gitBranch"] : null,
      customEnvironmentIds: personalizados,
    });
  }
  return variables;
}

/**
 * Los dos secretos de la aplicación, al azar: `ZULUHUB_CLAVE_CONTEXTO` (`1:` + 64 dígitos hexadecimales,
 * la forma `<kid>:<hex>` de `contexto-firmado.ts`) y `ZULUHUB_SECRETO_INVITACIONES` (64 dígitos
 * hexadecimales, `tokens-hmac.ts`). 32 bytes cada uno; `bytesAlAzar` se inyecta para probar.
 */
export const VARIABLE_CLAVE_CONTEXTO = "ZULUHUB_CLAVE_CONTEXTO";
export const VARIABLE_SECRETO_INVITACIONES = "ZULUHUB_SECRETO_INVITACIONES";
const BYTES_DE_SECRETO = 32;

export function generarSecretos(
  bytesAlAzar: (cuantos: number) => Uint8Array = (cuantos) => randomBytes(cuantos),
): readonly ValorACargar[] {
  const hex = () => Buffer.from(bytesAlAzar(BYTES_DE_SECRETO)).toString("hex");
  return [
    { key: VARIABLE_CLAVE_CONTEXTO, value: `1:${hex()}` },
    { key: VARIABLE_SECRETO_INVITACIONES, value: hex() },
  ];
}

export type ValorACargar = Readonly<{ key: string; value: string }>;

export type Paso =
  /** La variable se borra entera: valía solo para el destino pedido. */
  | Readonly<{ tipo: "borrar"; id: string; key: string }>
  /** La variable vale también para otros destinos: se le quita el pedido y se conservan `target`. */
  | Readonly<{ tipo: "recortar"; id: string; key: string; target: readonly string[] }>
  | Readonly<{ tipo: "escribir"; key: string; value: string }>;

export type Plan = Readonly<{
  pasos: readonly Paso[];
  /** Roles que ya tenían contraseña (no hay una nueva) y cuya variable ya está en el destino. */
  yaCargadas: readonly string[];
  /** Roles que ya tenían contraseña y cuya variable NO está en el destino: sin `--rotar` no hay con qué cargarla. */
  faltaRotar: readonly string[];
}>;

function alcanza(variable: VariableRemota, destino: Destino): boolean {
  return variable.target.includes(destino);
}

/** Sacarle el destino a una variable: borrarla si no le queda nada, recortarle el destino si vale para más. */
function sacarDestino(variable: VariableRemota, destino: Destino): Paso {
  const restantes = variable.target.filter((t) => t !== destino);
  return restantes.length === 0 && variable.customEnvironmentIds.length === 0
    ? { tipo: "borrar", id: variable.id, key: variable.key }
    : { tipo: "recortar", id: variable.id, key: variable.key, target: restantes };
}

/** Una variable existente que impide escribir la nuestra tal cual: compartida, no sensible o atada a una rama. */
function chocaConLaEscritura(variable: VariableRemota, destino: Destino): boolean {
  return (
    alcanza(variable, destino) &&
    (variable.target.length > 1 ||
      variable.customEnvironmentIds.length > 0 ||
      variable.type !== "sensitive" ||
      variable.gitBranch !== null)
  );
}

/**
 * Los pasos, en este orden: cada escritura (con lo que choca, justo antes de ella), primero las de las
 * contraseñas —lo que no se puede volver a ver— y después los secretos, y al final lo que sobra. Si algo
 * falla, lo importante ya quedó hecho.
 */
export function planificar(
  entrada: Readonly<{
    destino: Destino;
    existentes: readonly VariableRemota[];
    /** En el orden en que deben escribirse. */
    paraEscribir: readonly ValorACargar[];
    /** Variables de los roles que ya tenían LOGIN y no recibieron contraseña. */
    intactas: readonly string[];
  }>,
): Plan {
  const { destino, existentes } = entrada;
  const pasos: Paso[] = [];
  for (const { key, value } of entrada.paraEscribir) {
    for (const variable of existentes) {
      if (variable.key === key && chocaConLaEscritura(variable, destino)) {
        pasos.push(sacarDestino(variable, destino));
      }
    }
    pasos.push({ tipo: "escribir", key, value });
  }
  for (const variable of existentes) {
    if (sobraEnVercel(variable.key) && alcanza(variable, destino)) {
      pasos.push(sacarDestino(variable, destino));
    }
  }
  const estaCargada = (nombre: string) =>
    existentes.some((v) => v.key === nombre && alcanza(v, destino));
  return {
    pasos,
    yaCargadas: entrada.intactas.filter(estaCargada),
    faltaRotar: entrada.intactas.filter((nombre) => !estaCargada(nombre)),
  };
}
