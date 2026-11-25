import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { USOS_DE_DEPOSITO } from "../modulos/stock/publico";
import {
  entradaDeAltaDeDeposito,
  entradaDeCambioDeEstadoDeDeposito,
  entradaDeEdicionDeDeposito,
} from "./entradas-de-depositos";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * «Depósitos» de stock (maqueta aprobada `stock.html`, 09/11/2026, pestaña «Depósitos»): los depósitos de UNA sucursal y agregar uno nuevo. Reglas:
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance de la persona): llega como argumento, nunca del pedido del navegador. El caso de
 *    uso vuelve a validarla dentro de su transacción. Nunca «todas».
 *  - **Agregar repetido no duplica**: el `id` lo genera la pantalla al abrir el formulario; el mismo `id` con el mismo contenido devuelve el depósito ya creado (`yaExistia`), sin escribir
 *    ni auditar de nuevo. Un nombre repetido en la sucursal sale con su texto propio; «de venta» solo corresponde al uso «Normal» y es uno por sucursal: si no corresponde, el genérico
 *    (lo decide el servidor, la pantalla no replica la regla).
 *  - **Editar, desactivar y reactivar** (STK-A, maqueta `stock-depositos-gestion.html`, aprobada el 25/11/2026): editar lleva la versión que se vio (si otra persona lo cambió antes, el servidor
 *    rechaza con `DEPOSITO_DESACTUALIZADO`); repetir una edición ya aplicada, un desactivar de un depósito ya desactivado o un reactivar de uno ya activo devuelve lo vigente sin escribir ni auditar de nuevo.
 *    Que un depósito con existencia, con un conteo abierto o «de venta» no se desactiva lo decide el servidor (la base lo impone), la pantalla no replica la regla. El uso no cambia.
 */

/** Los usos de un depósito, de donde los toma la pantalla para ofrecerlos: una regla, un lugar (la lista es la del servidor y la de la base). */
export { USOS_DE_DEPOSITO };

export type DependenciasDeDepositosWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeStock"]>,
    "crearDeposito" | "editarDeposito" | "desactivarDeposito" | "reactivarDeposito"
  >;
  consultas: () => Pick<ReturnType<Web["consultasDeStock"]>, "listarDepositos">;
  respuesta: DependenciasDeRespuesta;
}>;

export type DepositoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  uso: string;
  deVenta: boolean;
  activo: boolean;
  /** La versión que se ve: la edición la devuelve como `versionEsperada` (control de versión). */
  version: number;
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
        version: x.version,
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

/** Un depósito de la sucursal elegida, para editarlo. Uno que no existe, de otra sucursal o fuera del alcance de la persona sale como el genérico (indistinguible de «no existe»). */
export async function verElDeposito(
  d: DependenciasDeDepositosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  depositoId: string,
): Promise<Respuesta<DepositoParaLaPantalla>> {
  const lectura = await listarLosDepositos(d, contexto, sucursalId);
  if (!lectura.ok) return lectura;
  const deposito = lectura.dato.depositos.find((x) => x.id === depositoId);
  return deposito === undefined
    ? { ok: false, error: errorDeCodigo("STOCK_ACCION_NO_PERMITIDA") }
    : { ok: true, dato: deposito };
}

/** Cambia el nombre y si es «de venta» con la versión que se vio. Devuelve la versión vigente (`yaEstaba`: lo pedido ya era lo guardado, no se escribió ni se auditó). */
export function editarElDeposito(
  d: DependenciasDeDepositosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number; yaEstaba: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeEdicionDeDeposito,
    (entrada) => d.casosDeUso().editarDeposito(contexto, entrada),
    (salida) => ({ version: salida.version, yaEstaba: salida.yaEstaba }),
  );
}

/** Desactiva (`activo: false`) o reactiva (`activo: true`) el depósito. Repetirlo no escribe ni audita (`yaEstaba`). */
export function cambiarElEstadoDelDeposito(
  d: DependenciasDeDepositosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  activo: boolean,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeCambioDeEstadoDeDeposito,
    (entrada) =>
      activo
        ? d.casosDeUso().reactivarDeposito(contexto, entrada)
        : d.casosDeUso().desactivarDeposito(contexto, entrada),
    (salida) => ({ yaEstaba: salida.yaEstaba }),
  );
}
