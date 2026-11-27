import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeCero,
  restar,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { OrigenDevoluble } from "../persistencia/esquema";
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

/** El origen de las cobranzas que se devuelven (una consulta no importa el dominio: el tipo `OrigenDevoluble` obliga a que siga siendo uno de los orígenes devolubles). */
const ORIGEN_DE_LA_COBRANZA: OrigenDevoluble = "ventas.cobranza_de_ticket";

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
  /** Lo ya devuelto de esa cobranza (devoluciones vigentes, hasta ahora, de cualquier jornada); cero si no hay. Solo las cobranzas de ticket se devuelven. */
  devuelto: ImporteJson;
  /** `cobrado` − `devuelto`: lo que compara el control «cobrado contra el ticket». */
  neto: ImporteJson;
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
        const devueltos = new Map(
          (
            await tx.devolucionesDeLaJornada.devueltoPorOrigen(
              contexto.empresaId,
              ORIGEN_DE_LA_COBRANZA,
              pagina.filter((o) => o.origen.tipo === ORIGEN_DE_LA_COBRANZA).map((o) => o.origen.id),
            )
          ).map((d) => [d.origenId, d.devuelto]),
        );
        return ok({
          origenes: pagina.map((o) => {
            const devuelto =
              o.origen.tipo === ORIGEN_DE_LA_COBRANZA ? devueltos.get(o.origen.id) : undefined;
            return {
              origen: o.origen,
              cobrado: importeAJson(o.cobrado),
              devuelto: importeAJson(devuelto ?? importeCero(ARS)),
              neto: importeAJson(devuelto === undefined ? o.cobrado : restar(o.cobrado, devuelto)),
              cobros: o.cobros,
            };
          }),
          siguiente:
            filas.length > limite && ultimo !== undefined
              ? { tipo: ultimo.origen.tipo, id: ultimo.origen.id }
              : null,
        });
      },
    );
  };
}
