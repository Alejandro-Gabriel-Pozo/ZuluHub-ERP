import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeMovimiento } from "../dominio/movimiento";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";
import { claseDeMovimientoGuardada, usoDeDepositoGuardado, type UsoDeDeposito } from "./modelo";

/**
 * Las lecturas del libro y de los saldos que alimentan las consultas de stock (E5 §3.4): existencias, libro de un artículo con su saldo corrido,
 * los saldos negativos y la verificación de que el saldo es la suma de los renglones. Solo `select`. Viven aparte de la escritura del libro
 * (`repositorio-de-movimientos.ts`) por el tamaño del archivo, y `crearRepositorioDeMovimientos` las junta en un solo repositorio.
 */

export type FiltroDeExistencias = Readonly<{
  alcance: AlcanceDeSucursales;
  depositoId?: string | undefined;
  sucursalId?: SucursalId | undefined;
  /** Prefijo del nombre del producto (sin distinguir mayúsculas). */
  texto?: string | undefined;
  soloNegativas?: boolean | undefined;
  /** Paginación por `(nombre_clave, artículo, depósito)`: lo que viene después de esta terna. */
  despuesDe?: Readonly<{ nombreClave: string; articuloId: string; depositoId: string }> | undefined;
  limite: number;
}>;

export type FilaDeExistencia = Readonly<{
  articuloId: string;
  productoId: string;
  nombre: string;
  nombreClave: string;
  unidadId: string;
  depositoId: string;
  sucursalId: SucursalId;
  /** Texto decimal exacto; puede ser negativa. */
  existencia: string;
  uso: UsoDeDeposito;
}>;

export type FiltroDeLibro = Readonly<{
  articuloId: string;
  depositoId: string;
  /** Fechas de NEGOCIO `YYYY-MM-DD`, extremos incluidos. */
  desde: string;
  hasta: string;
  despuesDe?:
    | Readonly<{ fechaDeNegocio: string; hechoEn: Date; movimientoId: string; numero: number }>
    | undefined;
  limite: number;
}>;

/** Un renglón del libro de un (depósito, artículo) con el saldo corrido DESPUÉS de aplicarlo (desde el primer movimiento, no desde `desde`). */
export type FilaDeLibro = Readonly<{
  movimientoId: string;
  numero: number;
  clase: ClaseDeMovimiento;
  motivo: string;
  origenTipo: string;
  origenId: string | null;
  detalle: string | null;
  hechoEn: Date;
  registradoEn: Date;
  fechaDeNegocio: string;
  registradoPor: PersonaId;
  cantidad: string;
  saldo: string;
  composicionId: string | null;
  /** El número de versión de la composición de la que salió lo descontado. */
  composicionNumero: number | null;
  /** El movimiento que anuló a este, si lo hay. */
  anuladoPor: string | null;
}>;

export type DiferenciaDeSaldo = Readonly<{
  depositoId: string;
  articuloId: string;
  saldo: string;
  suma: string;
}>;

export interface LecturasDelLibro {
  /** Una fila por saldo existente (lo que nunca se movió no figura), por nombre de producto, artículo y depósito; paginado por cursor. */
  existencias(empresa: EmpresaId, filtro: FiltroDeExistencias): Promise<FilaDeExistencia[]>;
  /** Los renglones de un (depósito, artículo) por fecha de negocio, con el saldo corrido desde el primer movimiento; paginado por cursor. */
  libroDeArticulo(empresa: EmpresaId, filtro: FiltroDeLibro): Promise<FilaDeLibro[]>;
  /** Cuántos saldos están en negativo en esa sucursal (para el aporte al cierre del día). */
  contarNegativasDe(empresa: EmpresaId, sucursal: SucursalId): Promise<number>;
  /** Los pares cuyo saldo difiere de la suma de sus renglones: **debe ser vacío** (el saldo se deriva del libro). */
  verificarSaldos(empresa: EmpresaId): Promise<DiferenciaDeSaldo[]>;
}

/** Escapa `%`, `_` y `\` de lo que se busca con `LIKE`: el texto es del usuario. */
const comoPrefijo = (texto: string): string => `${texto.replace(/[\\%_]/g, "\\$&")}%`;

export function crearLecturasDelLibro(db: Kysely<StockDb>): LecturasDelLibro {
  return {
    async existencias(empresa, filtro) {
      if (filtro.alcance !== "TODAS" && filtro.alcance.length === 0) return [];
      let consulta = db
        .selectFrom("saldo_de_stock as s")
        .innerJoin("articulo_de_stock as a", (j) =>
          j.onRef("a.id", "=", "s.articulo_id").onRef("a.empresa_id", "=", "s.empresa_id"),
        )
        .innerJoin("producto as p", (j) =>
          j.onRef("p.id", "=", "a.producto_id").onRef("p.empresa_id", "=", "a.empresa_id"),
        )
        .innerJoin("deposito as d", (j) =>
          j.onRef("d.id", "=", "s.deposito_id").onRef("d.empresa_id", "=", "s.empresa_id"),
        )
        .select([
          "s.articulo_id",
          "a.producto_id",
          "p.nombre",
          "p.nombre_clave",
          "a.unidad_de_stock_id",
          "s.deposito_id",
          "d.sucursal_id",
          "s.existencia",
          "d.uso",
        ])
        .where("s.empresa_id", "=", empresa);
      if (filtro.alcance !== "TODAS") {
        consulta = consulta.where("d.sucursal_id", "in", [...filtro.alcance]);
      }
      if (filtro.depositoId !== undefined) {
        if (!esUuid(filtro.depositoId)) return [];
        consulta = consulta.where("s.deposito_id", "=", filtro.depositoId);
      }
      if (filtro.sucursalId !== undefined) {
        consulta = consulta.where("d.sucursal_id", "=", filtro.sucursalId);
      }
      if (filtro.texto !== undefined && filtro.texto !== "") {
        consulta = consulta.where(
          sql<boolean>`p.nombre_clave like ${comoPrefijo(filtro.texto.toLowerCase())} escape '\\'`,
        );
      }
      if (filtro.soloNegativas === true) consulta = consulta.where(sql<boolean>`s.existencia < 0`);
      if (filtro.despuesDe !== undefined) {
        const { nombreClave, articuloId, depositoId } = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(p.nombre_clave, s.articulo_id, s.deposito_id) > (${nombreClave}, ${articuloId}::uuid, ${depositoId}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy("p.nombre_clave")
        .orderBy("s.articulo_id")
        .orderBy("s.deposito_id")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        articuloId: f.articulo_id,
        productoId: f.producto_id,
        nombre: f.nombre,
        nombreClave: f.nombre_clave,
        unidadId: f.unidad_de_stock_id,
        depositoId: f.deposito_id,
        sucursalId: f.sucursal_id as SucursalId,
        existencia: f.existencia,
        uso: usoDeDepositoGuardado(f.uso),
      }));
    },
    async libroDeArticulo(empresa, filtro) {
      if (!esUuid(filtro.articuloId) || !esUuid(filtro.depositoId)) return [];
      const despues =
        filtro.despuesDe === undefined
          ? sql``
          : sql`and (t.fecha, t.hecho_en, t.movimiento_id, t.numero) >
                    (${filtro.despuesDe.fechaDeNegocio}::date, ${filtro.despuesDe.hechoEn}::timestamptz,
                     ${filtro.despuesDe.movimientoId}::uuid, ${filtro.despuesDe.numero}::integer)`;
      const { rows } = await sql<{
        movimiento_id: string;
        numero: number;
        clase: string;
        motivo: string;
        origen_tipo: string;
        origen_id: string | null;
        detalle: string | null;
        hecho_en: Date;
        registrado_en: Date;
        fecha_negocio: string;
        registrado_por: string;
        cantidad: string;
        saldo: string;
        composicion_id: string | null;
        composicion_numero: number | null;
        anulado_por: string | null;
      }>`
        select t.movimiento_id, t.numero, t.clase, t.motivo, t.origen_tipo, t.origen_id, t.detalle, t.hecho_en, t.registrado_en,
               t.fecha::text as fecha_negocio, t.registrado_por, t.cantidad::text as cantidad, t.saldo::text as saldo,
               t.composicion_id, t.composicion_numero, t.anulado_por
          from (
            select r.movimiento_id, r.numero, m.clase, m.motivo, m.origen_tipo, m.origen_id, m.detalle, r.hecho_en, m.registrado_en,
                   r.fecha_negocio as fecha, m.registrado_por, r.cantidad, r.composicion_id, c.numero as composicion_numero,
                   (select x.id from movimiento_de_stock x where x.empresa_id = m.empresa_id and x.anula_a = m.id) as anulado_por,
                   sum(r.cantidad) over (order by r.fecha_negocio, r.hecho_en, r.movimiento_id, r.numero) as saldo
              from renglon_de_movimiento r
              join movimiento_de_stock m on m.id = r.movimiento_id and m.empresa_id = r.empresa_id
              left join composicion c on c.id = r.composicion_id and c.empresa_id = r.empresa_id
             where r.empresa_id = ${empresa} and r.articulo_id = ${filtro.articuloId}::uuid and r.deposito_id = ${filtro.depositoId}::uuid
          ) t
         where t.fecha between ${filtro.desde}::date and ${filtro.hasta}::date ${despues}
         order by t.fecha, t.hecho_en, t.movimiento_id, t.numero
         limit ${filtro.limite}`.execute(db);
      return rows.map((f) => ({
        movimientoId: f.movimiento_id,
        numero: f.numero,
        clase: claseDeMovimientoGuardada(f.clase),
        motivo: f.motivo,
        origenTipo: f.origen_tipo,
        origenId: f.origen_id,
        detalle: f.detalle,
        hechoEn: f.hecho_en,
        registradoEn: f.registrado_en,
        fechaDeNegocio: f.fecha_negocio,
        registradoPor: f.registrado_por as PersonaId,
        cantidad: f.cantidad,
        saldo: f.saldo,
        composicionId: f.composicion_id,
        composicionNumero: f.composicion_numero,
        anuladoPor: f.anulado_por,
      }));
    },
    async contarNegativasDe(empresa, sucursal) {
      const { rows } = await sql<{ n: string }>`
        select count(*)::text as n
          from saldo_de_stock s
          join deposito d on d.id = s.deposito_id and d.empresa_id = s.empresa_id
         where s.empresa_id = ${empresa} and d.sucursal_id = ${sucursal}::uuid and s.existencia < 0`.execute(
        db,
      );
      return Number(rows[0]?.n ?? "0");
    },
    async verificarSaldos(empresa) {
      const { rows } = await sql<{
        deposito_id: string;
        articulo_id: string;
        saldo: string;
        suma: string;
      }>`
        select coalesce(s.deposito_id, r.deposito_id) as deposito_id, coalesce(s.articulo_id, r.articulo_id) as articulo_id,
               coalesce(s.existencia, 0)::text as saldo, coalesce(r.suma, 0)::text as suma
          from (select deposito_id, articulo_id, existencia from saldo_de_stock where empresa_id = ${empresa}) s
          full join (select deposito_id, articulo_id, sum(cantidad) as suma
                       from renglon_de_movimiento where empresa_id = ${empresa} group by deposito_id, articulo_id) r
            on r.deposito_id = s.deposito_id and r.articulo_id = s.articulo_id
         where coalesce(s.existencia, 0) <> coalesce(r.suma, 0)
         order by 1, 2`.execute(db);
      return rows.map((f) => ({
        depositoId: f.deposito_id,
        articuloId: f.articulo_id,
        saldo: f.saldo,
        suma: f.suma,
      }));
    },
  };
}
