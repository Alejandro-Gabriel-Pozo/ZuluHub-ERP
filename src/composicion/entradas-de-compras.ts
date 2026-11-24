import { z } from "zod";
import { FORMA_DEL_CURSOR_DE_COMPRAS } from "../modulos/compras/publico";
import { fechaCivilDesdeTexto } from "../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la lista y la ficha de compras (Compras PR 3): de lo que trae la dirección del navegador a lo que reciben las consultas. Son LECTURAS: no escriben ni auditan.
 *
 * Lista de permitidos: de la dirección solo se leen cuatro claves (`estado`, `desde`, `hasta`, `despues`); cualquier otra (`sucursalId`, `empresaId`, `proveedorId`, …) no llega: la
 * sucursal y la empresa las pone el servidor. Un valor fuera de lo permitido cae al por defecto (el estado `TODAS`, sin fechas): la dirección armada a mano nunca rompe la pantalla ni
 * llega a la consulta. El cursor es la excepción: uno con forma inválida es un pedido inválido (el genérico), no se adivina desde dónde seguir; la forma se IMPORTA de compras (una sola regla).
 * Chequeo: `entradas-de-compras.test.ts`.
 */

/** Los dos estados que ofrece el filtro: todas, o las que no tienen factura vigente (`INV` §14 S4; «Por recibir» es de N3). */
export const ESTADOS_DEL_FILTRO_DE_COMPRAS = ["TODAS", "SIN_FACTURAR"] as const;
export type EstadoDelFiltroDeCompras = (typeof ESTADOS_DEL_FILTRO_DE_COMPRAS)[number];

export type EntradaWebDeListarCompras = Readonly<{
  estado: EstadoDelFiltroDeCompras;
  /** Fecha de negocio `AAAA-MM-DD`; `null` = sin límite. */
  desde: string | null;
  hasta: string | null;
  /** El cursor opaco de la página anterior; `null` = primera página. */
  despuesDe: string | null;
}>;

/** El primer valor de una clave de la dirección si es un texto; cualquier otra forma (lista, número, ausente) es «sin dato». */
function textoDe(crudo: unknown, clave: string): string | null {
  if (typeof crudo !== "object" || crudo === null || !Object.hasOwn(crudo, clave)) return null;
  const valor = (crudo as Readonly<Record<string, unknown>>)[clave];
  return typeof valor === "string" ? valor : null;
}

const fechaOSinLimite = (valor: string | null): string | null =>
  valor !== null && fechaCivilDesdeTexto(valor).ok ? valor : null;

/** La lista que pide la dirección: lo no permitido vuelve al valor por defecto; un cursor mal formado rechaza el pedido. */
export function entradaDeListarCompras(
  crudo: unknown,
): Resultado<EntradaWebDeListarCompras, ErrorDeEntrada> {
  const cursor = textoDe(crudo, "despues");
  if (cursor !== null && cursor !== "" && !FORMA_DEL_CURSOR_DE_COMPRAS.test(cursor)) {
    return err({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "despues" });
  }
  const estado = textoDe(crudo, "estado");
  return ok({
    estado: ESTADOS_DEL_FILTRO_DE_COMPRAS.find((e) => e === estado) ?? "TODAS",
    desde: fechaOSinLimite(textoDe(crudo, "desde")),
    hasta: fechaOSinLimite(textoDe(crudo, "hasta")),
    despuesDe: cursor === "" ? null : cursor,
  });
}

const FORMA_DE_LA_FICHA = z.strictObject({ recepcionId: identificador });

/** La ficha de una compra: solo el id (un UUID); cualquier otra cosa es un pedido inválido. */
export function entradaDeFichaDeCompra(
  crudo: unknown,
): Resultado<Readonly<{ recepcionId: string }>, ErrorDeEntrada> {
  return leer(FORMA_DE_LA_FICHA, crudo);
}
