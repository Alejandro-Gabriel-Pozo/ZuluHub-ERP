import type { RolDeLaMembresia } from "../permisos/roles";

export type { RolDeLaMembresia };

/**
 * CONJUNTO EFECTIVO (H4b §3.3): qué acciones tiene una persona según su membresía. Puro: lo que se leyó de la base llega por
 * parámetro. NO resta el plan: lo sigue evaluando el guard por módulo (activo, solo lectura, en desarrollo).
 *
 *  - `GERENTE`: todas las acciones del catálogo (no tiene lista editable, S2).
 *  - `ADMINISTRADOR` y `OPERADOR`: la versión vigente de su plantilla.
 *  - `PROPIO`: la versión vigente de su rol propio.
 *
 * Nace cerrado: sin rol, sin plantilla o rol que no se pudo leer, o rol propio archivado = conjunto vacío (DEC-0951). Una clave guardada que ya no
 * existe en el catálogo no otorga nada y no bloquea las demás (S10). Previene: que un dato faltante, viejo o corrupto otorgue permisos
 * (escalada de privilegios) o que una clave retirada del catálogo rompa a todo el rol. Chequeo: `conjunto-efectivo.test.ts` y
 * `conjunto-efectivo.propiedades.test.ts`.
 */
export type FuentesDelConjunto = Readonly<{
  /** Todas las acciones del catálogo del código (la fuente de verdad de qué existe). */
  catalogo: ReadonlySet<string>;
  /** Las acciones de la versión vigente de la plantilla, o `null` si no se pudo leer. */
  plantilla: (clave: "ADMINISTRADOR" | "OPERADOR") => readonly string[] | null;
  /** El rol propio de la membresía (su versión vigente), o `null` si no existe o no se pudo leer. */
  rolPropio: Readonly<{ activo: boolean; acciones: readonly string[] }> | null;
}>;

function dentroDelCatalogo(
  acciones: readonly string[] | null,
  catalogo: ReadonlySet<string>,
): ReadonlySet<string> {
  if (acciones === null) return new Set();
  return new Set(acciones.filter((accion) => catalogo.has(accion)));
}

export function conjuntoEfectivo(
  rol: RolDeLaMembresia | null,
  fuentes: FuentesDelConjunto,
): ReadonlySet<string> {
  switch (rol) {
    case "GERENTE":
      return new Set(fuentes.catalogo);
    case "ADMINISTRADOR":
    case "OPERADOR":
      return dentroDelCatalogo(fuentes.plantilla(rol), fuentes.catalogo);
    case "PROPIO":
      return fuentes.rolPropio !== null && fuentes.rolPropio.activo
        ? dentroDelCatalogo(fuentes.rolPropio.acciones, fuentes.catalogo)
        : new Set();
    default:
      return new Set();
  }
}
