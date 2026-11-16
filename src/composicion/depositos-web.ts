import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { USOS_DE_DEPOSITO } from "../modulos/stock/publico";
import { entradaDeAltaDeDeposito } from "./entradas-de-depositos";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * «Depósitos» de stock (maqueta aprobada `stock.html`, 09/11/2026, pestaña «Depósitos»): los depósitos de UNA sucursal y agregar uno nuevo. Reglas:
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance de la persona): llega como argumento, nunca del pedido del navegador. El caso de
 *    uso vuelve a validarla dentro de su transacción. Nunca «todas».
 *  - **Agregar repetido no duplica**: el `id` lo genera la pantalla al abrir el formulario; el mismo `id` con el mismo contenido devuelve el depósito ya creado (`yaExistia`), sin escribir
 *    ni auditar de nuevo. Un nombre repetido en la sucursal sale con su texto propio; «de venta» solo corresponde al uso «Normal» y es uno por sucursal: si no corresponde, el genérico
 *    (lo decide el servidor, la pantalla no replica la regla).
 *  - Editar, desactivar y reactivar existen en el servidor y NO tienen pantalla: la maqueta no los dibuja (alcance cerrado, `pantallas-de-stock-inventario.md` §3).
 */

/** Los usos de un depósito, de donde los toma la pantalla para ofrecerlos: una regla, un lugar (la lista es la del servidor y la de la base). */
export { USOS_DE_DEPOSITO };

export type DependenciasDeDepositosWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeStock"]>, "crearDeposito">;
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

export function agregarElDeposito(
  d: DependenciasDeDepositosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ depositoId: string }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeAltaDeDeposito,
    (entrada) => d.casosDeUso().crearDeposito(contexto, { ...entrada, sucursalId }),
    (salida) => ({ depositoId: salida.depositoId }),
  );
}
