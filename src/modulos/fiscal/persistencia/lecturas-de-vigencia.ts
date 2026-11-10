import type { Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { moneda } from "../../../primitivas/dinero/moneda";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import {
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_ORIGEN_DE_FACTURA_DE_ORIGEN,
  type TipoDeComprobante,
} from "../dominio/comprobante-emitido";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type EstadoDeComprobanteArca,
} from "../dominio/estados-de-comprobante";
import { comprobanteId, esUuid, type ComprobanteId } from "../dominio/identificadores";
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

/**
 * Los orígenes que se pueden preguntar (los mismos con los que se factura un documento: `emitirFacturaDeOrigenEnTx`) y la forma de su id (un
 * uuid): lista de permitidos. Viven acá porque la consulta por pantalla no importa el dominio y valida contra ESTO.
 */
export const ORIGENES_DE_DOCUMENTO: readonly string[] = TIPOS_DE_ORIGEN_DE_FACTURA_DE_ORIGEN;
export const esOrigenDeDocumentoValido = (tipo: string, id: string): boolean =>
  ORIGENES_DE_DOCUMENTO.includes(tipo) && esUuid(id);

/**
 * Los comprobantes de la empresa con ese origen (a lo sumo uno vive por origen, pero puede haber un rechazado o descartado que lo liberó), del
 * más viejo al más nuevo. Una consulta. Un origen ajeno a la empresa no devuelve nada.
 */
export type LecturaDelOrigen = (
  empresa: EmpresaId,
  tipo: string,
  id: string,
) => Promise<readonly ComprobanteParaVigencia[]>;

export function crearLecturaDelOrigen(db: Kysely<FiscalDb>): LecturaDelOrigen {
  return async (empresa, tipo, id) => {
    const filas = await db
      .selectFrom("comprobante")
      .select(["id", "tipo_comprobante", "estado", "moneda", "total"])
      .where("empresa_id", "=", empresa)
      .where("origen_tipo", "=", tipo)
      .where("origen_id", "=", id)
      .orderBy("creado_en")
      .orderBy("id")
      .execute();
    return filas.map((f) => ({
      id: comprobanteId(f.id),
      tipo: deLaLista(TIPOS_DE_COMPROBANTE, f.tipo_comprobante, "tipo de comprobante"),
      estado: deLaLista(ESTADOS_DE_COMPROBANTE_ARCA, f.estado, "estado de comprobante"),
      total: importeDesdeTexto(moneda(f.moneda), f.total),
    }));
  };
}
