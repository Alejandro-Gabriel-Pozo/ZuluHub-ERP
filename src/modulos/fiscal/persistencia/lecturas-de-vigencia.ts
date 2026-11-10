import type { Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { moneda } from "../../../primitivas/dinero/moneda";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { TIPOS_DE_COMPROBANTE, type TipoDeComprobante } from "../dominio/comprobante-emitido";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type EstadoDeComprobanteArca,
} from "../dominio/estados-de-comprobante";
import { comprobanteId, type ComprobanteId } from "../dominio/identificadores";
import { deLaLista } from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Lo mínimo de un comprobante para saber si sigue valiendo (`vigenciaDeComprobantes`): su tipo, su estado y su total. */
export type ComprobanteParaVigencia = Readonly<{
  id: ComprobanteId;
  tipo: TipoDeComprobante;
  estado: EstadoDeComprobanteArca;
  total: Importe;
}>;

/**
 * Con UNA consulta: el tipo, el estado y el total de los comprobantes de la empresa que están en `ids`. Un id inexistente o de otra empresa NO
 * figura en la salida (no se distingue uno del otro). Va con `ids` de forma uuid: quien arma la entrada lo valida, como con el detalle.
 */
export type LecturaParaVigencia = (
  empresa: EmpresaId,
  ids: readonly ComprobanteId[],
) => Promise<readonly ComprobanteParaVigencia[]>;

export function crearLecturaParaVigencia(db: Kysely<FiscalDb>): LecturaParaVigencia {
  return async (empresa, ids) => {
    if (ids.length === 0) return [];
    const filas = await db
      .selectFrom("comprobante")
      .select(["id", "tipo_comprobante", "estado", "moneda", "total"])
      .where("empresa_id", "=", empresa)
      .where("id", "in", ids)
      .execute();
    return filas.map((f) => ({
      id: comprobanteId(f.id),
      tipo: deLaLista(TIPOS_DE_COMPROBANTE, f.tipo_comprobante, "tipo de comprobante"),
      estado: deLaLista(ESTADOS_DE_COMPROBANTE_ARCA, f.estado, "estado de comprobante"),
      total: importeDesdeTexto(moneda(f.moneda), f.total),
    }));
  };
}
