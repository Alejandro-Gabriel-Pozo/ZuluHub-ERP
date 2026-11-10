import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";
import { llaveDeSaldo } from "./repositorio-de-movimientos";

/**
 * Las tablas del costo (0031, E5-T10): el promedio móvil ponderado por (depósito, artículo) y el costo congelado de cada renglón del libro, con
 * las lecturas que alimentan las consultas de costos. Los decimales llegan y se escriben como TEXTO (ADR-006): ninguno pasa por `number`. La
 * cuenta del promedio NO se hace acá (es la función pura de `dominio/costo.ts`); este archivo solo lee, bloquea y escribe.
 */

/** El estado del promedio de un par: costo unitario (6 decimales) y cantidad valorizada (4), ambos en texto decimal exacto. */
export type EstadoDeCostoGuardado = Readonly<{ costoUnitario: string; cantidadValorizada: string }>;

/** El costo congelado de un renglón: `costoUnitario` es `null` si y solo si es `SIN_COSTO` (la base lo exige). */
export type CostoDeRenglonGuardado = Readonly<{
  estado: "SIN_COSTO" | "DEFINITIVO";
  costoUnitario: string | null;
}>;

export type FilaDeCostoDeRenglon = CostoDeRenglonGuardado & Readonly<{ numero: number }>;

export type FiltroDeValorizacion = Readonly<{
  alcance: AlcanceDeSucursales;
  depositoId?: string | undefined;
}>;

/** Lo que hace falta para valorizar la existencia: los pares con costo, y cuántos pares tienen unidades que no lo tienen. */
export type ResumenDeValorizacion = Readonly<{
  /** Una fila por par con promedio: costo y cantidad valorizada, para multiplicar y sumar con dinero exacto. */
  conCosto: readonly EstadoDeCostoGuardado[];
  /** Cuántos pares (depósito, artículo) tienen existencia mayor que su cantidad valorizada. */
  paresConUnidadesSinCosto: number;
}>;

export type UltimaCompraConCosto = Readonly<{
  movimientoId: string;
  numero: number;
  costoUnitario: string;
  hechoEn: Date;
}>;

export interface RepositorioDeCostos {
  /**
   * Lee el estado de esos pares BLOQUEÁNDOLOS (`SELECT … FOR UPDATE`) en el orden canónico `(depósito, artículo)`; los que nunca tuvieron costo no
   * figuran. Se llama DESPUÉS de que los renglones tomaron el saldo: cada transacción que llega acá ya serializó contra quien mueve lo mismo.
   */
  bloquearEstados(
    empresa: EmpresaId,
    pares: readonly Readonly<{ depositoId: string; articuloId: string }>[],
  ): Promise<Map<string, EstadoDeCostoGuardado>>;
  /** Crea el estado de un par que nunca tuvo costo (un segundo `INSERT` del mismo par chocaría con la clave primaria). */
  crearEstado(
    empresa: EmpresaId,
    par: Readonly<{ depositoId: string; articuloId: string }>,
    estado: EstadoDeCostoGuardado,
  ): Promise<void>;
  /** Cambia el estado de un par que ya lo tenía y que esta transacción bloqueó (`bloquearEstados`). */
  cambiarEstado(
    empresa: EmpresaId,
    par: Readonly<{ depositoId: string; articuloId: string }>,
    estado: EstadoDeCostoGuardado,
  ): Promise<void>;
  /** El costo congelado de cada renglón de un movimiento, en la misma transacción que lo creó. */
  guardarCostosDeRenglones(
    empresa: EmpresaId,
    movimientoId: string,
    filas: readonly FilaDeCostoDeRenglon[],
  ): Promise<void>;
  /** Los costos congelados de un movimiento por número de renglón (los renglones anteriores a 0031 no figuran). */
  costosDeRenglones(
    empresa: EmpresaId,
    movimientoId: string,
  ): Promise<Map<number, CostoDeRenglonGuardado>>;
  /** El costo congelado de un renglón, si el depósito de ese renglón está en el alcance; `null` si no existe, no tiene costo cargado o es ajeno. */
  costoDeRenglon(
    empresa: EmpresaId,
    alcance: AlcanceDeSucursales,
    movimientoId: string,
    numero: number,
  ): Promise<CostoDeRenglonGuardado | null>;
  valorizacion(empresa: EmpresaId, filtro: FiltroDeValorizacion): Promise<ResumenDeValorizacion>;
  /**
   * El renglón de entrada por COMPRA con costo definitivo más reciente de ese artículo (por `hecho_en`, luego por registro), sin contar las
   * compras que una anulación revirtió. En los depósitos del alcance.
   */
  ultimaCompraConCosto(
    empresa: EmpresaId,
    alcance: AlcanceDeSucursales,
    articuloId: string,
  ): Promise<UltimaCompraConCosto | null>;
}

const enAlcance = (alcance: AlcanceDeSucursales): boolean =>
  alcance === "TODAS" || alcance.length > 0;

export function crearRepositorioDeCostos(db: Kysely<StockDb>): RepositorioDeCostos {
  return {
    async bloquearEstados(empresa, pares) {
      const estados = new Map<string, EstadoDeCostoGuardado>();
      const unicos = [
        ...new Map(pares.map((p) => [llaveDeSaldo(p.depositoId, p.articuloId), p])).values(),
      ].filter((p) => esUuid(p.depositoId) && esUuid(p.articuloId));
      if (unicos.length === 0) return estados;
      const tuplas = unicos.map((p) => sql`(${p.depositoId}::uuid, ${p.articuloId}::uuid)`);
      const { rows } = await sql<{
        deposito_id: string;
        articulo_id: string;
        costo_unitario: string;
        cantidad_valorizada: string;
      }>`
        select deposito_id, articulo_id, costo_unitario::text as costo_unitario,
               cantidad_valorizada::text as cantidad_valorizada
          from costo_de_articulo
         where empresa_id = ${empresa} and (deposito_id, articulo_id) in (${sql.join(tuplas)})
         order by deposito_id, articulo_id
           for update`.execute(db);
      for (const f of rows) {
        estados.set(llaveDeSaldo(f.deposito_id, f.articulo_id), {
          costoUnitario: f.costo_unitario,
          cantidadValorizada: f.cantidad_valorizada,
        });
      }
      return estados;
    },
    async crearEstado(empresa, par, estado) {
      await db
        .insertInto("costo_de_articulo")
        .values({
          empresa_id: empresa,
          deposito_id: par.depositoId,
          articulo_id: par.articuloId,
          costo_unitario: estado.costoUnitario,
          cantidad_valorizada: estado.cantidadValorizada,
        })
        .execute();
    },
    async cambiarEstado(empresa, par, estado) {
      await db
        .updateTable("costo_de_articulo")
        .set({
          costo_unitario: estado.costoUnitario,
          cantidad_valorizada: estado.cantidadValorizada,
        })
        .where("empresa_id", "=", empresa)
        .where("deposito_id", "=", par.depositoId)
        .where("articulo_id", "=", par.articuloId)
        .execute();
    },
    async guardarCostosDeRenglones(empresa, movimientoId, filas) {
      if (filas.length === 0) return;
      await db
        .insertInto("costo_de_renglon")
        .values(
          filas.map((f) => ({
            empresa_id: empresa,
            movimiento_id: movimientoId,
            numero: f.numero,
            estado: f.estado,
            costo_unitario: f.costoUnitario,
          })),
        )
        .execute();
    },
    async costosDeRenglones(empresa, movimientoId) {
      const costos = new Map<number, CostoDeRenglonGuardado>();
      if (!esUuid(movimientoId)) return costos;
      const { rows } = await sql<{ numero: number; estado: string; costo_unitario: string | null }>`
        select numero, estado, costo_unitario::text as costo_unitario
          from costo_de_renglon
         where empresa_id = ${empresa} and movimiento_id = ${movimientoId}
         order by numero`.execute(db);
      for (const f of rows) {
        costos.set(f.numero, {
          estado: f.estado === "DEFINITIVO" ? "DEFINITIVO" : "SIN_COSTO",
          costoUnitario: f.costo_unitario,
        });
      }
      return costos;
    },
    async costoDeRenglon(empresa, alcance, movimientoId, numero) {
      if (!enAlcance(alcance) || !esUuid(movimientoId) || !Number.isInteger(numero)) return null;
      const { rows } = await sql<{ estado: string; costo_unitario: string | null }>`
        select c.estado, c.costo_unitario::text as costo_unitario
          from costo_de_renglon c
          join renglon_de_movimiento r
            on r.empresa_id = c.empresa_id and r.movimiento_id = c.movimiento_id and r.numero = c.numero
          join deposito d on d.empresa_id = r.empresa_id and d.id = r.deposito_id
         where c.empresa_id = ${empresa} and c.movimiento_id = ${movimientoId} and c.numero = ${numero}
           ${alcance === "TODAS" ? sql`` : sql`and d.sucursal_id in (${sql.join([...alcance])})`}`.execute(
        db,
      );
      const fila = rows[0];
      if (fila === undefined) return null;
      return {
        estado: fila.estado === "DEFINITIVO" ? "DEFINITIVO" : "SIN_COSTO",
        costoUnitario: fila.costo_unitario,
      };
    },
    async valorizacion(empresa, filtro) {
      if (!enAlcance(filtro.alcance)) return { conCosto: [], paresConUnidadesSinCosto: 0 };
      if (filtro.depositoId !== undefined && !esUuid(filtro.depositoId)) {
        return { conCosto: [], paresConUnidadesSinCosto: 0 };
      }
      const donde = sql`
        s.empresa_id = ${empresa}
        ${filtro.alcance === "TODAS" ? sql`` : sql`and d.sucursal_id in (${sql.join([...filtro.alcance])})`}
        ${filtro.depositoId === undefined ? sql`` : sql`and s.deposito_id = ${filtro.depositoId}::uuid`}`;
      const { rows } = await sql<{
        costo_unitario: string | null;
        cantidad_valorizada: string | null;
        sin_costo: boolean;
      }>`
        select c.costo_unitario::text as costo_unitario, c.cantidad_valorizada::text as cantidad_valorizada,
               s.existencia > coalesce(c.cantidad_valorizada, 0) as sin_costo
          from saldo_de_stock s
          join deposito d on d.empresa_id = s.empresa_id and d.id = s.deposito_id
          left join costo_de_articulo c
            on c.empresa_id = s.empresa_id and c.deposito_id = s.deposito_id and c.articulo_id = s.articulo_id
         where ${donde}`.execute(db);
      const conCosto: EstadoDeCostoGuardado[] = [];
      let sinCosto = 0;
      for (const f of rows) {
        if (f.costo_unitario !== null && f.cantidad_valorizada !== null) {
          conCosto.push({
            costoUnitario: f.costo_unitario,
            cantidadValorizada: f.cantidad_valorizada,
          });
        }
        if (f.sin_costo) sinCosto += 1;
      }
      return { conCosto, paresConUnidadesSinCosto: sinCosto };
    },
    async ultimaCompraConCosto(empresa, alcance, articuloId) {
      if (!enAlcance(alcance) || !esUuid(articuloId)) return null;
      const { rows } = await sql<{
        movimiento_id: string;
        numero: number;
        costo_unitario: string;
        hecho_en: Date;
      }>`
        select m.id as movimiento_id, c.numero, c.costo_unitario::text as costo_unitario, m.hecho_en
          from costo_de_renglon c
          join renglon_de_movimiento r
            on r.empresa_id = c.empresa_id and r.movimiento_id = c.movimiento_id and r.numero = c.numero
          join movimiento_de_stock m on m.empresa_id = r.empresa_id and m.id = r.movimiento_id
          join deposito d on d.empresa_id = r.empresa_id and d.id = r.deposito_id
         where c.empresa_id = ${empresa} and r.articulo_id = ${articuloId}::uuid
           and c.estado = 'DEFINITIVO' and m.clase = 'ENTRADA' and m.motivo = 'COMPRA'
           and not exists (
             select 1 from movimiento_de_stock a where a.empresa_id = m.empresa_id and a.anula_a = m.id)
           ${alcance === "TODAS" ? sql`` : sql`and d.sucursal_id in (${sql.join([...alcance])})`}
         order by m.hecho_en desc, m.registrado_en desc, m.id desc
         limit 1`.execute(db);
      const fila = rows[0];
      return fila === undefined
        ? null
        : {
            movimientoId: fila.movimiento_id,
            numero: fila.numero,
            costoUnitario: fila.costo_unitario,
            hechoEn: fila.hecho_en,
          };
    },
  };
}
