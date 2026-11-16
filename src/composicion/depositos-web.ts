import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * «Depósitos» de stock (maqueta aprobada `stock.html`, 09/11/2026, pestaña «Depósitos»): los depósitos de UNA sucursal. Reglas:
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance de la persona): llega como argumento, nunca del pedido del navegador. El caso de
 *    uso vuelve a validarla dentro de su transacción. Nunca «todas».
 *  - Editar, desactivar y reactivar existen en el servidor y NO tienen pantalla: la maqueta no los dibuja (alcance cerrado, `pantallas-de-stock-inventario.md` §3).
 */

export type DependenciasDeDepositosWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeStock"]>, "listarDepositos">;
  respuesta: DependenciasDeRespuesta;
}>;

export type DepositoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  uso: string;
  deVenta: boolean;
  activo: boolean;
}>;

export type DepositosParaLaPantalla = Readonly<{ depositos: readonly DepositoParaLaPantalla[] }>;

/** Los depósitos de la sucursal con la que trabaja la persona, también los desactivados (la pantalla decide cuáles muestra). Es una LECTURA: no escribe ni audita. */
export function listarLosDepositos(
  d: DependenciasDeDepositosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<DepositosParaLaPantalla>> {
  return accionDeStock(
    d.respuesta,
    {},
    () => ({ ok: true, valor: {} }),
    () => d.consultas().listarDepositos(contexto, { sucursalId }),
    (lista) => ({
      depositos: lista.map((x) => ({
        id: x.id,
        nombre: x.nombre,
        uso: x.uso,
        deVenta: x.deVenta,
        activo: x.activo,
      })),
    }),
  );
}
