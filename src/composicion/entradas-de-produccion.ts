import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de las pantallas de órdenes de producción: de lo que pide la dirección o manda el navegador a lo que reciben las consultas y los casos de uso. Pura: sin base ni
 * servidor. La empresa, la persona y la sucursal NO se leen del pedido (las pone el servidor).
 *
 * Lista de permitidos: el filtro de estado de la lista pasa solo lo que declara (`ESTADOS_DEL_FILTRO_DE_ORDENES`: hoy, «ABIERTA»); cualquier otro texto devuelve `null` («nada puede
 * coincidir»: la lista sale vacía sin consultar, nunca se ensancha el filtro). Esta capa dice si el dato tiene la FORMA pedida (un id, un texto acotado); si el motivo sirve (largo,
 * caracteres) lo decide la primitiva del motivo dentro del caso de uso, en la transacción.
 * Previene: un id con forma inválida que llega al `::uuid` de la consulta y un filtro libre que llega sin validar. Chequeo: `entradas-de-produccion.test.ts`.
 */

/** Los estados que ofrece el filtro de la lista. «Todas» es no filtrar (cadena vacía). */
export const ESTADOS_DEL_FILTRO_DE_ORDENES = ["ABIERTA"] as const;
export type EstadoDelFiltroDeOrdenes = (typeof ESTADOS_DEL_FILTRO_DE_ORDENES)[number];

export type EntradaDeLaListaDeOrdenes = Readonly<{ estado: string }>;

/** Lo que acepta la consulta de la lista, o `null` si nada puede coincidir con lo pedido. */
export function leerLaEntradaDeLaListaDeOrdenes(
  entrada: EntradaDeLaListaDeOrdenes,
): Readonly<{ estado?: EstadoDelFiltroDeOrdenes }> | null {
  if (entrada.estado === "") return {};
  const estado = ESTADOS_DEL_FILTRO_DE_ORDENES.find((permitido) => permitido === entrada.estado);
  return estado === undefined ? null : { estado };
}

const formaDeOrden = z.object({ ordenId: identificador });
const formaDeMotivo = z.object({ ordenId: identificador, motivo: texto });

export type EntradaWebDeOrden = Readonly<{ ordenId: string }>;
export type EntradaWebDeMotivo = Readonly<{ ordenId: string; motivo: string }>;

export function entradaDeOrden(crudo: unknown): Resultado<EntradaWebDeOrden, ErrorDeEntrada> {
  const forma = leer(formaDeOrden, crudo);
  return forma.ok ? ok({ ordenId: forma.valor.ordenId }) : forma;
}

/** Cancelar o anular una orden: el id y el motivo (texto de formulario; el largo y los caracteres válidos los decide el caso de uso). */
export function entradaDeMotivoDeOrden(
  crudo: unknown,
): Resultado<EntradaWebDeMotivo, ErrorDeEntrada> {
  const forma = leer(formaDeMotivo, crudo);
  return forma.ok ? ok({ ordenId: forma.valor.ordenId, motivo: forma.valor.motivo }) : forma;
}
