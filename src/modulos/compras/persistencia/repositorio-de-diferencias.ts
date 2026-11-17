import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type {
  DiferenciaCalculada,
  OrigenDelPrecioDeReferencia,
  ResolucionManual,
  TipoDeDiferencia,
  Tolerancias,
} from "../dominio/diferencias";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type EstadoDeDiferencia = "ABIERTA" | "RESUELTA" | "ANULADA";
export type ResolucionGuardada = ResolucionManual | "DENTRO_DE_TOLERANCIA";

export type DiferenciaGuardada = Readonly<{
  id: string;
  conciliacionId: string;
  tipo: TipoDeDiferencia;
  comprobanteId: string;
  lineaDeComprobante: number | null;
  recepcionId: string | null;
  lineaDeRecepcion: number | null;
  cantidadDeDiferencia: string | null;
  importeDeDiferencia: string | null;
  precioFacturado: string | null;
  precioDeReferencia: string | null;
  origenDelPrecioDeReferencia: OrigenDelPrecioDeReferencia | null;
  dentroDeTolerancia: boolean;
  estado: EstadoDeDiferencia;
  resolucion: ResolucionGuardada | null;
  motivo: string | null;
  version: number;
}>;

export type FiltroDeListaDeDiferencias = Readonly<{
  estado: EstadoDeDiferencia | null;
  tipo: TipoDeDiferencia | null;
  comprobanteId: string | null;
  /** El `id` de la última fila de la página anterior (se ordena por `registrado_en` y `id`, de la más nueva a la más vieja; el cursor lleva ambos). */
  despuesDe: Readonly<{ registradoTexto: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeDiferencias = DiferenciaGuardada & Readonly<{ registradoTexto: string }>;

/** De dónde sale el precio de referencia de una línea recibida: el de la línea de la ORDEN si la recepción es contra una (aunque la orden no lleve precio) y, si no, el costo de la RECEPCIÓN. */
export type ReferenciaDePrecio = Readonly<{
  recepcionId: string;
  linea: number;
  referencia: Readonly<{ precio: string; origen: OrigenDelPrecioDeReferencia }> | null;
}>;

/**
 * Las diferencias de la conciliación de tres vías (N4, 0067). Se registran con su conciliación (misma transacción) y solo cambian de ABIERTA a RESUELTA o ANULADA; la base
 * impone las transiciones y fija el momento de resolver. Nada se borra.
 */
export interface RepositorioDeDiferencias {
  /** Copia de los umbrales vigentes a la conciliación (solo inserción). */
  insertarToleranciaAplicada(
    empresa: EmpresaId,
    conciliacionId: string,
    tolerancias: Tolerancias,
  ): Promise<void>;
  /** Registra las diferencias de la conciliación (ABIERTAS) con los umbrales aplicados; devuelve el id de cada una, en el mismo orden. */
  insertar(
    empresa: EmpresaId,
    alta: Readonly<{
      conciliacionId: string;
      comprobanteId: string;
      tolerancias: Tolerancias;
      diferencias: readonly DiferenciaCalculada[];
    }>,
  ): Promise<readonly string[]>;
  obtener(empresa: EmpresaId, id: string): Promise<DiferenciaGuardada | null>;
  /** Con `FOR UPDATE`: resolver dos veces a la vez la misma diferencia se serializa por acá. */
  bloquear(empresa: EmpresaId, id: string): Promise<DiferenciaGuardada | null>;
  /** De ABIERTA a RESUELTA con su resolución, motivo y quién; la base fija cuándo. */
  resolver(
    empresa: EmpresaId,
    id: string,
    resolucion: Readonly<{ por: PersonaId; resolucion: ResolucionGuardada; motivo: string | null }>,
  ): Promise<void>;
  /** Anula (estado ANULADA) las diferencias vivas de una conciliación; devuelve cuántas. Las ya resueltas conservan su resolución. */
  anularDeLaConciliacion(empresa: EmpresaId, conciliacionId: string): Promise<number>;
  /** Para cada (recepción, línea) pedida, el precio contra el que se compara lo facturado. */
  referenciasDePrecio(
    empresa: EmpresaId,
    lineas: readonly Readonly<{ recepcionId: string; linea: number }>[],
  ): Promise<readonly ReferenciaDePrecio[]>;
  listar(
    empresa: EmpresaId,
    filtro: FiltroDeListaDeDiferencias,
  ): Promise<readonly FilaDeListaDeDiferencias[]>;
}

type Fila = {
  id: string;
  conciliacion_id: string;
  tipo: string;
  comprobante_id: string;
  linea_de_comprobante: number | null;
  recepcion_id: string | null;
  linea_de_recepcion: number | null;
  cantidad_de_diferencia: string | null;
  importe_de_diferencia: string | null;
  precio_facturado: string | null;
  precio_de_referencia: string | null;
  origen_del_precio_de_referencia: string | null;
  dentro_de_tolerancia: boolean;
  estado: string;
  resolucion: string | null;
  motivo: string | null;
  version: number;
};

const aGuardada = (f: Fila): DiferenciaGuardada => ({
  id: f.id,
  conciliacionId: f.conciliacion_id,
  tipo: f.tipo as TipoDeDiferencia,
  comprobanteId: f.comprobante_id,
  lineaDeComprobante: f.linea_de_comprobante,
  recepcionId: f.recepcion_id,
  lineaDeRecepcion: f.linea_de_recepcion,
  cantidadDeDiferencia: f.cantidad_de_diferencia,
  importeDeDiferencia: f.importe_de_diferencia,
  precioFacturado: f.precio_facturado,
  precioDeReferencia: f.precio_de_referencia,
  origenDelPrecioDeReferencia:
    f.origen_del_precio_de_referencia as OrigenDelPrecioDeReferencia | null,
  dentroDeTolerancia: f.dentro_de_tolerancia,
  estado: f.estado as EstadoDeDiferencia,
  resolucion: f.resolucion as ResolucionGuardada | null,
  motivo: f.motivo,
  version: f.version,
});

export function crearRepositorioDeDiferencias(db: Kysely<ComprasDb>): RepositorioDeDiferencias {
  const seleccion = () =>
    db
      .selectFrom("diferencia_de_compra")
      .select([
        "id",
        "conciliacion_id",
        "tipo",
        "comprobante_id",
        "linea_de_comprobante",
        "recepcion_id",
        "linea_de_recepcion",
        sql<string | null>`cantidad_de_diferencia::text`.as("cantidad_de_diferencia"),
        sql<string | null>`importe_de_diferencia::text`.as("importe_de_diferencia"),
        sql<string | null>`precio_facturado::text`.as("precio_facturado"),
        sql<string | null>`precio_de_referencia::text`.as("precio_de_referencia"),
        "origen_del_precio_de_referencia",
        "dentro_de_tolerancia",
        "estado",
        "resolucion",
        "motivo",
        "version",
      ]);
  return {
    async insertarToleranciaAplicada(empresa, conciliacionId, t) {
      await db
        .insertInto("tolerancia_aplicada_de_conciliacion")
        .values({
          empresa_id: empresa,
          conciliacion_id: conciliacionId,
          tolerancia_de_cantidad: t.cantidad,
          tolerancia_de_precio: t.precio,
          tolerancia_de_importe: t.importe,
        })
        .execute();
    },
    async insertar(empresa, alta) {
      if (alta.diferencias.length === 0) return [];
      const filas = await db
        .insertInto("diferencia_de_compra")
        .values(
          alta.diferencias.map((d) => ({
            empresa_id: empresa,
            conciliacion_id: alta.conciliacionId,
            tipo: d.tipo,
            comprobante_id: alta.comprobanteId,
            linea_de_comprobante: d.lineaDeComprobante,
            recepcion_id: d.recepcionId,
            linea_de_recepcion: d.lineaDeRecepcion,
            cantidad_de_diferencia: d.cantidadDeDiferencia,
            importe_de_diferencia: d.importeDeDiferencia,
            precio_facturado: d.precioFacturado,
            precio_de_referencia: d.precioDeReferencia,
            origen_del_precio_de_referencia: d.origenDelPrecioDeReferencia,
            dentro_de_tolerancia: d.dentroDeTolerancia,
            tolerancia_de_cantidad: alta.tolerancias.cantidad,
            tolerancia_de_precio: alta.tolerancias.precio,
            tolerancia_de_importe: alta.tolerancias.importe,
          })),
        )
        .returning(["id", "tipo", "linea_de_comprobante", "recepcion_id", "linea_de_recepcion"])
        .execute();
      // El orden de los `returning` de un INSERT múltiple no se promete: se devuelve en el orden de las diferencias pedidas, por su clave natural.
      return alta.diferencias.map((d) => {
        const f = filas.find(
          (x) =>
            x.tipo === d.tipo &&
            x.linea_de_comprobante === d.lineaDeComprobante &&
            x.recepcion_id === d.recepcionId &&
            x.linea_de_recepcion === d.lineaDeRecepcion,
        );
        if (f === undefined) throw new Error("una diferencia insertada no volvió en el returning");
        return f.id;
      });
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const f = await seleccion()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined ? null : aGuardada(f);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      const f = await seleccion()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return f === undefined ? null : aGuardada(f);
    },
    async resolver(empresa, id, r) {
      await db
        .updateTable("diferencia_de_compra")
        .set({
          estado: "RESUELTA",
          resolucion: r.resolucion,
          motivo: r.motivo,
          resuelta_por: r.por,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .execute();
    },
    async anularDeLaConciliacion(empresa, conciliacionId) {
      const filas = await db
        .updateTable("diferencia_de_compra")
        .set({ estado: "ANULADA" })
        .where("empresa_id", "=", empresa)
        .where("conciliacion_id", "=", conciliacionId)
        .where("estado", "<>", "ANULADA")
        .returning("id")
        .execute();
      return filas.length;
    },
    async referenciasDePrecio(empresa, lineas) {
      const resultado: ReferenciaDePrecio[] = [];
      for (const l of lineas) {
        if (!esUuid(l.recepcionId)) {
          resultado.push({ recepcionId: l.recepcionId, linea: l.linea, referencia: null });
          continue;
        }
        const fila = await db
          .selectFrom("linea_de_recepcion as r")
          .leftJoin("linea_de_recepcion_de_orden as v", (j) =>
            j
              .onRef("v.empresa_id", "=", "r.empresa_id")
              .onRef("v.recepcion_id", "=", "r.recepcion_id")
              .onRef("v.linea", "=", "r.numero"),
          )
          .leftJoin("linea_de_orden as o", (j) =>
            j
              .onRef("o.empresa_id", "=", "v.empresa_id")
              .onRef("o.orden_id", "=", "v.orden_id")
              .onRef("o.numero", "=", "v.linea_de_orden"),
          )
          .select([
            sql<boolean>`v.recepcion_id is not null`.as("contra_orden"),
            sql<string | null>`o.precio_unitario::text`.as("precio_de_la_orden"),
            sql<string | null>`r.costo_por_unidad_de_stock::text`.as("costo_de_la_recepcion"),
          ])
          .where("r.empresa_id", "=", empresa)
          .where("r.recepcion_id", "=", l.recepcionId)
          .where("r.numero", "=", l.linea)
          .executeTakeFirst();
        let referencia: ReferenciaDePrecio["referencia"] = null;
        if (fila !== undefined) {
          if (fila.contra_orden) {
            if (fila.precio_de_la_orden !== null) {
              referencia = { precio: fila.precio_de_la_orden, origen: "ORDEN" };
            }
          } else if (fila.costo_de_la_recepcion !== null) {
            referencia = { precio: fila.costo_de_la_recepcion, origen: "RECEPCION" };
          }
        }
        resultado.push({ recepcionId: l.recepcionId, linea: l.linea, referencia });
      }
      return resultado;
    },
    async listar(empresa, filtro) {
      let consulta = seleccion()
        .select(sql<string>`registrado_en::text`.as("registrado_texto"))
        .where("empresa_id", "=", empresa);
      if (filtro.estado !== null) consulta = consulta.where("estado", "=", filtro.estado);
      if (filtro.tipo !== null) consulta = consulta.where("tipo", "=", filtro.tipo);
      if (filtro.comprobanteId !== null)
        consulta = consulta.where("comprobante_id", "=", filtro.comprobanteId);
      if (filtro.despuesDe !== null) {
        consulta = consulta.where(
          sql<boolean>`(registrado_en, id) < (${filtro.despuesDe.registradoTexto}::timestamptz, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy("registrado_en", "desc")
        .orderBy("id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({ ...aGuardada(f), registradoTexto: f.registrado_texto }));
    },
  };
}
