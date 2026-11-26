import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Membresia } from "./membresia";

/**
 * Asignar un rol a una persona de la empresa (H4b T4b-2). Puro: lo leído llega por parámetro y se devuelve QUÉ HAY QUE HACER. El gerente nunca se toca (ni como origen ni como
 * destino: la base lo repite) y un rol propio archivado no se asigna. Asignar el rol que ya tiene es inocuo. Chequeo: `asignacion-de-rol.test.ts`.
 */

/** A qué rol se pasa: uno de los dos base que se pueden asignar (el gerente solo se traspasa) o un rol propio de la empresa. */
export type DestinoDeRol =
  | Readonly<{ tipo: "BASE"; rol: "ADMINISTRADOR" | "OPERADOR" }>
  | Readonly<{ tipo: "PROPIO"; rolId: string }>;

export type ErrorDeAsignacionDeRol =
  "MEMBRESIA_NO_ENCONTRADA" | "ES_EL_GERENTE" | "ROL_NO_ENCONTRADO" | "ROL_ARCHIVADO";

export function decidirAsignacionDeRol(datos: {
  objetivo: Membresia | null;
  destino: DestinoDeRol;
  /** El rol propio de la empresa que el destino nombra, si el destino es uno propio. */
  rolPropio: Readonly<{ id: string; activo: boolean }> | null;
}): Resultado<"ASIGNAR" | "YA_TENIA_ESE_ROL", ErrorDeAsignacionDeRol> {
  const { objetivo, destino, rolPropio } = datos;
  if (objetivo === null) return err("MEMBRESIA_NO_ENCONTRADA");
  if (objetivo.rol === "GERENTE") return err("ES_EL_GERENTE");
  if (destino.tipo === "BASE") {
    return ok(objetivo.rol === destino.rol ? "YA_TENIA_ESE_ROL" : "ASIGNAR");
  }
  if (rolPropio === null) return err("ROL_NO_ENCONTRADO");
  if (!rolPropio.activo) return err("ROL_ARCHIVADO");
  return ok(
    objetivo.rol === "PROPIO" && objetivo.rolPropioId === destino.rolId
      ? "YA_TENIA_ESE_ROL"
      : "ASIGNAR",
  );
}
