import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirCancelar } from "../dominio/jornada";
import { type EntradaDeJornada, type ErrorDeClaveDeJornada } from "../comun";
import { entidadDeJornada, prepararCaso } from "./comun";
import type { DependenciasDeCierre } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCancelarAuditoria = EntradaDeJornada;

export type SalidaDeCancelarAuditoria = Readonly<{
  /** `true`: la jornada ya estaba abierta; no se escribió ni se auditó nada. */
  yaEstabaAbierta: boolean;
}>;

type ErrorPropio = ErrorDeClaveDeJornada | "JORNADA_CERRADA";

export type ErrorAlCancelarAuditoria =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

const RESTRICCIONES_ADMITIDAS = ["JORNADA_CERRADA"] as const;

/**
 * «Cancelar el cierre del día» (e3b §3.3): devuelve la jornada de `EN_AUDITORIA` a `ABIERTA` para seguir cobrando. Lo que los
 * módulos hayan registrado durante la auditoría (correcciones, declaraciones) QUEDA (solo inserción) y se cuenta en el cierre final.
 * Mismo orden que iniciar: guard (`jornadas.cancelar_auditoria`), la empresa opera, alcance, validación, `FOR UPDATE` de la jornada.
 * `CERRADA` → `JORNADA_CERRADA`; ya `ABIERTA` → `yaEstabaAbierta: true` sin escribir ni auditar; `EN_AUDITORIA` → `ABIERTA` y audita
 * `JORNADA_AUDITORIA_CANCELADA` en la misma transacción.
 */
export function armarCancelarAuditoria<TAportes>({
  transacciones,
  reglas,
}: DependenciasDeCierre<TAportes>) {
  return async function cancelarAuditoria(
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarAuditoria,
  ): Promise<Resultado<SalidaDeCancelarAuditoria, ErrorAlCancelarAuditoria>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCancelarAuditoria,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.cancelarAuditoria.accion,
          entrada,
        );
        if (!previo.ok) return previo;
        const { clave, persona } = previo.valor;
        const jornada = await tx.jornadas.bloquearParaCambiar(clave);
        if (jornada === null) return err("JORNADA_NO_ENCONTRADA");
        const decision = decidirCancelar(jornada.estado);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ESTABA") return ok({ yaEstabaAbierta: true });

        await tx.jornadas.cancelarAuditoria(clave);
        await tx.auditoria.registrar({
          empresaId: contexto.empresaId,
          actorPersonaId: persona,
          accion: "JORNADA_AUDITORIA_CANCELADA",
          entidad: "jornada",
          entidadId: entidadDeJornada(clave),
          antes: { estado: "EN_AUDITORIA" },
          despues: { estado: "ABIERTA" },
        });
        return ok({ yaEstabaAbierta: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
