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

/** Traduce un error de la base a un error de persistencia con nombre; `null` si no viene de la base. */
export function traducirErrorDeBase(error: unknown): ErrorDePersistencia | null {
  // El pozo agotado no es un error de la base pero sí un fallo esperable y controlado: sale tipado (el traductor único lo vuelve el
  // error genérico con referencia), no como una excepción cruda que rompería la pantalla.
  if (esPozoAgotado(error)) {
    return {
      tipo: "Inesperado",
      sqlstate: null,
      mensaje: "no hubo una conexión libre a la base a tiempo (pozo agotado)",
    };
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
