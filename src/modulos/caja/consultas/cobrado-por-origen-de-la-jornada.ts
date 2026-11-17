import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { MAXIMO_DE_UNA_PAGINA, exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

/** El último origen visto `(tipo, id)`: de dónde sigue la página siguiente. */
export type CursorDeOrigenesVisto = Readonly<{ tipo: string; id: string }>;

export type EntradaDeCobradoPorOrigenDeLaJornada = EntradaDeJornadaDeCaja &
  Readonly<{
    /** `null` o ausente: desde el principio. */
    despuesDe?: CursorDeOrigenesVisto | null;
    /** Hasta `MAXIMO_DE_ORIGENES_POR_PAGINA`; por defecto, el máximo. */
    limite?: number;
  }>;

/** Tope de orígenes por pedido: acota lo que lee y devuelve una consulta (e3b §4.5). */
export const MAXIMO_DE_ORIGENES_POR_PAGINA = MAXIMO_DE_UNA_PAGINA;

export type CobradoDeUnOrigenVisto = Readonly<{
  origen: Readonly<{ tipo: string; id: string }>;
  /** Σ de los cobros de ese origen en la jornada: no cambia con una corrección de medio. */
  cobrado: ImporteJson;
  cobros: number;
}>;

export type PaginaDeCobradoPorOrigen = Readonly<{
  origenes: readonly CobradoDeUnOrigenVisto[];
  siguiente: CursorDeOrigenesVisto | null;
}>;

export type ErrorAlVerElCobradoPorOrigen =
  ErrorDeConsultaDeJornada | "CURSOR_INVALIDO" | "LIMITE_INVALIDO" | ErrorDePersistencia;

/**
 * Lo cobrado por origen en la jornada (e3b §4.5): el dato CRUDO de caja, sin ventas (caja no sabe qué es un ticket). Cada origen con la suma
 * exacta de sus cobros, por `(tipo, id)` del origen, con cursor, hasta 100 por pedido. `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarCobradoPorOrigenDeLaJornada({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCaja) {
  return async function cobradoPorOrigenDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeCobradoPorOrigenDeLaJornada,
  ): Promise<Resultado<PaginaDeCobradoPorOrigen, ErrorAlVerElCobradoPorOrigen>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          PaginaDeCobradoPorOrigen,
          ErrorDeConsultaDeJornada | "CURSOR_INVALIDO" | "LIMITE_INVALIDO"
        >
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.cobradoPorOrigenDeLaJornada.accion,
        );
        if (!permiso.ok) return permiso;
        const jornada = await jornadaParaMirar(tx, contexto, entrada);
        if (!jornada.ok) return jornada;
        const limite = entrada.limite ?? MAXIMO_DE_ORIGENES_POR_PAGINA;
        if (!Number.isInteger(limite) || limite < 1 || limite > MAXIMO_DE_ORIGENES_POR_PAGINA) {
          return err("LIMITE_INVALIDO");
        }
        const cursor = entrada.despuesDe ?? null;
        if (cursor !== null && (!esUuidCanonico(cursor.id) || cursor.tipo.length === 0)) {
          return err("CURSOR_INVALIDO");
        }
        // Una fila de más: si vuelve, hay otra página.
        const filas = await tx.laJornada.cobradoPorOrigen(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
          cursor,
          limite + 1,
        );
        const pagina = filas.slice(0, limite);
        const ultimo = pagina.at(-1);
        return ok({
          origenes: pagina.map((o) => ({
            origen: o.origen,
            cobrado: importeAJson(o.cobrado),
            cobros: o.cobros,
          })),
          siguiente:
            filas.length > limite && ultimo !== undefined
              ? { tipo: ultimo.origen.tipo, id: ultimo.origen.id }
              : null,
        });
      },
    );
  };
}
