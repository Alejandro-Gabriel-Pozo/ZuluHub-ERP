import pg from "pg";
import type { ErrorDePersistencia } from "../../puertos/transacciones";

/** Falta o es inválida una pieza de configuración (cadena de conexión, clave de contexto). */
export class ErrorDeConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeConfiguracion";
  }
}

/** SQLSTATE de un conflicto de serialización y de un deadlock: el trabajo se repite. */
export const SQLSTATE_REINTENTABLES: ReadonlySet<string> = new Set(["40001", "40P01"]);

export function esReintentable(error: unknown): boolean {
  return error instanceof pg.DatabaseError && SQLSTATE_REINTENTABLES.has(error.code ?? "");
}

/** El mensaje con el que `pg-pool` rechaza un pedido que esperó de más por una conexión libre. */
const MENSAJE_DE_POZO_AGOTADO = "timeout exceeded when trying to connect";

/** ¿Este error es «el pozo estaba agotado y se acabó la espera»? */
export function esPozoAgotado(error: unknown): boolean {
  return error instanceof Error && error.message === MENSAJE_DE_POZO_AGOTADO;
}

/**
 * Por qué no se pudo contar con la conexión a la base. Dos causas, las dos con un mensaje FIJO y genérico (sin host, puerto, usuario ni
 * cadena): lo que dicen `pg` y el sistema trae el host, y eso no sale del adaptador.
 */
export type CausaDeConexion = "POZO_AGOTADO" | "CONEXION_CORTADA";

const MENSAJES_DE_CONEXION: Readonly<Record<CausaDeConexion, string>> = {
  POZO_AGOTADO: "no hubo una conexión libre a la base a tiempo (pozo agotado)",
  CONEXION_CORTADA: "se cortó la conexión con la base",
};

/**
 * Un fallo de conexión ya tipado. Lo lanza el pozo (`pozos.ts`) al pedir una conexión, para TODOS los roles: así el agotamiento del pozo
 * del rol de autenticación, que consume la librería de ingreso y no pasa por `traducirErrorDeBase`, sale con el mismo tipo y mensaje
 * que el de la app y no como una excepción cruda de `pg-pool`.
 */
export class ErrorDeConexionDeBase extends Error {
  readonly causa: CausaDeConexion;
  constructor(causa: CausaDeConexion) {
    super(MENSAJES_DE_CONEXION[causa]);
    this.name = "ErrorDeConexionDeBase";
    this.causa = causa;
  }
}

/** Los mensajes EXACTOS con los que `pg` rechaza una consulta sobre (o durante) una conexión que se cortó. */
const MENSAJES_DE_CONEXION_CORTADA: ReadonlySet<string> = new Set([
  "Connection terminated unexpectedly",
  "Connection terminated",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
]);

/** Códigos del sistema (red) que Node pone en el error de un socket que se cae o no llega. Lista cerrada. */
const CODIGOS_DE_RED_CORTADA: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * SQLSTATE con los que el servidor avisa que corta la conexión: 57P01 (`pg_terminate_backend`, apagado, Neon reiniciando el cómputo),
 * 57P02 (caída del servidor) y 57P03 (todavía no acepta conexiones).
 */
const SQLSTATE_DE_CORTE: ReadonlySet<string> = new Set(["57P01", "57P02", "57P03"]);

/** ¿Este error es «la conexión se cortó»? Lista blanca de formas conocidas; cualquier otra cosa devuelve `false`. */
export function esConexionCortada(error: unknown): boolean {
  if (error instanceof ErrorDeConexionDeBase) return error.causa === "CONEXION_CORTADA";
  if (error instanceof pg.DatabaseError) {
    const codigo = error.code ?? "";
    // La clase 08 es «connection exception» entera (08000, 08003, 08006, ...).
    return SQLSTATE_DE_CORTE.has(codigo) || codigo.startsWith("08");
  }
  if (!(error instanceof Error)) return false;
  if (MENSAJES_DE_CONEXION_CORTADA.has(error.message)) return true;
  const codigo = (error as Error & { code?: unknown }).code;
  return typeof codigo === "string" && CODIGOS_DE_RED_CORTADA.has(codigo);
}

/** La causa de conexión de un error, o `null` si no es un fallo de conexión conocido. */
export function causaDeConexion(error: unknown): CausaDeConexion | null {
  if (error instanceof ErrorDeConexionDeBase) return error.causa;
  if (esPozoAgotado(error)) return "POZO_AGOTADO";
  return esConexionCortada(error) ? "CONEXION_CORTADA" : null;
}

/** Traduce un error de la base a un error de persistencia con nombre; `null` si no viene de la base. */
export function traducirErrorDeBase(error: unknown): ErrorDePersistencia | null {
  // El pozo agotado y el corte de la conexión no son errores de la base pero sí fallos esperables y controlados: salen tipados (el
  // traductor único los vuelve el error genérico con referencia), no como una excepción cruda que rompería la pantalla.
  const causa = causaDeConexion(error);
  if (causa !== null) {
    return { tipo: "Inesperado", sqlstate: null, mensaje: MENSAJES_DE_CONEXION[causa] };
  }
  if (!(error instanceof pg.DatabaseError)) return null;
  const restriccion = error.constraint ?? null;
  switch (error.code) {
    case "23505":
      return { tipo: "Unicidad", restriccion };
    case "23P01":
      return { tipo: "Superposicion", restriccion };
    case "23503":
      return { tipo: "Referencia", restriccion };
    case "23514":
      return { tipo: "Check", restriccion };
    case "42501":
      return { tipo: "AccesoDenegado" };
    case "25P02":
      // Lo produce el adaptador al verificar, antes de confirmar, que la transacción siga sana.
      return {
        tipo: "Inesperado",
        sqlstate: "25P02",
        mensaje:
          "la transacción quedó abortada: el trabajo atrapó un error de la base y siguió; " +
          "un error de la base se propaga, no se atrapa",
      };
    default:
      return { tipo: "Inesperado", sqlstate: error.code ?? null, mensaje: error.message };
  }
}
