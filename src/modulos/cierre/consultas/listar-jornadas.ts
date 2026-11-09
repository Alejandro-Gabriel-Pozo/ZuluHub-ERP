import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeClaveDeJornada } from "../comun";
import type { EstadoDeJornada } from "../estados";
import { prepararConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCierre, TxDeConsultasDeCierre } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeListarJornadas = Readonly<{
  sucursalId: string;
  /** Primera fecha de negocio (inclusive), `YYYY-MM-DD`. */
  desde: string;
  /** Última fecha de negocio (inclusive), `YYYY-MM-DD`. */
  hasta: string;
}>;

export type JornadaDeLista = Readonly<{
  fechaDeNegocio: string;
  estado: EstadoDeJornada;
  cerradaEn: Date | null;
  cerradaPor: string | null;
}>;

/** Tope de jornadas por pedido (las más recientes primero): acota lo que lee y devuelve una consulta. */
export const MAXIMO_DE_JORNADAS_POR_PEDIDO = 100;

export type ErrorAlListarJornadas = ErrorDeConsulta | ErrorDePersistencia;

/**
 * Las jornadas de una sucursal entre dos fechas de negocio, de la más nueva a la más vieja, hasta `MAXIMO_DE_JORNADAS_POR_PEDIDO`
 * (e3b §3.3). `jornadas.ver`, `read committed`, alcance de sucursal. Fechas mal escritas o `desde` posterior a `hasta` →
 * `FECHA_INVALIDA`.
 */
export function armarListarJornadas({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCierre<unknown>) {
  return async function listarJornadas(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarJornadas,
  ): Promise<Resultado<readonly JornadaDeLista[], ErrorAlListarJornadas>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx: TxDeConsultasDeCierre,
      ): Promise<Resultado<readonly JornadaDeLista[], ErrorDeConsulta | ErrorDeClaveDeJornada>> => {
        const previo = await prepararConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarJornadas.accion,
          { sucursalId: entrada.sucursalId, fechaDeNegocio: entrada.hasta },
        );
        if (!previo.ok) return previo;
        const desde = fechaCivilDesdeTexto(typeof entrada.desde === "string" ? entrada.desde : "");
        if (!desde.ok || desde.valor > previo.valor.clave.fecha) return err("FECHA_INVALIDA");
        const jornadas = await tx.jornadas.listar(
          previo.valor.clave.empresa,
          previo.valor.clave.sucursal,
          desde.valor,
          previo.valor.clave.fecha,
          MAXIMO_DE_JORNADAS_POR_PEDIDO,
        );
        return ok(
          jornadas.map((jornada) => ({
            fechaDeNegocio: jornada.fechaDeNegocio,
            estado: jornada.estado,
            cerradaEn: jornada.cerradaEn,
            cerradaPor: jornada.cerradaPor,
          })),
        );
      },
    );
  };
}
