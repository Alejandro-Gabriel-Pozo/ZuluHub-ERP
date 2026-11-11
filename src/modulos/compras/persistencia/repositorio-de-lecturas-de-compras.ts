import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";
import {
  aRecepcion,
  COLUMNAS_DE_RECEPCION,
  type EstadoDeRecepcion,
  type Recepcion,
} from "./repositorio-de-recepciones";

export type FiltroDeCompras = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor; una lista vacía no ve nada. */
  sucursales: "TODAS" | readonly string[];
  proveedorId: string | null;
  estado: EstadoDeRecepcion | null;
  /** `true`: solo las que tienen un comprobante registrado; `false`: solo las que no; `null`: todas. */
  facturada: boolean | null;
  /** Fechas de negocio, `YYYY-MM-DD`, ambas inclusive. */
  desde: string | null;
  hasta: string | null;
  despuesDe: Readonly<{ fechaNegocio: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeCompras = Recepcion &
  Readonly<{
    /** El estado del comprobante de esta recepción (el más vigente), o `null` si no tiene. */
    comprobanteEstado: "REGISTRADO" | "ANULADO" | null;
  }>;

/**
 * Lo que las pantallas leen de las recepciones (E9 §3.10): la lista con su estado de comprobante, las que tienen líneas «Sin precio» y el estado de la factura de
 * una compra. Solo lecturas: la escritura de las recepciones es de `RepositorioDeRecepciones`.
 */
export interface RepositorioDeLecturasDeCompras {
  listar(empresa: EmpresaId, filtro: FiltroDeCompras): Promise<readonly FilaDeListaDeCompras[]>;
  /** Las recepciones confirmadas con al menos una línea sin precio («Sin precio»), de las sucursales del alcance. */
  sinPrecio(
    empresa: EmpresaId,
    sucursales: "TODAS" | readonly string[],
    limite: number,
  ): Promise<readonly FilaDeListaDeCompras[]>;
  /** El estado del comprobante vigente de la recepción, o `null` si no tiene. */
  estadoDelComprobante(
    empresa: EmpresaId,
    recepcionId: string,
  ): Promise<"REGISTRADO" | "ANULADO" | null>;
}

/** El estado del comprobante vigente de la recepción (el registrado si lo hay; si no, el más nuevo), o `null` si no tiene. */
const ESTADO_DEL_COMPROBANTE = sql<
  string | null
>`(select c.estado from linea_de_comprobante l join comprobante_de_proveedor c on c.id = l.comprobante_id and c.empresa_id = l.empresa_id
    where l.empresa_id = recepcion.empresa_id and l.recepcion_id = recepcion.id
    order by (c.estado = 'REGISTRADO') desc, c.registrado_en desc limit 1)`.as(
  "comprobante_estado",
);

const aEstadoDeComprobante = (texto: string | null): "REGISTRADO" | "ANULADO" | null =>
  texto === "REGISTRADO" || texto === "ANULADO" ? texto : null;

export function crearRepositorioDeLecturasDeCompras(
  db: Kysely<ComprasDb>,
): RepositorioDeLecturasDeCompras {
  return {
    async listar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion")
        .select([...COLUMNAS_DE_RECEPCION, ESTADO_DEL_COMPROBANTE])
        .where("empresa_id", "=", empresa);
      if (filtro.sucursales !== "TODAS") {
        consulta = consulta.where("sucursal_id", "in", [...filtro.sucursales]);
      }
      if (filtro.proveedorId !== null)
        consulta = consulta.where("proveedor_id", "=", filtro.proveedorId);
      if (filtro.estado !== null) consulta = consulta.where("estado", "=", filtro.estado);
      if (filtro.facturada !== null) {
        const conComprobante = sql<boolean>`exists (select 1 from linea_de_comprobante l join comprobante_de_proveedor c on c.id = l.comprobante_id and c.empresa_id = l.empresa_id
              where l.empresa_id = recepcion.empresa_id and l.recepcion_id = recepcion.id and c.estado = 'REGISTRADO')`;
        consulta = consulta.where(
          filtro.facturada ? conComprobante : sql<boolean>`not ${conComprobante}`,
        );
      }
      if (filtro.desde !== null)
        consulta = consulta.where(sql`fecha_negocio`, ">=", sql`${filtro.desde}::date`);
      if (filtro.hasta !== null)
        consulta = consulta.where(sql`fecha_negocio`, "<=", sql`${filtro.hasta}::date`);
      if (filtro.despuesDe !== null) {
        const c = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(fecha_negocio, id) < (${c.fechaNegocio}::date, ${c.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy(sql`fecha_negocio`, "desc")
        .orderBy("id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        ...aRecepcion(f),
        comprobanteEstado: aEstadoDeComprobante(f.comprobante_estado),
      }));
    },
    async sinPrecio(empresa, sucursales, limite) {
      if (sucursales !== "TODAS" && sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion")
        .select([...COLUMNAS_DE_RECEPCION, ESTADO_DEL_COMPROBANTE])
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "CONFIRMADA")
        .where(
          sql<boolean>`exists (select 1 from linea_de_recepcion l where l.empresa_id = recepcion.empresa_id and l.recepcion_id = recepcion.id and l.precio is null)`,
        );
      if (sucursales !== "TODAS") consulta = consulta.where("sucursal_id", "in", [...sucursales]);
      const filas = await consulta
        .orderBy(sql`fecha_negocio`, "desc")
        .orderBy("id", "desc")
        .limit(limite)
        .execute();
      return filas.map((f) => ({
        ...aRecepcion(f),
        comprobanteEstado: aEstadoDeComprobante(f.comprobante_estado),
      }));
    },
    async estadoDelComprobante(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return null;
      const fila = await db
        .selectFrom("recepcion")
        .select([ESTADO_DEL_COMPROBANTE])
        .where("empresa_id", "=", empresa)
        .where("id", "=", recepcionId)
        .executeTakeFirst();
      return aEstadoDeComprobante(fila?.comprobante_estado ?? null);
    },
  };
}
