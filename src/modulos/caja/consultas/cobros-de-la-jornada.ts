import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal } from "../../cierre/publico";
import type { MedioYCuentaConNombre } from "../persistencia/base-de-la-jornada";
import { MAXIMO_DE_UNA_PAGINA, exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

/** El último `(registrado_en, id)` visto: de dónde sigue la página siguiente. `registradoEn` es ISO UTC. */
export type CursorDeCobrosDeLaJornada = Readonly<{ registradoEn: string; id: string }>;

export type EntradaDeCobrosDeLaJornada = EntradaDeJornadaDeCaja &
  Readonly<{
    /** Solo los cobros cuyo medio original o vigente es este; `null` (o ausente): todos. */
    medioDePagoId?: string | null;
    /** `null` o ausente: desde el principio. */
    despuesDe?: CursorDeCobrosDeLaJornada | null;
    /** Hasta `MAXIMO_DE_COBROS_POR_PAGINA`; por defecto, el máximo. */
    limite?: number;
  }>;

/** Tope de cobros por pedido: acota lo que lee y devuelve una consulta (e3b §4.5). */
export const MAXIMO_DE_COBROS_POR_PAGINA = MAXIMO_DE_UNA_PAGINA;

export type CorreccionDeUnCobroVista = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    secuencia: number;
    motivo: string;
    corregidaEn: string;
    corregidaPor: string;
  }>;

export type CobroDeLaJornadaVisto = Readonly<{
  cobroId: string;
  sesionId: string;
  importe: ImporteJson;
  /** Con lo que se cobró: el cobro original no se toca. */
  original: MedioYCuentaConNombre;
  /** Tras las correcciones de medio (igual al original si no hubo). */
  vigente: MedioYCuentaConNombre;
  /** Para unir el cobro con su ticket. */
  origen: Readonly<{ tipo: string; id: string; orden: number }>;
  registradoEn: string;
  registradoPor: string;
  /** De la primera a la última, con su motivo. */
  correcciones: readonly CorreccionDeUnCobroVista[];
  /** La jornada está en auditoría y el actor puede corregir el medio (la misma regla del caso de uso: la pantalla no decide). */
  correccionPosible: boolean;
}>;

export type PaginaDeCobrosDeLaJornada = Readonly<{
  cobros: readonly CobroDeLaJornadaVisto[];
  /** El cursor de la página siguiente; `null` si no hay más. */
  siguiente: CursorDeCobrosDeLaJornada | null;
}>;

export type ErrorAlListarLosCobrosDeLaJornada =
  | ErrorDeConsultaDeJornada
  | "CURSOR_INVALIDO"
  | "LIMITE_INVALIDO"
  | "MEDIO_NO_ENCONTRADO"
  | ErrorDePersistencia;

/**
 * Los cobros de la jornada (e3b §4.5), con su medio y cuenta ORIGINALES y VIGENTES, quién y cuándo, la sesión, el origen (para unirlo con el
 * ticket), las correcciones con su motivo y `correccionPosible`. En orden `(registrado_en, id)`, con cursor, hasta 100 por pedido.
 * `cajas.ver`, `read committed`, alcance de la sucursal. SUPUESTO (DEC-0063): el filtro por medio deja los cobros cuyo medio original O vigente es ese
 * (los que tocan esa línea de la conciliación); costo de cambiarlo a solo el vigente: una condición de la consulta.
 */
export function armarCobrosDeLaJornada({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function cobrosDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeCobrosDeLaJornada,
  ): Promise<Resultado<PaginaDeCobrosDeLaJornada, ErrorAlListarLosCobrosDeLaJornada>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          PaginaDeCobrosDeLaJornada,
          ErrorDeConsultaDeJornada | "CURSOR_INVALIDO" | "LIMITE_INVALIDO" | "MEDIO_NO_ENCONTRADO"
        >
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.cobrosDeLaJornada.accion,
        );
        if (!permiso.ok) return permiso;
        const jornada = await jornadaParaMirar(tx, contexto, entrada);
        if (!jornada.ok) return jornada;

        const limite = entrada.limite ?? MAXIMO_DE_COBROS_POR_PAGINA;
        if (!Number.isInteger(limite) || limite < 1 || limite > MAXIMO_DE_COBROS_POR_PAGINA) {
          return err("LIMITE_INVALIDO");
        }
        const medio = entrada.medioDePagoId ?? null;
        if (medio !== null && !esUuidCanonico(medio)) return err("MEDIO_NO_ENCONTRADO");
        let cursor: { registradoEn: Date; id: string } | null = null;
        if (entrada.despuesDe !== undefined && entrada.despuesDe !== null) {
          const instante = new Date(entrada.despuesDe.registradoEn);
          if (Number.isNaN(instante.getTime()) || !esUuidCanonico(entrada.despuesDe.id)) {
            return err("CURSOR_INVALIDO");
          }
          cursor = { registradoEn: instante, id: entrada.despuesDe.id };
        }

        const estado = await jornadaDeSucursal.estadoDeJornada(
          tx,
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
        );
        const puedeCorregir =
          contexto.personaId !== null &&
          (
            await exigirAccion(reglas, "cobros.corregir_medio", () =>
              tx.autorizacion.delActor(contexto),
            )
          ).ok;
        const correccionPosible = estado === "EN_AUDITORIA" && puedeCorregir;

        // Una fila de más: si vuelve, hay otra página.
        const filas = await tx.cobrosDeLaJornada.cobros(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
          { medioDePagoId: medio, despuesDe: cursor, limite: limite + 1 },
        );
        const pagina = filas.slice(0, limite);
        const ultimo = pagina.at(-1);
        return ok({
          cobros: pagina.map((c) => ({
            cobroId: c.cobroId,
            sesionId: c.sesionId,
            importe: importeAJson(c.importe),
            original: c.original,
            vigente: c.vigente,
            origen: c.origen,
            registradoEn: c.registradoEn.toISOString(),
            registradoPor: c.registradoPor,
            correcciones: c.correcciones.map((k) => ({
              ...k,
              corregidaEn: k.corregidaEn.toISOString(),
            })),
            correccionPosible,
          })),
          siguiente:
            filas.length > limite && ultimo !== undefined
              ? { registradoEn: ultimo.registradoEn.toISOString(), id: ultimo.cobroId }
              : null,
        });
      },
    );
  };
}
