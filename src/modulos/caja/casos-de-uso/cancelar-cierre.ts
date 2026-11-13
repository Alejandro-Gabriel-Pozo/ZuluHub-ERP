import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirCancelarCierre, type ErrorDeEstadoDeSesion } from "../dominio/sesion";
import {
  cargarSesion,
  dejarConstancia,
  prepararCaso,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeCancelarCierre = Readonly<{ sesionId: string }>;

export type SalidaDeCancelarCierre = Readonly<{
  /** `true`: ya estaba abierta; no se escribió nada. */
  yaEstabaAbierta: boolean;
}>;

type ErrorPropio = "SESION_NO_ENCONTRADA" | ErrorDeEstadoDeSesion;

export type ErrorAlCancelarCierre =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/**
 * Cancelar el cierre de una sesión (e3 §3.2): vuelve a `ABIERTA` sin las marcas del cierre y los movimientos vuelven a entrar. Contexto
 * OPERATIVO con persona, en una transacción serializable: guard (`sesiones_caja.cancelar_cierre`, permitido en solo lectura), la empresa
 * opera, la sesión (con alcance) y el dominio decide: ya abierta → `yaEstabaAbierta: true` sin escribir ni auditar; cerrada →
 * `SESION_CERRADA` (una cerrada no se reabre). La auditoría `SESION_CAJA_CIERRE_CANCELADO` va en la misma transacción.
 */
export function armarCancelarCierre({ transacciones, reglas }: DependenciasDeCaja) {
  return async function cancelarCierre(
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarCierre,
  ): Promise<Resultado<SalidaDeCancelarCierre, ErrorAlCancelarCierre>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCancelarCierre,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.cancelarCierre.accion,
        );
        if (!previo.ok) return previo;
        const sesion = await cargarSesion(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;
        const decision = decidirCancelarCierre(sesion.valor.estado);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ESTABA") return ok({ yaEstabaAbierta: true });

        const cambio = await tx.sesiones.cancelarCierre(empresaId, sesion.valor.id);
        if (!cambio) return err("SESION_NO_ENCONTRADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "SESION_CAJA_CIERRE_CANCELADO",
          entidad: "sesion_caja",
          entidadId: sesion.valor.id,
          antes: { estado: "EN_CIERRE" },
          despues: { estado: "ABIERTA" },
        });
        return ok({ yaEstabaAbierta: false });
      },
    );
  };
}
