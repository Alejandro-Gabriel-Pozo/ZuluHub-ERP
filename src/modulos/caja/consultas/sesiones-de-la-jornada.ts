import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { fichaDe, type FichaDeSesion } from "./ficha-de-sesion";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

export type EntradaDeSesionesDeLaJornada = EntradaDeJornadaDeCaja;

export type SesionesDeLaJornada = Readonly<{
  /** De la más vieja a la más nueva; cada una con quién la abrió y la cerró, el arqueo por línea, los billetes y la observación. */
  sesiones: readonly FichaDeSesion[];
}>;

export type ErrorAlVerLasSesionesDeLaJornada = ErrorDeConsultaDeJornada | ErrorDePersistencia;

/**
 * Las sesiones de caja de la jornada (e3b §4.5), cada una con su ficha: el detalle de `caja.sesiones_sin_cerrar` y `caja.diferencia_de_arqueo`.
 * `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarSesionesDeLaJornada({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function sesionesDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeSesionesDeLaJornada,
  ): Promise<Resultado<SesionesDeLaJornada, ErrorAlVerLasSesionesDeLaJornada>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<SesionesDeLaJornada, ErrorDeConsultaDeJornada>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.sesionesDeLaJornada.accion,
        );
        if (!permiso.ok) return permiso;
        const jornada = await jornadaParaMirar(tx, contexto, entrada);
        if (!jornada.ok) return jornada;
        const sesiones = await tx.sesiones.deLaJornada(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
        );
        const fichas: FichaDeSesion[] = [];
        for (const sesion of sesiones) {
          fichas.push(fichaDe(sesion, await tx.arqueos.deLaSesion(contexto.empresaId, sesion.id)));
        }
        return ok({ sesiones: fichas });
      },
    );
  };
}
