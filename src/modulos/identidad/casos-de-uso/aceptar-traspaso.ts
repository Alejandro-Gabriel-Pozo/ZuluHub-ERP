import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeAceptacionDeTraspaso } from "../dominio/errores";
import { decidirAceptacionDeTraspaso } from "../dominio/traspaso";
import { cargarEmpresas } from "./comun";
import {
  TRABAJO_AVISAR_TRASPASO_ACEPTADO,
  claveDeAvisoDeTraspaso,
  type DependenciasDeIdentidad,
} from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeAceptarTraspaso = Readonly<{ traspasoId: string }>;

export type SalidaDeAceptarTraspaso = Readonly<{
  /** `true`: ya estaba aceptado; no se escribió nada. */
  yaEstabaAceptado: boolean;
}>;

export type ErrorAlAceptarTraspaso =
  ErrorDeAceptacionDeTraspaso | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "ENTRANTE_INACTIVO",
  "ENTRANTE_ES_EL_GERENTE",
  "SALIENTE_YA_NO_ES_GERENTE",
  "TRASPASO_RESUELTO",
  "TRASPASO_VENCIDO",
] as const;

/**
 * El entrante acepta la gerencia (H6, §B.3, paso 3), con su propia sesión en el contexto OPERATIVO de
 * la empresa. En una transacción serializable: el guard (`gerencia.aceptar_traspaso`, los tres
 * roles; que sea el entrante lo decide el dominio, y una persona suspendida no pasa el guard), la
 * empresa opera, y el dominio decide (`decidirAceptacionDeTraspaso`: no existe, no es para el actor,
 * ya aceptado, rechazado o cancelado, vencido, el saliente ya no es gerente, el entrante está
 * apagado o ya es gerente, o se acepta).
 *
 * Al aceptar, en este orden y en la MISMA transacción: el traspaso pasa a `ACEPTADO` (anota al
 * saliente, el gerente vigente leído acá); el saliente baja de `GERENTE` a `ADMINISTRADOR` (primero,
 * porque `membresia_gerente_uk` es un índice parcial que no se difiere); el entrante pasa a
 * `GERENTE`; tres auditorías (`TRASPASO_ACEPTADO` y dos `MEMBRESIA_ROL_CAMBIADO`, con el antes y el
 * después) y el aviso `avisar_traspaso_aceptado` (clave `traspaso:<id>:aceptado`). Si falla un paso no
 * queda ninguno. El traspaso se toca ANTES que las membresías: es el orden que usa también el
 * apagado del entrante, para que ambas no se esperen cruzadas.
 *
 * Aceptar dos veces es ok (`YA_ACEPTADO`) y la segunda no escribe. Aceptar contra apagar al entrante,
 * o contra cancelar: la serializable deja pasar una; la otra repite y ve el resultado de la ganadora.
 * Nunca quedan dos gerentes ni ninguno (además lo impone la base).
 */
export function crearAceptarTraspaso({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function aceptarTraspaso(
    contexto: ContextoOperativo,
    entrada: EntradaDeAceptarTraspaso,
  ): Promise<Resultado<SalidaDeAceptarTraspaso, ErrorAlAceptarTraspaso>> {
    const { ahora, empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeAceptarTraspaso,
          ErrorDeAceptacionDeTraspaso | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.aceptarTraspaso.accion, () =>
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
        const gerente = (await tx.membresias.listarActivas(empresaId)).find(
          (m) => m.rol === "GERENTE",
        );
        const entrante =
          traspaso === null
            ? null
            : await tx.membresias.obtener(empresaId, traspaso.entrantePersonaId);
        const decision = decidirAceptacionDeTraspaso(
          traspaso,
          actor,
          gerente ?? null,
          entrante,
          ahora,
        );
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ACEPTADO") return ok({ yaEstabaAceptado: true });
        if (traspaso === null || gerente === undefined || entrante === null) {
          throw new Error("invariante rota: se decidió aceptar sin traspaso, gerente o entrante");
        }

        // 1. El traspaso, anotando al saliente: el gerente vigente de este instante.
        if (
          !(await tx.traspasos.aceptar(
            empresaId,
            traspaso.id,
            traspaso.version,
            ahora,
            gerente.personaId,
          ))
        ) {
          return err("TRASPASO_RESUELTO");
        }
        // 2. El saliente baja a administrador (el índice del gerente único no se difiere) y 3. el entrante sube.
        if (
          !(await tx.membresias.cambiarRol(
            empresaId,
            gerente.personaId,
            gerente.version,
            "ADMINISTRADOR",
          ))
        ) {
          return err("SALIENTE_YA_NO_ES_GERENTE");
        }
        if (
          !(await tx.membresias.cambiarRol(
            empresaId,
            entrante.personaId,
            entrante.version,
            "GERENTE",
          ))
        ) {
          return err("ENTRANTE_INACTIVO");
        }

        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: actor,
          accion: "TRASPASO_ACEPTADO",
          entidad: "traspaso_gerencia",
          entidadId: traspaso.id,
          antes: { estado: "PROPUESTO" },
          despues: {
            estado: "ACEPTADO",
            saliente: gerente.personaId,
            entrante: entrante.personaId,
          },
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: actor,
          accion: "MEMBRESIA_ROL_CAMBIADO",
          entidad: "membresia",
          entidadId: gerente.personaId,
          antes: { rol: "GERENTE" },
          despues: { rol: "ADMINISTRADOR", traspaso: traspaso.id },
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: actor,
          accion: "MEMBRESIA_ROL_CAMBIADO",
          entidad: "membresia",
          entidadId: entrante.personaId,
          antes: { rol: entrante.rol },
          despues: { rol: "GERENTE", traspaso: traspaso.id },
        });
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_AVISAR_TRASPASO_ACEPTADO,
          datos: { traspasoId: traspaso.id },
          claveDeIdempotencia: claveDeAvisoDeTraspaso(traspaso.id, "aceptado"),
        });
        return ok({ yaEstabaAceptado: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
