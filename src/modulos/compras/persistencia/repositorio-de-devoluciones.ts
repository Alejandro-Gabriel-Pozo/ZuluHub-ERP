import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type EstadoDeDevolucion = "CONFIRMADA" | "ANULADA";

export type DevolucionGuardada = Readonly<{
  id: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  motivoId: string;
  /** El nombre del motivo en la lista del sistema (lo que ve la persona). */
  motivo: string;
  remitoNumero: string | null;
  /** Fecha civil `YYYY-MM-DD`. */
  remitoFecha: string | null;
  huella: string;
  hechoEn: Date;
  /** Jornada de la sucursal (`YYYY-MM-DD`): la fija la base. */
  fechaNegocio: string;
  estado: EstadoDeDevolucion;
  registradoPor: string;
  anuladaPor: string | null;
  anuladaEn: Date | null;
  motivoDeAnulacion: string | null;
  version: number;
}>;

export type LineaDeDevolucionGuardada = Readonly<{
  numero: number;
  depositoId: string;
  articuloId: string;
  cantidad: string;
  recepcionId: string | null;
  lineaDeRecepcion: number | null;
  movimientoId: string;
  renglonNumero: number;
}>;

export type FiltroDeListaDeDevoluciones = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor: sin sucursal elegida nunca se asume «todas». */
  sucursales: "TODAS" | readonly string[];
  proveedorId: string | null;
  estado: EstadoDeDevolucion | null;
  /** El `registradoTexto` y el id de la última fila de la página anterior. */
  despuesDe: Readonly<{ registradoTexto: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeDevoluciones = DevolucionGuardada &
  Readonly<{
    /** `registrado_en` en texto exacto (con microsegundos): es el cursor de la página. */
    registradoTexto: string;
    /** Cuántas líneas tiene. */
    renglones: number;
  }>;

export type AltaDeDevolucion = Readonly<{
  sucursalId: string;
  proveedorId: string;
  motivoId: string;
  remitoNumero: string | null;
  remitoFecha: string | null;
  clave: string;
  huella: string;
  hechoEn: Date;
  registradoPor: PersonaId;
}>;

export type NuevaLineaDeDevolucion = LineaDeDevolucionGuardada;

/**
 * Las devoluciones de mercadería al proveedor (0084): la cabecera (con el número y la jornada que fija la base), sus líneas (con el renglón de stock de cada una) y la
 * anulación. La base impone que solo cambie su estado, el tope de lo recibido y el motivo de la lista; acá solo se lee y se escribe.
 */
export interface RepositorioDeDevoluciones {
  porClave(empresa: EmpresaId, clave: string): Promise<DevolucionGuardada | null>;
  obtener(empresa: EmpresaId, id: string): Promise<DevolucionGuardada | null>;
  /** Con `FOR UPDATE`: anular una misma devolución dos veces a la vez se serializa por acá. */
  bloquear(empresa: EmpresaId, id: string): Promise<DevolucionGuardada | null>;
  /** `undefined` si perdió una carrera por la clave (otra transacción ya escribió la misma). */
  insertar(empresa: EmpresaId, alta: AltaDeDevolucion): Promise<string | undefined>;
  insertarLineas(
    empresa: EmpresaId,
    devolucionId: string,
    lineas: readonly NuevaLineaDeDevolucion[],
  ): Promise<void>;
  lineasDe(empresa: EmpresaId, devolucionId: string): Promise<readonly LineaDeDevolucionGuardada[]>;
  /** De CONFIRMADA a ANULADA, con quién y por qué; el momento lo fija la base. */
  anular(
    empresa: EmpresaId,
    id: string,
    datos: Readonly<{ por: PersonaId; motivo: string }>,
  ): Promise<void>;
  /** De la más nueva a la más vieja (`registrado_en`, `id`), con el filtro y el alcance de sucursales. */
  listar(
    empresa: EmpresaId,
    filtro: FiltroDeListaDeDevoluciones,
  ): Promise<readonly FilaDeListaDeDevoluciones[]>;
}

type FilaDeDevolucion = {
  id: string;
  numero: number;
  sucursal_id: string;
  proveedor_id: string;
  motivo_id: string;
  motivo: string;
  remito_numero: string | null;
  remito_fecha: string | null;
  huella: string;
  hecho_en: Date;
  fecha_negocio: string;
  estado: string;
  registrado_por: string;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_de_anulacion: string | null;
  version: number;
};

function aDevolucion(f: FilaDeDevolucion): DevolucionGuardada {
  if (f.estado !== "CONFIRMADA" && f.estado !== "ANULADA") {
    throw new RangeError(`estado de devolución desconocido: ${f.estado}`);
  }
  return {
    id: f.id,
    numero: f.numero,
    sucursalId: f.sucursal_id,
    proveedorId: f.proveedor_id,
    motivoId: f.motivo_id,
    motivo: f.motivo,
    remitoNumero: f.remito_numero,
    remitoFecha: f.remito_fecha,
    huella: f.huella,
    hechoEn: f.hecho_en,
    fechaNegocio: f.fecha_negocio,
    estado: f.estado,
    registradoPor: f.registrado_por,
    anuladaPor: f.anulada_por,
    anuladaEn: f.anulada_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    version: f.version,
  };
}

export function crearRepositorioDeDevoluciones(db: Kysely<ComprasDb>): RepositorioDeDevoluciones {
  const seleccion = () =>
    db
      .selectFrom("devolucion_a_proveedor as d")
      .innerJoin("valor_de_lista as v", "v.id", "d.motivo_id")
      .select([
        "d.id as id",
        "d.numero as numero",
        "d.sucursal_id as sucursal_id",
        "d.proveedor_id as proveedor_id",
        "d.motivo_id as motivo_id",
        "v.nombre as motivo",
        "d.remito_de_devolucion_numero as remito_numero",
        sql<string | null>`d.remito_de_devolucion_fecha::text`.as("remito_fecha"),
        "d.huella as huella",
        "d.hecho_en as hecho_en",
        sql<string>`d.fecha_negocio::text`.as("fecha_negocio"),
        "d.estado as estado",
        "d.registrado_por as registrado_por",
        "d.anulada_por as anulada_por",
        "d.anulada_en as anulada_en",
        "d.motivo_de_anulacion as motivo_de_anulacion",
        "d.version as version",
      ]);
  return {
    async porClave(empresa, clave) {
      const fila = await seleccion()
        .where("d.empresa_id", "=", empresa)
        .where("d.clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aDevolucion(fila);
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccion()
        .where("d.empresa_id", "=", empresa)
        .where("d.id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aDevolucion(fila);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      // Se bloquea solo la devolución (`FOR UPDATE OF d`): la lista del sistema es global y no se toca.
      const fila = await seleccion()
        .where("d.empresa_id", "=", empresa)
        .where("d.id", "=", id)
        .forUpdate("d")
        .executeTakeFirst();
      return fila === undefined ? null : aDevolucion(fila);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("devolucion_a_proveedor")
        .values({
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          proveedor_id: alta.proveedorId,
          motivo_id: alta.motivoId,
          remito_de_devolucion_numero: alta.remitoNumero,
          remito_de_devolucion_fecha: alta.remitoFecha,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          hecho_en: alta.hechoEn,
          registrado_por: alta.registradoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila?.id;
    },
    async insertarLineas(empresa, devolucionId, lineas) {
      if (lineas.length === 0) return;
      await db
        .insertInto("linea_de_devolucion")
        .values(
          lineas.map((l) => ({
            empresa_id: empresa,
            devolucion_id: devolucionId,
            numero: l.numero,
            deposito_id: l.depositoId,
            articulo_id: l.articuloId,
            cantidad: l.cantidad,
            recepcion_id: l.recepcionId,
            linea_de_recepcion: l.lineaDeRecepcion,
            movimiento_id: l.movimientoId,
            renglon_numero: l.renglonNumero,
          })),
        )
        .execute();
    },
    async lineasDe(empresa, devolucionId) {
      if (!esUuid(devolucionId)) return [];
      const filas = await db
        .selectFrom("linea_de_devolucion")
        .select([
          "numero",
          "deposito_id",
          "articulo_id",
          sql<string>`cantidad::text`.as("cantidad"),
          "recepcion_id",
          "linea_de_recepcion",
          "movimiento_id",
          "renglon_numero",
        ])
        .where("empresa_id", "=", empresa)
        .where("devolucion_id", "=", devolucionId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        depositoId: f.deposito_id,
        articuloId: f.articulo_id,
        cantidad: f.cantidad,
        recepcionId: f.recepcion_id,
        lineaDeRecepcion: f.linea_de_recepcion,
        movimientoId: f.movimiento_id,
        renglonNumero: f.renglon_numero,
      }));
    },
    async anular(empresa, id, datos) {
      await db
        .updateTable("devolucion_a_proveedor")
        .set({ estado: "ANULADA", anulada_por: datos.por, motivo_de_anulacion: datos.motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .execute();
    },
    async listar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = seleccion()
        .select([
          sql<string>`d.registrado_en::text`.as("registrado_texto"),
          sql<number>`(select count(*) from linea_de_devolucion l where l.empresa_id = d.empresa_id and l.devolucion_id = d.id)::int`.as(
            "renglones",
          ),
        ])
        .where("d.empresa_id", "=", empresa);
      if (filtro.sucursales !== "TODAS") {
        consulta = consulta.where("d.sucursal_id", "in", [...filtro.sucursales]);
      }
      if (filtro.proveedorId !== null) {
        consulta = consulta.where("d.proveedor_id", "=", filtro.proveedorId);
      }
      if (filtro.estado !== null) consulta = consulta.where("d.estado", "=", filtro.estado);
      if (filtro.despuesDe !== null) {
        consulta = consulta.where(
          sql<boolean>`(d.registrado_en, d.id) < (${filtro.despuesDe.registradoTexto}::timestamptz, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy("d.registrado_en", "desc")
        .orderBy("d.id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        ...aDevolucion(f),
        registradoTexto: f.registrado_texto,
        renglones: f.renglones,
      }));
    },
  };
}
