import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { RUTAS_DE_STOCK } from "../rutas-de-stock";

/**
 * El modelo de vista de «Depósitos» (maquetas aprobadas `stock.html`, 09/11/2026, y `stock-depositos-gestion.html`, 25/11/2026): de lo que entrega la composición, lo que se ve en cada
 * tarjeta (el nombre, el uso, «De venta» si lo es y «Desactivado» si lo está) y las opciones del uso. Puro: sin React ni servidor.
 */

export const RUTAS_DE_DEPOSITOS = {
  lista: RUTAS_DE_STOCK.depositos,
  nuevo: `${RUTAS_DE_STOCK.depositos}/nuevo`,
  /** Editar un depósito: su identificador va en la dirección y es lo único que viene del navegador; el servidor valida que sea de la sucursal elegida. */
  editar: (depositoId: string): string => `${RUTAS_DE_STOCK.depositos}/${depositoId}/editar`,
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
  version: number;
}>;

export type FilaDeDeposito = Readonly<{
  id: string;
  titulo: string;
  uso: string;
  deVenta: boolean;
  activo: boolean;
}>;

/**
 * Las tarjetas de la lista: los activos y también los desactivados (con su estado, para poder reactivarlos). Un uso desconocido no se muestra: ante la duda el sistema cierra.
 */
export function armarLaListaDeDepositos(
  depositos: readonly DepositoDeLaLista[],
  textoDelUso: (clave: ClaveDeTexto) => string,
): readonly FilaDeDeposito[] {
  return depositos.flatMap((d) => {
    const clave = Object.hasOwn(CLAVE_DE_TEXTO_DEL_USO, d.uso)
      ? CLAVE_DE_TEXTO_DEL_USO[d.uso]
      : undefined;
    return clave === undefined
      ? []
      : [
          {
            id: d.id,
            titulo: d.nombre,
            uso: textoDelUso(clave),
            deVenta: d.deVenta,
            activo: d.activo,
          },
        ];
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

/** El texto aprobado del uso de un depósito, o `null` si el uso no figura (lista de permitidos: no se muestra lo que nadie nombró). */
export function textoDelUsoDeUnDeposito(
  uso: string,
  textoDelUso: (clave: ClaveDeTexto) => string,
): string | null {
  const clave = Object.hasOwn(CLAVE_DE_TEXTO_DEL_USO, uso)
    ? CLAVE_DE_TEXTO_DEL_USO[uso]
    : undefined;
  return clave === undefined ? null : textoDelUso(clave);
}
