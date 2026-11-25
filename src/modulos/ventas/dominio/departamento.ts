import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * EL DEPARTAMENTO DE UNA CUENTA (dueño, 25/11/2026, vía el orquestador: el departamento sale del PRODUCTO, como las categorías; la cuenta ya no lo pide. DEC-1066; reemplaza DEC-0363 y DEC-0364).
 * Cada línea congela el departamento y el camino de su producto (0047), y los reportes por departamento salen de las líneas. La cuenta lo guarda solo si quien la abre lo nombra:
 *  - se pidió uno: tiene que existir como departamento y estar activo (`DEPARTAMENTO_NO_ENCONTRADO`, `DEPARTAMENTO_INACTIVO`); un nodo que no es de primer nivel no vale;
 *  - no se pidió: la cuenta queda sin departamento (`null`) con 0, 1 o 2 o más activos. Nunca «todos» ni el primero, y no hay error por falta de elección.
 * Puro. Previene: una cuenta con un departamento que nadie eligió, o abrir una mesa del hotel (2 o 3 departamentos) sin poder elegir uno que la cuenta ya no necesita.
 */
export type NodoParaElegir = Readonly<{ id: string; padreId: string | null; activo: boolean }>;

export type ErrorDeDepartamento = "DEPARTAMENTO_NO_ENCONTRADO" | "DEPARTAMENTO_INACTIVO";

export function departamentoDeLaCuenta(
  nodos: readonly NodoParaElegir[],
  pedido: string | undefined,
): Resultado<string | null, ErrorDeDepartamento> {
  const departamentos = nodos.filter((n) => n.padreId === null);
  if (pedido !== undefined) {
    const elegido = departamentos.find((d) => d.id === pedido);
    if (elegido === undefined) return err("DEPARTAMENTO_NO_ENCONTRADO");
    return elegido.activo ? ok(elegido.id) : err("DEPARTAMENTO_INACTIVO");
  }
  return ok(null);
}
