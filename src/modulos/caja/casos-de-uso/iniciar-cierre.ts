import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirIniciarCierre, type ErrorDeEstadoDeSesion } from "../dominio/sesion";
import { cargarSesion, dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeIniciarCierre = Readonly<{ sesionId: string }>;

export type SalidaDeIniciarCierre = Readonly<{
  /** `true`: ya estaba en cierre; no se escribió nada. */
  yaEstabaEnCierre: boolean;
}>;

type ErrorPropio = "SESION_NO_ENCONTRADA" | ErrorDeEstadoDeSesion;

export type ErrorAlIniciarCierre =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/**
 * Iniciar el cierre de una sesión (e3 §3.2): la congela para contar, y ningún movimiento entra mientras tanto (`SESION_EN_CIERRE`).
 * Contexto OPERATIVO con persona, en una transacción serializable: guard (`sesiones_caja.iniciar_cierre`, que sigue permitido en solo
 * lectura: completa), la empresa opera, la sesión (con alcance sobre su sucursal) y el dominio decide: ya en cierre → `yaEstabaEnCierre:
 * true` sin escribir ni auditar; cerrada → `SESION_CERRADA`. La auditoría `SESION_CAJA_CIERRE_INICIADO` va en la misma transacción.
 * Cobrar contra iniciar el cierre: el cierre es un `UPDATE` de la sesión y espera a los cobros en vuelo (`FOR SHARE`).
 */
export function armarIniciarCierre({ transacciones, reglas }: DependenciasDeCaja) {
  return async function iniciarCierre(
    contexto: ContextoOperativo,
    entrada: EntradaDeIniciarCierre,
  ): Promise<Resultado<SalidaDeIniciarCierre, ErrorAlIniciarCierre>> {
    const { empresaId, ahora } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeIniciarCierre,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.iniciarCierre.accion);
        if (!previo.ok) return previo;
        const sesion = await cargarSesion(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;
        const decision = decidirIniciarCierre(sesion.valor.estado);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ESTABA") return ok({ yaEstabaEnCierre: true });

        const cambio = await tx.sesiones.iniciarCierre(
          empresaId,
          sesion.valor.id,
          previo.valor.persona,
          ahora,
        );
        if (!cambio) return err("SESION_NO_ENCONTRADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "SESION_CAJA_CIERRE_INICIADO",
          entidad: "sesion_caja",
          entidadId: sesion.valor.id,
          antes: { estado: "ABIERTA" },
          despues: { estado: "EN_CIERRE" },
        });
        return ok({ yaEstabaEnCierre: false });
      },
    );
  };
}
