import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId, TraspasoId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDePropuestaDeTraspaso } from "../dominio/errores";
import { decidirPropuesta, vencimientoDeTraspaso } from "../dominio/traspaso";
import { cargarEmpresas } from "./comun";
import {
  TRABAJO_AVISAR_TRASPASO_PROPUESTO,
  claveDeAvisoDeTraspaso,
  type DependenciasDeIdentidad,
} from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { cancelarYAuditar } from "./traspaso-comun";
import { traducirErrores } from "./traducir";

export type EntradaDeProponerTraspaso = Readonly<{ entrantePersonaId: PersonaId }>;

export type SalidaDeProponerTraspaso = Readonly<{
  traspasoId: TraspasoId;
  /** `true`: ya había una propuesta vigente a ese mismo entrante; se devuelve esa, sin escribir. */
  yaExistia: boolean;
}>;

export type ErrorAlProponerTraspaso =
  ErrorDePropuestaDeTraspaso | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "TRASPASO_EN_CURSO",
  "ENTRANTE_NO_ES_MIEMBRO",
  "ENTRANTE_INACTIVO",
  "ENTRANTE_ES_EL_GERENTE",
] as const;

/** Motivo con el que una propuesta nueva cancela a la anterior que ya venció. */
const MOTIVO_VENCIDO = "VENCIDO";

/**
 * El gerente propone pasarle la gerencia a un miembro activo de la empresa (H6, §B.3, paso 1).
 * Contexto OPERATIVO con persona. En una transacción serializable: el guard
 * (`gerencia.proponer_traspaso`, solo el gerente), la empresa opera, y el dominio decide
 * (`decidirPropuesta`: el entrante no es miembro, está apagado o suspendido, es el gerente, hay
 * otra propuesta vigente a otra persona, ya existía la misma, o se propone).
 *
 * Una propuesta VENCIDA se cancela (motivo `VENCIDO`) y la nueva ocupa su lugar en la misma
 * transacción, incluso al mismo entrante: se renueva. Proponer dos veces al mismo entrante
 * mientras la primera vive devuelve el mismo id (`yaExistia`), sin escribir ni avisar de nuevo.
 * Nace con vencimiento a los 7 días (`vencimientoDeTraspaso(ahora)`), con la auditoría
 * `TRASPASO_PROPUESTO` y el aviso `avisar_traspaso_propuesto` (clave `traspaso:<id>:propuesto`).
 *
 * Dos propuestas a la vez: ambas leen «no hay ninguna» y escriben; el índice de una sola en curso y
 * la serializable dejan pasar una, y el reintento de la otra ve a la ganadora (`YA_EXISTIA` si era al
 * mismo entrante, `TRASPASO_EN_CURSO` si era a otro).
 */
export function crearProponerTraspaso({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function proponerTraspaso(
    contexto: ContextoOperativo,
    entrada: EntradaDeProponerTraspaso,
  ): Promise<Resultado<SalidaDeProponerTraspaso, ErrorAlProponerTraspaso>> {
    const { ahora, empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeProponerTraspaso,
          ErrorDePropuestaDeTraspaso | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.proponerTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;
        // Con el guard aprobado, quien actúa es una persona (el rol sale de su membresía).
        const proponePor = contexto.personaId;
        if (proponePor === null)
          throw new Error("invariante rota: el guard dejó pasar a un actor sin persona");

        // El contexto operativo ve a las personas de su empresa; quien no es miembro no aparece.
        const entrante = await tx.membresias.obtener(empresaId, entrada.entrantePersonaId);
        const persona = await tx.personas.obtener(entrada.entrantePersonaId);
        const enCurso = await tx.traspasos.enCurso(empresaId);
        const decision = decidirPropuesta(enCurso, entrante, persona, proponePor, ahora);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_EXISTIA") {
          if (enCurso === null)
            throw new Error("invariante rota: YA_EXISTIA sin propuesta en curso");
          return ok({ traspasoId: enCurso.id, yaExistia: true });
        }

        // La vencida se cancela ANTES de proponer: sigue ocupando el índice de «una en curso».
        const vencida = decision.valor === "CANCELAR_VENCIDO_Y_PROPONER" ? enCurso : null;
        if (vencida !== null && !(await cancelarYAuditar(tx, contexto, vencida, MOTIVO_VENCIDO))) {
          return err("TRASPASO_EN_CURSO");
        }

        const venceEn = vencimientoDeTraspaso(ahora);
        const id = await tx.traspasos.proponer({
          empresaId,
          proponePor,
          entrante: entrada.entrantePersonaId,
          propuestoEn: ahora,
          venceEn,
        });
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_AVISAR_TRASPASO_PROPUESTO,
          datos: { traspasoId: id },
          claveDeIdempotencia: claveDeAvisoDeTraspaso(id, "propuesto"),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: proponePor,
          accion: "TRASPASO_PROPUESTO",
          entidad: "traspaso_gerencia",
          entidadId: id,
          despues: {
            origen: "GERENTE",
            saliente: proponePor,
            entrante: entrada.entrantePersonaId,
            venceEn: venceEn.toISOString(),
            reemplazaA: vencida?.id ?? null,
          },
        });
        return ok({ traspasoId: id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
