import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * EL DEPARTAMENTO DE UNA CUENTA (A2c, decisión del dueño 13/11/2026: el departamento elegido se pega a la cuenta al abrirla y no cambia; no hay departamento por
 * defecto, `decisiones-del-dueno-2026-11.md`). Un departamento es un nodo de primer nivel de la clasificación (`padreId` nulo). Quién elige qué departamento lleva una
 * cuenta nueva se decide acá, en UN solo lugar, con lo que hay en la empresa:
 *  - se pidió uno: tiene que existir como departamento y estar activo (`DEPARTAMENTO_NO_ENCONTRADO`, `DEPARTAMENTO_INACTIVO`); un nodo que no es de primer nivel no vale;
 *  - no se pidió y la empresa no tiene departamentos activos: la cuenta queda «sin departamento» (`null`); con uno solo activo, es ese;
 *  - no se pidió y hay dos o más activos: `DEPARTAMENTO_REQUERIDO`. Nunca se asume «todos» ni el primero (nace cerrado).
 * Confirmado por el dueño el 13/11/2026 (DEC-0363): con exactamente un departamento activo la cuenta lo toma sin que la pantalla lo mande (el selector está
 * oculto con 0 o 1). Revertirlo es exigir `DEPARTAMENTO_REQUERIDO` también con uno. Puro. Previene: abrir una cuenta en el departamento equivocado por «asumir todos».
 */
export type NodoParaElegir = Readonly<{ id: string; padreId: string | null; activo: boolean }>;

export type ErrorDeDepartamento =
  "DEPARTAMENTO_NO_ENCONTRADO" | "DEPARTAMENTO_INACTIVO" | "DEPARTAMENTO_REQUERIDO";

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
  const activos = departamentos.filter((d) => d.activo);
  const [unico] = activos;
  if (unico === undefined) return ok(null);
  return activos.length === 1 ? ok(unico.id) : err("DEPARTAMENTO_REQUERIDO");
}
