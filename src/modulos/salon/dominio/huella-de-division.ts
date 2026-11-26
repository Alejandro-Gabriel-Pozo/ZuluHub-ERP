import { createHash } from "node:crypto";
import type { Asignacion } from "../../../primitivas/cuentas/division";

/**
 * La huella de lo que pidió quien divide: sha256 (hex) de la cuenta, la cantidad de partes y las asignaciones en orden canónico (texto de cada una, ordenado). La
 * misma división con el mismo `divisionId` devuelve lo hecho; con otra huella es un conflicto. Puro: sin reloj ni azar.
 */
export function huellaDeDivision(
  entrada: Readonly<{ cuentaId: string; partes: number; asignaciones: readonly Asignacion[] }>,
): string {
  // Cada asignación como texto canónico y la lista ordenada por ese texto (orden por defecto, sin comparador): no depende del orden de entrada.
  const canonicas = entrada.asignaciones
    .map((a) =>
      JSON.stringify(
        a.forma === "ENTERO"
          ? [a.lineaId, a.forma, a.parte]
          : a.forma === "POR_UNIDADES"
            ? [a.lineaId, a.forma, ...a.cantidades]
            : [a.lineaId, a.forma, ...[...a.partes].sort((x, y) => x - y)],
      ),
    )
    .sort();
  return createHash("sha256")
    .update(JSON.stringify([entrada.cuentaId, entrada.partes, canonicas]))
    .digest("hex");
}
