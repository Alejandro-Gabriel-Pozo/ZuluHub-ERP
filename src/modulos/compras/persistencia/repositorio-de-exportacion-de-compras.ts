import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";
import { NIVELES_DE_RECEPCION_INMEDIATA } from "./repositorio-de-recepciones";

/**
 * Las lecturas masivas de la exportación de compras a Excel (dueño, 25/11/2026). SOLO LEEN. Toda consulta filtra por la empresa y por las sucursales del alcance de quien
 * pide (`TODAS` o una lista; una lista vacía no ve nada). Es el único archivo que toca las tablas de otros módulos que la exportación necesita rotular (sucursal, clasificación
 * comercial y unidad de medida), siempre por columnas escritas una por una: lo que el catálogo cambie lo detecta la prueba de integración, no producción.
 */

export type FiltroDeExportacion = Readonly<{
  sucursales: "TODAS" | readonly string[];
  /** Fechas civiles `AAAA-MM-DD`, inclusive. */
  desde: string;
  hasta: string;
}>;

export type FilaDeRecepcionParaExportar = Readonly<{
  id: string;
  numero: number;
  fechaNegocio: string;
  sucursalId: string;
  sucursalNombre: string;
  proveedorId: string;
  registradoEn: Date;
  registradoPor: string;
  /** El comprobante vigente de la compra (el registrado primero, el más nuevo entre iguales), o `null`. */
  comprobanteId: string | null;
  enCabecera: boolean;
  enDetalle: boolean;
}>;

export type PagoParaLaExportacion = Readonly<{
  id: string;
  comprobanteId: string;
  fechaDePago: string;
  medio: string;
  /** Las líneas de medio del pago con su importe, en el orden de la lista de medios. */
  medios: readonly Readonly<{ medio: string; importe: string }>[];
  importe: string;
  estado: "VIGENTE" | "ANULADO";
}>;

export type ClasificacionDeProducto = Readonly<{
  productoId: string;
  vigenteDesde: Date;
  /** El nombre del nodo; `null` = «Sin elegir». */
  nodo: string | null;
}>;

export interface RepositorioDeExportacionDeCompras {
  /** Cuántas filas tendría el archivo: las compras de la Cabecera y las líneas del Detalle (que son las del Resumen). */
  contar(
    empresa: EmpresaId,
    filtro: FiltroDeExportacion,
  ): Promise<Readonly<{ cabeceras: number; lineas: number }>>;
  /** Las compras confirmadas (N1 y N2) que entran en la Cabecera o en el Detalle, por `(fecha de negocio, número)` y de a `limite`. */
  recepcionesDelPeriodo(
    empresa: EmpresaId,
    filtro: FiltroDeExportacion,
    despuesDe: Readonly<{ fechaNegocio: string; numero: number }> | null,
    limite: number,
  ): Promise<readonly FilaDeRecepcionParaExportar[]>;
  /** Todos los pagos (vigentes y anulados) de esos comprobantes, en UNA consulta. */
  pagosDeComprobantes(
    empresa: EmpresaId,
    comprobanteIds: readonly string[],
  ): Promise<readonly PagoParaLaExportacion[]>;
  /** Las líneas de recepción que cubre cada comprobante (para repartir el abonado sobre TODAS las líneas de la factura, aunque el período deje algunas afuera). */
  lineasDeComprobantes(
    empresa: EmpresaId,
    comprobanteIds: readonly string[],
  ): Promise<readonly Readonly<{ comprobanteId: string; recepcionId: string; linea: number }>[]>;
  /** Código del producto y toda su historia de clasificación (el que corresponde a una fecha lo elige quien llama). */
  datosDeProductos(
    empresa: EmpresaId,
    productoIds: readonly string[],
  ): Promise<
    Readonly<{
      codigos: ReadonlyMap<string, string>;
      clasificaciones: readonly ClasificacionDeProducto[];
    }>
  >;
  /** El símbolo de cada unidad de medida (tabla global sembrada). */
  simbolosDeUnidades(): Promise<ReadonlyMap<string, string>>;
}

const NIVELES = sql.join(NIVELES_DE_RECEPCION_INMEDIATA.map((n) => sql.lit(n)));

/** Las compras del período y sus dos banderas (¿en la Cabecera? ¿en el Detalle?). Una sola definición para contar y para leer. */
function recepcionesDeLaExportacion(empresa: string, filtro: FiltroDeExportacion) {
  const sucursales =
    filtro.sucursales === "TODAS"
      ? sql`true`
      : sql`r.sucursal_id in (${sql.join([...filtro.sucursales].map((s) => sql`${s}::uuid`))})`;
  return sql`
    select r.id, r.numero, r.fecha_negocio, r.sucursal_id, s.nombre as sucursal_nombre, r.proveedor_id, r.registrado_en, r.registrado_por,
           cv.id as comprobante_id,
           coalesce(cv.fecha_del_comprobante, r.fecha_negocio) between ${filtro.desde}::date and ${filtro.hasta}::date as en_cabecera,
           r.fecha_negocio between ${filtro.desde}::date and ${filtro.hasta}::date as en_detalle
      from recepcion r
      join sucursal s on s.id = r.sucursal_id and s.empresa_id = r.empresa_id
      left join lateral (
        select c.id, c.fecha_del_comprobante
          from linea_de_comprobante l
          join comprobante_de_proveedor c on c.id = l.comprobante_id and c.empresa_id = l.empresa_id
         where l.empresa_id = r.empresa_id and l.recepcion_id = r.id
         order by (c.estado = 'REGISTRADO') desc, c.registrado_en desc
         limit 1) cv on true
     where r.empresa_id = ${empresa}::uuid
       and r.estado = 'CONFIRMADA'
       and r.nivel in (${NIVELES})
       and ${sucursales}`;
}

export function crearRepositorioDeExportacionDeCompras(
  db: Kysely<ComprasDb>,
): RepositorioDeExportacionDeCompras {
  return {
    async contar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0)
        return { cabeceras: 0, lineas: 0 };
      const { rows } = await sql<{ cabeceras: number; lineas: number }>`
        with r as (${recepcionesDeLaExportacion(empresa, filtro)})
        select (count(*) filter (where en_cabecera))::int as cabeceras,
               coalesce(sum(case when en_detalle
                 then (select count(*) from linea_de_recepcion l where l.empresa_id = ${empresa}::uuid and l.recepcion_id = r.id)
                 else 0 end), 0)::int as lineas
          from r`.execute(db);
      return { cabeceras: rows[0]?.cabeceras ?? 0, lineas: rows[0]?.lineas ?? 0 };
    },
    async recepcionesDelPeriodo(empresa, filtro, despuesDe, limite) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      const siguientes =
        despuesDe === null
          ? sql`true`
          : sql`(fecha_negocio, numero) > (${despuesDe.fechaNegocio}::date, ${despuesDe.numero}::integer)`;
      const { rows } = await sql<{
        id: string;
        numero: number;
        fecha_negocio: string;
        sucursal_id: string;
        sucursal_nombre: string;
        proveedor_id: string;
        registrado_en: Date;
        registrado_por: string;
        comprobante_id: string | null;
        en_cabecera: boolean;
        en_detalle: boolean;
      }>`
        with r as (${recepcionesDeLaExportacion(empresa, filtro)})
        select id, numero, fecha_negocio::text as fecha_negocio, sucursal_id, sucursal_nombre, proveedor_id, registrado_en, registrado_por,
               comprobante_id, en_cabecera, en_detalle
          from r
         where (en_cabecera or en_detalle) and ${siguientes}
         order by fecha_negocio, numero
         limit ${limite}::integer`.execute(db);
      return rows.map((f) => ({
        id: f.id,
        numero: f.numero,
        fechaNegocio: f.fecha_negocio,
        sucursalId: f.sucursal_id,
        sucursalNombre: f.sucursal_nombre,
        proveedorId: f.proveedor_id,
        registradoEn: f.registrado_en,
        registradoPor: f.registrado_por,
        comprobanteId: f.comprobante_id,
        enCabecera: f.en_cabecera,
        enDetalle: f.en_detalle,
      }));
    },
    async pagosDeComprobantes(empresa, comprobanteIds) {
      const ids = comprobanteIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("pago_de_comprobante")
        .select([
          "id",
          "comprobante_id",
          "medio",
          "estado",
          sql<string>`fecha_de_pago::text`.as("fecha_de_pago"),
          sql<string>`importe::text`.as("importe"),
        ])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "in", ids)
        .orderBy("registrado_en")
        .execute();
      const lineas =
        filas.length === 0
          ? []
          : await db
              .selectFrom("medio_de_un_pago")
              .select(["pago_id", "medio", "numero", sql<string>`importe::text`.as("importe")])
              .where("empresa_id", "=", empresa)
              .where(
                "pago_id",
                "in",
                filas.map((f) => f.id),
              )
              .orderBy("pago_id")
              .orderBy("numero")
              .execute();
      // Las líneas se agrupan UNA vez: filtrarlas por cada pago es una cuenta cuadrática.
      const porPago = new Map<string, { medio: string; importe: string }[]>();
      for (const l of lineas) {
        const lista = porPago.get(l.pago_id) ?? [];
        lista.push({ medio: l.medio, importe: l.importe });
        porPago.set(l.pago_id, lista);
      }
      return filas.map((f) => ({
        id: f.id,
        medios: porPago.get(f.id) ?? [],
        comprobanteId: f.comprobante_id,
        fechaDePago: f.fecha_de_pago,
        medio: f.medio,
        importe: f.importe,
        estado: f.estado === "VIGENTE" ? "VIGENTE" : "ANULADO",
      }));
    },
    async lineasDeComprobantes(empresa, comprobanteIds) {
      const ids = comprobanteIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("linea_de_comprobante")
        .select(["comprobante_id", "recepcion_id", "linea_de_recepcion"])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "in", ids)
        .where("recepcion_id", "is not", null)
        .execute();
      return filas.flatMap((f) =>
        f.recepcion_id === null || f.linea_de_recepcion === null
          ? []
          : [
              {
                comprobanteId: f.comprobante_id,
                recepcionId: f.recepcion_id,
                linea: f.linea_de_recepcion,
              },
            ],
      );
    },
    async datosDeProductos(empresa, productoIds) {
      const ids = [...new Set(productoIds)].filter(esUuid);
      if (ids.length === 0) return { codigos: new Map(), clasificaciones: [] };
      const lista = sql.join(ids.map((i) => sql`${i}::uuid`));
      const codigos = await sql<{ id: string; codigo: string | null }>`
        select id, codigo from producto where empresa_id = ${empresa}::uuid and id in (${lista})`.execute(
        db,
      );
      const clasificaciones = await sql<{
        producto_id: string;
        vigente_desde: Date;
        nodo: string | null;
      }>`
        select c.producto_id, c.vigente_desde, n.nombre as nodo
          from clasificacion_de_producto c
          left join nodo_de_clasificacion n on n.id = c.nodo_id and n.empresa_id = c.empresa_id
         where c.empresa_id = ${empresa}::uuid and c.producto_id in (${lista})`.execute(db);
      return {
        codigos: new Map(
          codigos.rows.flatMap((f) => (f.codigo === null ? [] : [[f.id, f.codigo]])),
        ),
        clasificaciones: clasificaciones.rows.map((f) => ({
          productoId: f.producto_id,
          vigenteDesde: f.vigente_desde,
          nodo: f.nodo,
        })),
      };
    },
    async simbolosDeUnidades() {
      const { rows } = await sql<{
        id: string;
        simbolo: string;
      }>`select id, simbolo from unidad_de_medida`.execute(db);
      return new Map(rows.map((f) => [f.id, f.simbolo]));
    },
  };
}
