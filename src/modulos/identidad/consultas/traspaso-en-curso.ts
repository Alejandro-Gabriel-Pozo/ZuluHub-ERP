import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId, TraspasoId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TraspasoGuardado } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Una persona tal como la nombra la pantalla del traspaso (hasta que haya nombres, el email: D9). */
export type PersonaDelTraspaso = Readonly<{ personaId: PersonaId; email: string }>;

/**
 * El traspaso de gerencia en curso tal como lo ve la pantalla (ADR-005): objeto plano, sin texto de
 * marca. Las fechas van en ISO UTC; la pantalla las formatea con la zona de la empresa.
 */
export type TraspasoEnCursoDeLaPantalla = Readonly<{
  id: TraspasoId;
  origen: TraspasoGuardado["origen"];
  entrante: PersonaDelTraspaso;
  /** `null`: lo propuso la plataforma y el saliente se anota recién al aceptar. */
  saliente: PersonaDelTraspaso | null;
  propuestoEn: string;
  venceEn: string;
  /** `true`: llegó su vencimiento (`ahora >= venceEn`); sigue guardado como propuesto hasta que se cancele o se renueve. */
  vencido: boolean;
  /** `true`: quien mira es el entrante (le toca aceptar o rechazar). */
  soyEntrante: boolean;
}>;

export type ErrorAlConsultarTraspasoEnCurso = MotivoDeRechazo | ErrorDePersistencia;

/**
 * El traspaso de gerencia en curso de la empresa del contexto (pantalla «Traspaso», H6 §B.5), o
 * `null` si no hay. Pide `gerencia.ver_traspaso` al guard dentro de su transacción (`read committed`,
 * solo lectura). Lo ven el gerente y el entrante; a los demás (administradores y operadores que no
 * son el entrante) les devuelve `null`, igual que si no hubiera nada. No exige que la empresa
 * opere: una empresa suspendida sigue viendo su traspaso (los casos de uso sí lo exigen).
 */
export function armarTraspasoEnCurso({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function traspasoEnCurso(
    contexto: ContextoOperativo,
  ): Promise<Resultado<TraspasoEnCursoDeLaPantalla | null, ErrorAlConsultarTraspasoEnCurso>> {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<TraspasoEnCursoDeLaPantalla | null, MotivoDeRechazo>> => {
        // El rol sale de la misma lectura que usa el guard: no se vuelve a pedir.
        let rol: RolDeEmpresa | null = null;
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.traspasoEnCurso.accion,
          async () => {
            const actor = await tx.autorizacion.delActor(contexto);
            rol = actor.rol;
            return actor;
          },
        );
        if (!permiso.ok) return permiso;

        const traspaso = await tx.traspasos.enCurso(empresaId);
        if (traspaso === null) return ok(null);
        const soyEntrante = contexto.personaId === traspaso.entrantePersonaId;
        if (rol !== "GERENTE" && !soyEntrante) return ok(null);

        const entrante = await tx.personas.obtener(traspaso.entrantePersonaId);
        const saliente =
          traspaso.salientePersonaId === null
            ? null
            : await tx.personas.obtener(traspaso.salientePersonaId);
        if (entrante === null || (traspaso.salientePersonaId !== null && saliente === null)) {
          throw new Error("invariante rota: traspaso de personas invisibles");
        }
        return ok({
          id: traspaso.id,
          origen: traspaso.origen,
          entrante: { personaId: entrante.id, email: entrante.email },
          saliente: saliente === null ? null : { personaId: saliente.id, email: saliente.email },
          propuestoEn: traspaso.propuestoEn.toISOString(),
          venceEn: traspaso.venceEn.toISOString(),
          // Misma regla que `estadoDeTraspaso` del dominio (que una consulta no importa): una
          // prueba compara ambas en el instante exacto del vencimiento.
          vencido: ahora.getTime() >= traspaso.venceEn.getTime(),
          soyEntrante,
        });
      },
    );
  };
}
