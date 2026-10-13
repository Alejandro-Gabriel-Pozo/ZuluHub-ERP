import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeRechazoDeTraspaso } from "../dominio/errores";
import { decidirRechazo } from "../dominio/traspaso";
import { cargarEmpresas } from "./comun";
import {
  TRABAJO_AVISAR_TRASPASO_RECHAZADO,
  claveDeAvisoDeTraspaso,
  type DependenciasDeIdentidad,
} from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeRechazarTraspaso = Readonly<{ traspasoId: string }>;

export type SalidaDeRechazarTraspaso = Readonly<{
  /** `true`: ya estaba rechazado; no se escribió nada. */
  yaEstabaRechazado: boolean;
}>;

export type ErrorAlRechazarTraspaso =
  ErrorDeRechazoDeTraspaso | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * El entrante rechaza la propuesta de traspaso (H6, §B.3, paso 2), con su propia sesión en el
 * contexto OPERATIVO de la empresa. En una transacción serializable: el guard
 * (`gerencia.rechazar_traspaso`, los tres roles; que sea el entrante lo decide el dominio), la empresa
 * opera, y el dominio decide (`decidirRechazo`: no existe, no es para el actor, ya rechazado, aceptado
 * o cancelado, vencido, o se rechaza). Rechazar no cambia ningún rol.
 *
 * Deja la auditoría `TRASPASO_RECHAZADO` y el aviso `avisar_traspaso_rechazado` (clave
 * `traspaso:<id>:rechazado`) en la misma transacción. Rechazar dos veces es ok y la segunda no escribe,
 * no audita ni avisa. Un traspaso de otra empresa es indistinguible de uno inexistente.
 */
export function crearRechazarTraspaso({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function rechazarTraspaso(
    contexto: ContextoOperativo,
    entrada: EntradaDeRechazarTraspaso,
  ): Promise<Resultado<SalidaDeRechazarTraspaso, ErrorAlRechazarTraspaso>> {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeRechazarTraspaso,
          ErrorDeRechazoDeTraspaso | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.rechazarTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;
        const actor = contexto.personaId;
        if (actor === null)
          throw new Error("invariante rota: el guard dejó pasar a un actor sin persona");

        const traspaso = await tx.traspasos.obtener(empresaId, entrada.traspasoId);
        const decision = decidirRechazo(traspaso, actor, ahora);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_RECHAZADO" || traspaso === null) {
          return ok({ yaEstabaRechazado: true });
        }

        const rechazado = await tx.traspasos.rechazar(
          empresaId,
          traspaso.id,
          traspaso.version,
          ahora,
        );
        if (!rechazado) return err("TRASPASO_RESUELTO");
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_AVISAR_TRASPASO_RECHAZADO,
          datos: { traspasoId: traspaso.id },
          claveDeIdempotencia: claveDeAvisoDeTraspaso(traspaso.id, "rechazado"),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: actor,
          accion: "TRASPASO_RECHAZADO",
          entidad: "traspaso_gerencia",
          entidadId: traspaso.id,
          antes: { estado: "PROPUESTO", entrante: traspaso.entrantePersonaId },
          despues: { estado: "RECHAZADO" },
        });
        return ok({ yaEstabaRechazado: false });
      },
    );
  };
}
