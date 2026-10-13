import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeMembresia } from "../dominio/errores";
import { decidirApagado } from "../dominio/membresia";
import { cargarEmpresas } from "./comun";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { cancelarYAuditar } from "./traspaso-comun";

export type EntradaDeApagarMembresia = Readonly<{ personaId: PersonaId }>;

export type SalidaDeApagarMembresia = Readonly<{
  /** `true`: ya estaba apagada; no se escribió nada. */
  yaEstabaApagada: boolean;
  invitacionesRevocadas: number;
}>;

export type ErrorAlApagarMembresia =
  ErrorDeMembresia | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Motivo con el que se cancela el traspaso cuyo entrante fue dado de baja. */
const MOTIVO_ENTRANTE_DADO_DE_BAJA = "ENTRANTE_DADO_DE_BAJA";

/**
 * Apagar la membresía de una persona en la empresa del contexto (diseño §6.3, R4). Contexto
 * OPERATIVO con persona. En una transacción serializable: el guard (`usuarios.apagar`), la empresa
 * opera, y el dominio decide (`decidirApagado`: no existe, ya apagada, es el gerente, es el último
 * admin).
 *
 * Apagar deja `activo = false`, apaga TODAS sus asignaciones de sucursal y revoca las invitaciones
 * pendientes dirigidas a su email que incluyan la empresa (si la invitación es de varias empresas
 * se revoca entera). Si la persona es el ENTRANTE de un traspaso de gerencia en curso (H6, §B.3), esa
 * propuesta se cancela con el motivo `ENTRANTE_DADO_DE_BAJA` y su auditoría `TRASPASO_CANCELADO`: se
 * toca el traspaso ANTES que la membresía, el mismo orden que usa la aceptación (si no, las dos
 * transacciones se esperarían cruzadas). Al saliente no hace falta mirarlo: es el gerente, y el
 * dominio ya no deja apagarlo (`ES_EL_GERENTE`). Lo escrito queda auditado en la misma transacción.
 * Apagar dos veces es ok y no escribe nada la segunda.
 *
 * Los dos últimos admins que se apagan a la vez: ambas transacciones leen a todos los admins y
 * escriben filas distintas (sesgo de escritura); la serializable aborta una y su reintento ve al
 * otro ya apagado, así que devuelve `ULTIMO_ADMIN`.
 */
export function crearApagarMembresia({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function apagarMembresia(
    contexto: ContextoOperativo,
    entrada: EntradaDeApagarMembresia,
  ): Promise<Resultado<SalidaDeApagarMembresia, ErrorAlApagarMembresia>> {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeApagarMembresia, ErrorDeMembresia | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.apagarMembresia.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;

        const objetivo = await tx.membresias.obtener(empresaId, entrada.personaId);
        const activas = await tx.membresias.listarActivas(empresaId);
        const decision = decidirApagado(objetivo, activas);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_APAGADA" || objetivo === null) {
          return ok({ yaEstabaApagada: true, invitacionesRevocadas: 0 });
        }

        const traspaso = await tx.traspasos.enCurso(empresaId);
        if (
          traspaso !== null &&
          traspaso.entrantePersonaId === objetivo.personaId &&
          !(await cancelarYAuditar(tx, contexto, traspaso, MOTIVO_ENTRANTE_DADO_DE_BAJA))
        ) {
          return err("MEMBRESIA_NO_ENCONTRADA");
        }

        if (!(await tx.membresias.apagar(empresaId, objetivo.personaId, objetivo.version))) {
          return err("MEMBRESIA_NO_ENCONTRADA");
        }
        const asignacionesApagadas = await tx.asignaciones.apagarTodas(
          empresaId,
          objetivo.personaId,
        );

        // El contexto operativo ve a las personas de su empresa (las apagadas también).
        const persona = await tx.personas.obtener(objetivo.personaId);
        if (persona === null)
          throw new Error("invariante rota: membresía de una persona invisible");
        const pendientes = await tx.invitaciones.pendientesDeEmail(empresaId, persona.email);
        for (const pendiente of pendientes) {
          const revocada = await tx.invitaciones.revocar(
            pendiente.id,
            pendiente.version,
            ahora,
            "MEMBRESIA_APAGADA: la persona fue dada de baja de la empresa",
          );
          if (!revocada) return err("MEMBRESIA_NO_ENCONTRADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "INVITACION_REVOCADA",
            entidad: "invitacion",
            entidadId: pendiente.id,
            antes: { estado: "PENDIENTE" },
            despues: { estado: "REVOCADA", motivo: "MEMBRESIA_APAGADA" },
          });
        }

        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "MEMBRESIA_APAGADA",
          entidad: "membresia",
          entidadId: objetivo.personaId,
          antes: { activo: true, rol: objetivo.rol },
          despues: {
            activo: false,
            asignacionesApagadas,
            invitacionesRevocadas: pendientes.map((p) => p.id),
          },
        });
        return ok({ yaEstabaApagada: false, invitacionesRevocadas: pendientes.length });
      },
    );
  };
}
