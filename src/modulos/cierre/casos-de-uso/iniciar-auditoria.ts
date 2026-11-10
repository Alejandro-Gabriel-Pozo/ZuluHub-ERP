import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirIniciar } from "../dominio/jornada";
import {
  aportesDeLaEmpresa,
  referenciaDe,
  type AporteNoDisponible,
  type EntradaDeJornada,
  type ErrorDeClaveDeJornada,
} from "../comun";
import {
  entidadDeJornada,
  leerImpedimentos,
  prepararCaso,
  type ImpedimentoDeJornada,
} from "./comun";
import type { DependenciasDeCierre } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeIniciarAuditoria = EntradaDeJornada;

export type SalidaDeIniciarAuditoria = Readonly<{
  /** `true`: la jornada ya estaba en auditoría; no se escribió ni se auditó nada. */
  yaEstabaEnAuditoria: boolean;
}>;

export type ImpedimentosDeLaJornada = Readonly<{
  codigo: "JORNADA_CON_IMPEDIMENTOS";
  impedimentos: readonly ImpedimentoDeJornada[];
}>;

type ErrorPropio =
  ErrorDeClaveDeJornada | "JORNADA_CERRADA" | ImpedimentosDeLaJornada | AporteNoDisponible;

export type ErrorAlIniciarAuditoria =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = ["JORNADA_CERRADA"] as const;

/**
 * «Empezar el cierre» (decisiones 160, 167 y 168; e3b §3.3). Contexto OPERATIVO con persona, en una transacción serializable: guard
 * (`jornadas.iniciar_auditoria`), la empresa opera, alcance de sucursal, validación, y entonces:
 *  - toma la jornada con `FOR UPDATE` (quien tiene actividad en ella la toma con `FOR SHARE`: o la actividad entra antes y se ve
 *    como impedimento, o este caso espera y la actividad ve la jornada ya en auditoría y no escribe);
 *  - `CERRADA` → `JORNADA_CERRADA`; ya `EN_AUDITORIA` → `yaEstabaEnAuditoria: true` sin escribir ni auditar (doble clic o reintento);
 *  - `ABIERTA` → pide a los aportes de los módulos activos sus IMPEDIMENTOS (hoy, caja: sesiones sin cerrar); con alguno →
 *    `JORNADA_CON_IMPEDIMENTOS`; un aporte que no responde → `APORTE_NO_DISPONIBLE`; si no, pasa a `EN_AUDITORIA` y audita
 *    `JORNADA_EN_AUDITORIA` en la misma transacción.
 * La jornada nace con la primera actividad del día: sin actividad no existe y da `JORNADA_NO_ENCONTRADA`.
 */
export function armarIniciarAuditoria<TAportes>({
  transacciones,
  reglas,
  aportes,
}: DependenciasDeCierre<TAportes>) {
  return async function iniciarAuditoria(
    contexto: ContextoOperativo,
    entrada: EntradaDeIniciarAuditoria,
  ): Promise<Resultado<SalidaDeIniciarAuditoria, ErrorAlIniciarAuditoria>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeIniciarAuditoria,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.iniciarAuditoria.accion,
          entrada,
        );
        if (!previo.ok) return previo;
        const { clave, persona, datos } = previo.valor;
        const jornada = await tx.jornadas.bloquearParaCambiar(clave);
        if (jornada === null) return err("JORNADA_NO_ENCONTRADA");
        const decision = decidirIniciar(jornada.estado);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ESTABA") return ok({ yaEstabaEnAuditoria: true });

        const impedimentos = await leerImpedimentos(
          tx,
          aportesDeLaEmpresa(reglas, datos, aportes),
          referenciaDe(clave),
        );
        if (!impedimentos.ok) return impedimentos;
        if (impedimentos.valor.length > 0) {
          return err({ codigo: "JORNADA_CON_IMPEDIMENTOS", impedimentos: impedimentos.valor });
        }
        await tx.jornadas.iniciarAuditoria(clave, persona, contexto.ahora);
        await tx.auditoria.registrar({
          empresaId: contexto.empresaId,
          actorPersonaId: persona,
          accion: "JORNADA_EN_AUDITORIA",
          entidad: "jornada",
          entidadId: entidadDeJornada(clave),
          antes: { estado: "ABIERTA" },
          despues: { estado: "EN_AUDITORIA" },
        });
        return ok({ yaEstabaEnAuditoria: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
