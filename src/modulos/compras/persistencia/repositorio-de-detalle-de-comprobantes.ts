import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { esAlicuotaDeCompra, type AlicuotaDeCompra } from "../dominio/comprobante";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type LineaDeComprobante = Readonly<{
  numero: number;
  descripcion: string;
  unidad: string;
  cantidadFacturada: string;
  precioNeto: string;
  alicuota: AlicuotaDeCompra | null;
  netoDeLinea: string;
  ivaDeLinea: string;
  recepcionId: string | null;
  lineaDeRecepcion: number | null;
}>;

export type ImporteGuardadoPorAlicuota = Readonly<{
  alicuota: AlicuotaDeCompra;
  neto: string;
  iva: string;
}>;

export type TributoGuardado = Readonly<{
  numero: number;
  tipo: string;
  descripcion: string | null;
  baseImponible: string | null;
  alicuota: string | null;
  importe: string;
}>;

/**
 * Lo que cuelga de un comprobante (E9 §3.3): sus líneas, los importes por alícuota y los tributos. Solo entran en la transacción de su cabecera (disparador),
 * se escriben una vez y no se tocan nunca (solo inserción en la base); los saldos de las líneas los escribe la base.
 */
export interface RepositorioDeDetalleDeComprobantes {
  insertarLineas(
    empresa: EmpresaId,
    comprobanteId: string,
    lineas: readonly LineaDeComprobante[],
  ): Promise<void>;
  insertarImportes(
    empresa: EmpresaId,
    comprobanteId: string,
    importes: readonly ImporteGuardadoPorAlicuota[],
  ): Promise<void>;
  insertarTributos(
    empresa: EmpresaId,
    comprobanteId: string,
    tributos: readonly TributoGuardado[],
  ): Promise<void>;
  lineasDe(empresa: EmpresaId, comprobanteId: string): Promise<readonly LineaDeComprobante[]>;
  importesDe(
    empresa: EmpresaId,
    comprobanteId: string,
  ): Promise<readonly ImporteGuardadoPorAlicuota[]>;
  tributosDe(empresa: EmpresaId, comprobanteId: string): Promise<readonly TributoGuardado[]>;
}

function alicuotaGuardada(texto: string | null): AlicuotaDeCompra | null {
  if (texto === null) return null;
  if (!esAlicuotaDeCompra(texto)) throw new RangeError(`alícuota desconocida: ${texto}`);
  return texto;
}

export function crearRepositorioDeDetalleDeComprobantes(
  db: Kysely<ComprasDb>,
): RepositorioDeDetalleDeComprobantes {
  return {
    async insertarLineas(empresa, comprobanteId, lineas) {
      if (lineas.length === 0) return;
      await db
        .insertInto("linea_de_comprobante")
        .values(
          lineas.map((l) => ({
            empresa_id: empresa,
            comprobante_id: comprobanteId,
            numero: l.numero,
            descripcion: l.descripcion,
            unidad: l.unidad,
            cantidad_facturada: l.cantidadFacturada,
            precio_neto: l.precioNeto,
            alicuota: l.alicuota,
            neto_de_linea: l.netoDeLinea,
            iva_de_linea: l.ivaDeLinea,
            recepcion_id: l.recepcionId,
            linea_de_recepcion: l.lineaDeRecepcion,
          })),
        )
        .execute();
    },
    async insertarImportes(empresa, comprobanteId, importes) {
      if (importes.length === 0) return;
      await db
        .insertInto("importe_por_alicuota")
        .values(
          importes.map((i) => ({
            empresa_id: empresa,
            comprobante_id: comprobanteId,
            alicuota: i.alicuota,
            neto: i.neto,
            iva: i.iva,
          })),
        )
        .execute();
    },
    async insertarTributos(empresa, comprobanteId, tributos) {
      if (tributos.length === 0) return;
      await db
        .insertInto("tributo_de_comprobante")
        .values(
          tributos.map((t) => ({
            empresa_id: empresa,
            comprobante_id: comprobanteId,
            numero: t.numero,
            tipo: t.tipo,
            descripcion: t.descripcion,
            base_imponible: t.baseImponible,
            alicuota: t.alicuota,
            importe: t.importe,
          })),
        )
        .execute();
    },
    async lineasDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("linea_de_comprobante")
        .select([
          "numero",
          "descripcion",
          "unidad",
          "cantidad_facturada",
          "precio_neto",
          "alicuota",
          "neto_de_linea",
          "iva_de_linea",
          "recepcion_id",
          "linea_de_recepcion",
        ])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        descripcion: f.descripcion,
        unidad: f.unidad,
        cantidadFacturada: f.cantidad_facturada,
        precioNeto: f.precio_neto,
        alicuota: alicuotaGuardada(f.alicuota),
        netoDeLinea: f.neto_de_linea,
        ivaDeLinea: f.iva_de_linea,
        recepcionId: f.recepcion_id,
        lineaDeRecepcion: f.linea_de_recepcion,
      }));
    },
    async importesDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("importe_por_alicuota")
        .select(["alicuota", "neto", "iva"])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("alicuota")
        .execute();
      return filas.map((f) => {
        const alicuota = alicuotaGuardada(f.alicuota);
        if (alicuota === null) throw new RangeError("importe por alícuota sin alícuota");
        return { alicuota, neto: f.neto, iva: f.iva };
      });
    },
    async tributosDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("tributo_de_comprobante")
        .select(["numero", "tipo", "descripcion", "base_imponible", "alicuota", "importe"])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        tipo: f.tipo,
        descripcion: f.descripcion,
        baseImponible: f.base_imponible,
        alicuota: f.alicuota,
        importe: f.importe,
      }));
    },
  };
}
