import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { RUTAS_DE_STOCK } from "../rutas-de-stock";

/**
 * El modelo de vista de «Depósitos» (maqueta aprobada `stock.html`, 09/11/2026): de lo que entrega la composición, lo que se ve en cada tarjeta (el nombre, el uso y «De venta» si lo
 * es) y las opciones del uso. Puro: sin React ni servidor.
 */

export const RUTAS_DE_DEPOSITOS = {
  lista: RUTAS_DE_STOCK.depositos,
  nuevo: `${RUTAS_DE_STOCK.depositos}/nuevo`,
} as const;

/** El texto aprobado de cada uso (`stock.deposito.*`, 09/11/2026). Un uso que no figura acá no se muestra ni se ofrece (lista de permitidos): `test/web/stock-depositos-modelo.test.ts` la compara con la del servidor. */
export const CLAVE_DE_TEXTO_DEL_USO: Readonly<Record<string, ClaveDeTexto>> = {
  NORMAL: "stock.deposito.normal",
  CUARENTENA: "stock.deposito.cuarentena",
  RECHAZO: "stock.deposito.rechazo",
};

/** El único uso al que le corresponde «De venta». */
export const USO_DE_VENTA = "NORMAL";

/** Un depósito como lo entrega la composición. */
export type DepositoDeLaLista = Readonly<{
  id: string;
  nombre: string;
  uso: string;
  deVenta: boolean;
  activo: boolean;
}>;

export type FilaDeDeposito = Readonly<{
  id: string;
  titulo: string;
  uso: string;
  deVenta: boolean;
}>;

/**
 * Las tarjetas de la lista. La maqueta no dibuja el estado ni editar, desactivar o reactivar: se muestran solo los depósitos activos (uno desactivado no opera y la pantalla no tiene
 * cómo reactivarlo). Un uso desconocido no se muestra: ante la duda el sistema cierra.
 */
export function armarLaListaDeDepositos(
  depositos: readonly DepositoDeLaLista[],
  textoDelUso: (clave: ClaveDeTexto) => string,
): readonly FilaDeDeposito[] {
  return depositos.flatMap((d) => {
    const clave = Object.hasOwn(CLAVE_DE_TEXTO_DEL_USO, d.uso)
      ? CLAVE_DE_TEXTO_DEL_USO[d.uso]
      : undefined;
    return d.activo && clave !== undefined
      ? [{ id: d.id, titulo: d.nombre, uso: textoDelUso(clave), deVenta: d.deVenta }]
      : [];
  });
}

/** Las opciones del selector «Uso», en el orden de la lista del servidor, solo con los usos que tienen texto aprobado. */
export function opcionesDeUso(
  usos: readonly string[],
  textoDelUso: (clave: ClaveDeTexto) => string,
): readonly Readonly<{ valor: string; etiqueta: string }>[] {
  return usos.flatMap((uso) => {
    const clave = Object.hasOwn(CLAVE_DE_TEXTO_DEL_USO, uso)
      ? CLAVE_DE_TEXTO_DEL_USO[uso]
      : undefined;
    return clave === undefined ? [] : [{ valor: uso, etiqueta: textoDelUso(clave) }];
  });
}
