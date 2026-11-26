import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import type { EstadoDeComprobante } from "./repositorio-de-comprobantes";
import { esUuid } from "./filas";

export type FiltroDeListaDeNotas = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor: la nota no tiene sucursal, pero quien no tiene alcance sobre ninguna no ve nada. */
  sucursales: "TODAS" | readonly string[];
  facturaId: string | null;
  proveedorId: string | null;
  estado: EstadoDeComprobante | null;
  /** La `fechaNegocio` y el id de la última fila de la página anterior. */
  despuesDe: Readonly<{ fechaNegocio: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeNotas = Readonly<{
  id: string;
  proveedorId: string;
  /** La factura que corrige. */
  facturaId: string;
  tipo: string;
  puntoDeVenta: number;
  numero: number;
  fechaNegocio: string;
  /** Lo que dice el papel de la nota. */
  total: string;
  estado: EstadoDeComprobante;
}>;

/**
 * Las notas de crédito del proveedor (0085): lo que se lee de ellas. La nota ES un comprobante de la clase NOTA_DE_CREDITO (se escribe con `RepositorioDeComprobantes`); acá solo se
 * listan y se suma lo acreditado de una factura. Lo acreditado es derivado y la base lo protege (la factura se bloquea al cargar una nota): nunca es un número editable.
 */
export interface RepositorioDeNotasDeCredito {
  /** De la más nueva a la más vieja (`fecha_negocio`, `id`), con el filtro y el alcance. */
  listar(empresa: EmpresaId, filtro: FiltroDeListaDeNotas): Promise<readonly FilaDeListaDeNotas[]>;
  /** La suma de lo que dicen las notas de CRÉDITO vigentes de una factura (las de débito no restan: se pagan aparte) (texto decimal con dos decimales). */
  acreditadoDe(empresa: EmpresaId, facturaId: string): Promise<string>;
}

export function crearRepositorioDeNotasDeCredito(
  db: Kysely<ComprasDb>,
): RepositorioDeNotasDeCredito {
  return {
    async listar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("comprobante_de_proveedor as c")
        .select([
          "c.id",
          "c.proveedor_id",
          "c.comprobante_asociado_id",
          "c.tipo",
          "c.punto_de_venta",
          "c.numero",
          "c.estado",
          sql<string>`c.fecha_negocio::text`.as("fecha_negocio"),
          sql<string>`c.total_segun_factura::text`.as("total"),
        ])
        .where("c.empresa_id", "=", empresa)
        .where("c.clase", "=", "NOTA_DE_CREDITO");
      if (filtro.facturaId !== null) {
        consulta = consulta.where("c.comprobante_asociado_id", "=", filtro.facturaId);
      }
      if (filtro.proveedorId !== null) {
        consulta = consulta.where("c.proveedor_id", "=", filtro.proveedorId);
      }
      if (filtro.estado !== null) consulta = consulta.where("c.estado", "=", filtro.estado);
      if (filtro.despuesDe !== null) {
        const c = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(c.fecha_negocio, c.id) < (${c.fechaNegocio}::date, ${c.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy(sql`c.fecha_negocio`, "desc")
        .orderBy("c.id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => {
        if (
          f.comprobante_asociado_id === null ||
          f.tipo === null ||
          f.punto_de_venta === null ||
          f.numero === null ||
          (f.estado !== "REGISTRADO" && f.estado !== "ANULADO")
        ) {
          throw new RangeError("una nota de crédito guardada no tiene todos sus datos");
        }
        return {
          id: f.id,
          proveedorId: f.proveedor_id,
          facturaId: f.comprobante_asociado_id,
          tipo: f.tipo,
          puntoDeVenta: f.punto_de_venta,
          numero: f.numero,
          fechaNegocio: f.fecha_negocio,
          total: f.total,
          estado: f.estado,
        };
      });
    },
    async acreditadoDe(empresa, facturaId) {
      if (!esUuid(facturaId)) return "0.00";
      const fila = await db
        .selectFrom("comprobante_de_proveedor as c")
        .select(
          sql<string>`coalesce(sum(c.total_segun_factura), 0)::numeric(18,2)::text`.as("total"),
        )
        .where("c.empresa_id", "=", empresa)
        .where("c.comprobante_asociado_id", "=", facturaId)
        .where("c.clase", "=", "NOTA_DE_CREDITO")
        .where("c.estado", "<>", "ANULADO")
        .executeTakeFirst();
      return fila?.total ?? "0.00";
    },
  };
}
