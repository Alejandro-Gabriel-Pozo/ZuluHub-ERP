import { sql, type Kysely, type Selectable } from "kysely";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { OpcionId, PrecioDeVentaId, ProductoId } from "../dominio/identificadores";
import type { FilaDePrecio } from "../dominio/modelo";
import type { CatalogoDb } from "./esquema";
import { aFilaDePrecio, FORMA_DE_UUID } from "./filas";

export type NuevoPrecio = Readonly<{
  /** El que manda la aplicación (idempotencia del cambio); sin él lo genera la base (lo que escribe `cambiarFormaDeVenta`). */
  id?: PrecioDeVentaId;
  productoId: ProductoId;
  opcionId: OpcionId | null;
  sucursalId: SucursalId | null;
  /** Texto decimal exacto (hasta 6 decimales) o `null` (ver K6). */
  precio: string | null;
  /** La forma de venta del producto en este momento: la copia que guarda la fila (166). */
  unidadId: string;
  pasoMinimo: string;
  /** `ahora` del contexto. La fila rige desde el mayor entre esto y 1 µs después de la última del mismo dueño y alcance (K5). */
  ahora: Date;
  cargadoPor: PersonaId | null;
}>;

type Fila = Selectable<CatalogoDb["precio_de_venta"]>;

export interface RepositorioDePrecios {
  obtener(empresa: EmpresaId, id: string): Promise<FilaDePrecio | null>;
  /** La última fila (por `vigente_desde`) de ESE dueño y alcance, sin mirar la fecha: con la que se compara `precioIdEsperado`. */
  ultimaDelAlcance(
    empresa: EmpresaId,
    producto: ProductoId,
    opcion: OpcionId | null,
    sucursal: SucursalId | null,
  ): Promise<FilaDePrecio | null>;
  /** El ÚNICO lector: `precio_vigente` de la base (la sucursal si tiene precio propio no nulo; si no, la empresa). */
  vigente(
    empresa: EmpresaId,
    producto: string,
    opcion: string | null,
    sucursal: string | null,
    en: Date,
  ): Promise<FilaDePrecio | null>;
  /** La última fila de cada (opción, sucursal) del producto: lo que `cambiarFormaDeVenta` convierte. */
  ultimasPorAlcance(empresa: EmpresaId, producto: ProductoId): Promise<FilaDePrecio[]>;
  /** El historial completo del producto (todas las filas), de la más nueva a la más vieja, con quién las cargó. */
  historial(
    empresa: EmpresaId,
    producto: ProductoId,
  ): Promise<Array<FilaDePrecio & Readonly<{ cargadoPor: string | null }>>>;
  /**
   * Inserta la fila (`ON CONFLICT (id) DO NOTHING`) y la devuelve; `null` si ya había una con ese `id`. Si la que ya está la escribió una
   * transacción concurrente que esta no ve, la base aborta por serialización y el motor repite el pedido, que entonces la ve como repetición.
   */
  insertar(empresa: EmpresaId, nuevo: NuevoPrecio): Promise<FilaDePrecio | null>;
}

export function crearRepositorioDePrecios(db: Kysely<CatalogoDb>): RepositorioDePrecios {
  const alcance = (opcion: string | null, sucursal: string | null) =>
    sql<boolean>`opcion_id is not distinct from ${opcion}::uuid and sucursal_id is not distinct from ${sucursal}::uuid`;
  return {
    async obtener(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const f = await db
        .selectFrom("precio_de_venta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined ? null : aFilaDePrecio(f);
    },

    async ultimaDelAlcance(empresa, producto, opcion, sucursal) {
      const f = await db
        .selectFrom("precio_de_venta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", producto)
        .where(alcance(opcion, sucursal))
        .orderBy("vigente_desde", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      return f === undefined ? null : aFilaDePrecio(f);
    },

    async vigente(empresa, producto, opcion, sucursal, en) {
      if (!FORMA_DE_UUID.test(producto)) return null;
      const r = await sql<Fila & { id: string | null }>`
        select * from precio_vigente(${empresa}::uuid, ${producto}::uuid, ${opcion}::uuid, ${sucursal}::uuid, ${en}::timestamptz)`.execute(
        db,
      );
      const f = r.rows[0];
      // Sin ninguna fila la función devuelve NULL: llega como una fila de nulos.
      return f === undefined || f.id === null ? null : aFilaDePrecio(f);
    },

    async ultimasPorAlcance(empresa, producto) {
      const r = await sql<Fila>`
        select distinct on (opcion_id, sucursal_id) *
          from precio_de_venta
         where empresa_id = ${empresa}::uuid and producto_id = ${producto}::uuid
         order by opcion_id nulls first, sucursal_id nulls first, vigente_desde desc, id desc`.execute(
        db,
      );
      return r.rows.map(aFilaDePrecio);
    },

    async historial(empresa, producto) {
      const filas = await db
        .selectFrom("precio_de_venta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", producto)
        .orderBy("vigente_desde", "desc")
        .orderBy("id", "desc")
        .execute();
      return filas.map((f) => ({ ...aFilaDePrecio(f), cargadoPor: f.cargado_por }));
    },

    async insertar(empresa, n) {
      const fila = await db
        .insertInto("precio_de_venta")
        .values({
          ...(n.id === undefined ? {} : { id: n.id }),
          empresa_id: empresa,
          producto_id: n.productoId,
          opcion_id: n.opcionId,
          sucursal_id: n.sucursalId,
          precio: n.precio,
          unidad_id: n.unidadId,
          paso_minimo: n.pasoMinimo,
          // K5: el mayor entre `ahora` y 1 µs después de la última fila del mismo dueño y alcance. El producto está bloqueado: nadie
          // inserta en este alcance entre esta lectura y la escritura.
          vigente_desde: sql<Date>`greatest(${n.ahora}::timestamptz, coalesce(
            (select max(p.vigente_desde) + interval '1 microsecond' from precio_de_venta p
              where p.empresa_id = ${empresa}::uuid and p.producto_id = ${n.productoId}::uuid
                and p.opcion_id is not distinct from ${n.opcionId}::uuid and p.sucursal_id is not distinct from ${n.sucursalId}::uuid),
            ${n.ahora}::timestamptz))`,
          cargado_por: n.cargadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aFilaDePrecio(fila);
    },
  };
}
