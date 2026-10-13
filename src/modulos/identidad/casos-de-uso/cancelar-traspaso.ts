import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeCancelacionDeTraspaso } from "../dominio/errores";
import { decidirCancelacion } from "../dominio/traspaso";
import { cargarEmpresas } from "./comun";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { cancelarYAuditar } from "./traspaso-comun";

export type EntradaDeCancelarTraspaso = Readonly<Record<never, never>>;

export type SalidaDeCancelarTraspaso = Readonly<{
  /** `true`: no había una propuesta en curso; no se escribió nada. */
  yaNoHabia: boolean;
}>;

export type ErrorAlCancelarTraspaso =
  ErrorDeCancelacionDeTraspaso | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * El gerente cancela la propuesta de traspaso en curso (H6, §B.3, paso 4). Contexto OPERATIVO con
 * persona. En una transacción serializable: el guard (`gerencia.cancelar_traspaso`, solo el
 * gerente), la empresa opera, y el dominio decide (`decidirCancelacion`: sin propuesta en curso no
 * hay nada que hacer; una vigente o una vencida que sigue guardada se cancela). Deja la auditoría
 * `TRASPASO_CANCELADO` en la misma transacción. Cancelar sin propuesta es ok y no escribe.
 *
 * Cancelar y aceptar a la vez: las dos actualizan la misma fila condicionada a `PROPUESTO` y a su
 * versión, así que la serializable deja pasar una. Si gana la aceptación, el reintento de la
 * cancelación ya no es gerente (`SIN_PERMISO`); si gana la cancelación, la aceptación devuelve
 * `TRASPASO_RESUELTO`. Nunca quedan las dos.
 */
export function crearCancelarTraspaso({ transacciones, reglas }: DependenciasDeIdentidad) {
  // La cancelación no lleva datos (cancela la única propuesta en curso de la empresa): el tipo de la
  // entrada fija la forma de la llamada y la función no la lee.
  const cancelarTraspaso: (
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarTraspaso,
  ) => Promise<Resultado<SalidaDeCancelarTraspaso, ErrorAlCancelarTraspaso>> = async (contexto) => {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCancelarTraspaso,
          ErrorDeCancelacionDeTraspaso | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.cancelarTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;

        const enCurso = await tx.traspasos.enCurso(empresaId);
        const decision = decidirCancelacion(enCurso, ahora);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_NO_HABIA" || enCurso === null) {
          return ok({ yaNoHabia: true });
        }
        if (!(await cancelarYAuditar(tx, contexto, enCurso, null))) return err("TRASPASO_RESUELTO");
        return ok({ yaNoHabia: false });
      },
    );
  };
  return cancelarTraspaso;
}
