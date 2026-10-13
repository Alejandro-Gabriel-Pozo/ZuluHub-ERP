import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeNumeracion } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import {
  cerrarEnTx,
  type EntradaDeCerrarReserva,
  type ErrorPropioAlCerrar,
  type SalidaDeCerrarReserva,
} from "./numeracion-en-tx";

export type { EntradaDeCerrarReserva, SalidaDeCerrarReserva };

export type ErrorAlCerrarReserva =
  ErrorPropioAlCerrar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * Cerrar la reserva con el resultado de la autorización (H7, §B.8). Contexto OPERATIVO con persona.
 * En una transacción serializable: el guard (`comprobantes.emitir`) y, ya con el permiso, el cuerpo
 * común de la numeración (`cerrarEnTx`): autorizado avanza el último número, rechazado o no enviado
 * libera sin avanzar, incierto no escribe nada. Idempotente: cerrar dos veces lo mismo da el mismo
 * éxito, sin avanzar dos veces.
 */
export function armarCerrarReservaDeNumero({ transacciones, reglas }: DependenciasDeNumeracion) {
  return async function cerrarReservaDeNumero(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarReserva,
  ): Promise<Resultado<SalidaDeCerrarReserva, ErrorAlCerrarReserva>> {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCerrarReserva, ErrorPropioAlCerrar | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.cerrarReservaDeNumero.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return cerrarEnTx(tx, contexto, entrada);
      },
    );
  };
}
