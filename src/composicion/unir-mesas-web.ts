import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeSalon } from "../modulos/salon/publico";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { leerElPedidoDeUnir } from "./entradas-de-cuenta-de-mesa";
import { accionDelSalon } from "./errores-de-salon";

/**
 * «Unir con otra mesa» (SAL-E1; `unirMesas` del salón, E7 §3.8): los ítems de la cuenta origen pasan a la destino SIN recotizar (el total se conserva al centavo) y la origen queda abierta y vacía como reserva hasta que se
 * cobra el destino. No se deshace (para separar se divide la cuenta). Las dos cuentas tienen que ser de la sucursal de trabajo (la fija el servidor y la valida el caso de uso, también en una repetición); repetir con el mismo
 * `unionId` y clave devuelve `yaExistia` sin mover nada; los motivos de «No se pueden unir» salen con su texto aprobado (mesa libre, con cobro) o sin motivo. Chequeo: `test/integracion/unir-mesas-web.test.ts`.
 */
export type DependenciasDeUnirMesasWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeSalon, "unirMesas">;
  respuesta: DependenciasDeRespuesta;
}>;

export function unirLasMesas(
  d: DependenciasDeUnirMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<
  Respuesta<
    Readonly<{
      unionId: string;
      lineasMovidas: number;
      totalDestino: { moneda: string; monto: string };
      yaExistia: boolean;
    }>
  >
> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeUnir,
    (pedido) => d.casosDeUso().unirMesas(contexto, { ...pedido, sucursalDeTrabajo: sucursalId }),
    (s) => ({
      unionId: s.unionId,
      lineasMovidas: s.lineasMovidas,
      totalDestino: { moneda: s.totalDestino.moneda, monto: s.totalDestino.monto },
      yaExistia: s.yaExistia,
    }),
  );
}
