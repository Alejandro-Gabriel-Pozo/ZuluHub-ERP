import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { EmpresaNoOpera, ErrorDeMembresia } from "../dominio/errores";
import { decidirApagado } from "../dominio/membresia";
import { cargarEmpresas, comprobarQueOpera, exigirAdministrador } from "./comun";
import type { DependenciasDeIdentidad } from "./contrato";

export type EntradaDeApagarMembresia = Readonly<{ personaId: PersonaId }>;

export type SalidaDeApagarMembresia = Readonly<{
  /** `true`: ya estaba apagada; no se escribió nada. */
  yaEstabaApagada: boolean;
  invitacionesRevocadas: number;
}>;

export type ErrorAlApagarMembresia = ErrorDeMembresia | EmpresaNoOpera | ErrorDePersistencia;

/**
 * Apagar la membresía de una persona en la empresa del contexto (diseño §6.3, R4). Contexto
 * OPERATIVO con persona. En una transacción serializable: control de piso, la empresa opera, y el
 * dominio decide (`decidirApagado`: no existe, ya apagada, es el gerente, es el último admin).
 *
 * Apagar deja `activo = false`, apaga TODAS sus asignaciones de sucursal y revoca las invitaciones
 * pendientes dirigidas a su email que incluyan la empresa (si la invitación es de varias empresas
 * se revoca entera). Lo escrito queda auditado en la misma transacción. Apagar dos veces es ok y
 * no escribe nada la segunda.
 *
 * Los dos últimos admins que se apagan a la vez: ambas transacciones leen a todos los admins y
 * escriben filas distintas (sesgo de escritura); la serializable aborta una y su reintento ve al
 * otro ya apagado, así que devuelve `ULTIMO_ADMIN`.
 */
export function crearApagarMembresia({ transacciones }: DependenciasDeIdentidad) {
  return async function apagarMembresia(
    contexto: ContextoOperativo,
    entrada: EntradaDeApagarMembresia,
  ): Promise<Resultado<SalidaDeApagarMembresia, ErrorAlApagarMembresia>> {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeApagarMembresia, ErrorDeMembresia | EmpresaNoOpera>> => {
        const permiso = await exigirAdministrador(tx, contexto);
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
