import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { referenciaDesdeTexto } from "../dominio/referencia";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma, FilaDeReferencia } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

export type EntradaDeBuscarReferencia = Readonly<{
  /** El código `ZH-XXXX-XXXX` como lo dictó o copió la persona: se recortan espacios y se pasa a mayúsculas. */
  referencia: string;
}>;

export type ErrorAlBuscarReferencia = MotivoDeRechazo | "REFERENCIA_INVALIDA" | ErrorDePersistencia;

/**
 * Busca una referencia de error (soporte, paso 1, §B.5.9): devuelve lo que se registró, tal cual (la
 * acción rechazada, el motivo tipado, la empresa y la persona), sin ningún dato de negocio. `soporte.buscar_referencia`.
 *
 * Devuelve TODAS las coincidencias, de la más vieja a la más nueva: normalmente una; si dos errores
 * distintos sortearon el mismo código (32 bits pueden colisionar) soporte ve las dos y las distingue por
 * acción, empresa y fecha, en vez de explicarle a alguien el problema de otro. Una referencia que no
 * existe es una lista vacía, no un error. No deja constancia (las consultas de nivel 1 no se auditan).
 */
export function armarBuscarReferencia({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function buscarReferencia(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeBuscarReferencia,
  ): Promise<Resultado<readonly FilaDeReferencia[], ErrorAlBuscarReferencia>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<readonly FilaDeReferencia[], MotivoDeRechazo | "REFERENCIA_INVALIDA">
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.buscarReferencia.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const referencia = referenciaDesdeTexto(entrada.referencia);
        if (!referencia.ok) return err(referencia.error);
        return ok(await tx.soporte.buscarReferencias(referencia.valor));
      },
    );
  };
}
