import pg from "pg";
import type { ErrorDePersistencia } from "../../puertos/transacciones";

/** SQLSTATE de un conflicto de serialización y de un deadlock: el trabajo se repite. */
export const SQLSTATE_REINTENTABLES: ReadonlySet<string> = new Set(["40001", "40P01"]);

export function esReintentable(error: unknown): boolean {
  return error instanceof pg.DatabaseError && SQLSTATE_REINTENTABLES.has(error.code ?? "");
}

/** Traduce un error de la base a un error de persistencia con nombre; `null` si no viene de la base. */
export function traducirErrorDeBase(error: unknown): ErrorDePersistencia | null {
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
