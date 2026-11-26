import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeSalon } from "../modulos/salon/publico";
import { err } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { leerElPedidoDeDividir } from "./entradas-de-cuenta-de-mesa";
import { accionDelSalon, errorDeDividir } from "./errores-de-salon";

/**
 * «Dividir la cuenta» por ítems (SAL-E2; `dividirCuenta` del salón, E7 §3.9): cada línea va entera a una cuenta, por unidades o compartida; las hijas se cobran por separado y la madre queda de reserva hasta
 * cobrar la última. La sucursal la fija el servidor y la valida el caso de uso (una cuenta de otra es «no existe», también en una repetición); repetir con el mismo `divisionId` devuelve las mismas cuentas
 * (`yaExistia`), con otra asignación no se pisa. Los motivos de «unir» salen como el genérico. Por porcentaje NO hay caso de uso: es un cobro con varios importes (DEC-1032). Chequeo: `test/integracion/dividir-cuenta-web.test.ts`.
 */
export type DependenciasDeDividirCuentaWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeSalon, "dividirCuenta">;
  respuesta: DependenciasDeRespuesta;
}>;

export function dividirLaCuenta(
  d: DependenciasDeDividirCuentaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<
  Respuesta<
    Readonly<{
      divisionId: string;
      cuentas: readonly Readonly<{
        numero: number;
        cuentaId: string;
        total: { moneda: string; monto: string };
      }>[];
      yaExistia: boolean;
    }>
  >
> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeDividir,
    async (pedido) => {
      const hecho = await d
        .casosDeUso()
        .dividirCuenta(contexto, { ...pedido, sucursalDeTrabajo: sucursalId });
      return hecho.ok ? hecho : err(errorDeDividir(hecho.error));
    },
    (s) => ({
      divisionId: s.divisionId,
      cuentas: s.cuentas.map((c) => ({
        numero: c.numero,
        cuentaId: c.cuentaId,
        total: { moneda: c.total.moneda, monto: c.total.monto },
      })),
      yaExistia: s.yaExistia,
    }),
  );
}
