import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { ESTADOS_DE_ORDEN, type EstadoDeOrden } from "../dominio/orden-de-compra";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type OrdenGuardada = Readonly<{
  id: string;
  /** `null` mientras es BORRADOR: el número se asigna al pedir. */
  numero: number | null;
  proveedorId: string;
  sucursalDestinoId: string | null;
  /** Fecha civil `YYYY-MM-DD`. */
  entrega: string | null;
  estado: EstadoDeOrden;
  cierreMotivo: "COMPLETA" | "CON_SALDO" | null;
  huella: string;
  creadoPor: string;
  pedidaEn: Date | null;
  version: number;
}>;

export type LineaDeOrdenGuardada = Readonly<{
  numero: number;
  productoId: string;
  cantidadPedida: string;
  precioUnitario: string | null;
  retirada: boolean;
}>;

export type SaldoDeOrden = Readonly<{
  linea: number;
  pedida: string;
  recibida: string;
}>;

export type FiltroDeListaDeOrdenes = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor; una orden sin sucursal de destino solo la ve quien tiene `TODAS` (nunca se asume «todas» por ella). */
  sucursales: "TODAS" | readonly string[];
  proveedorId: string | null;
  estado: EstadoDeOrden | null;
  /** El `creadoTexto` y el id de la última fila de la página anterior. */
  despuesDe: Readonly<{ creadoTexto: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeOrdenes = OrdenGuardada &
  Readonly<{
    /** `creado_en` en texto exacto (con microsegundos): es el cursor de la página. */
    creadoTexto: string;
    /** Las líneas vivas (no retiradas). */
    renglones: number;
  }>;

export type AltaDeOrden = Readonly<{
  proveedorId: string;
  sucursalDestinoId: string | null;
  entrega: string | null;
  clave: string;
  huella: string;
  creadoPor: PersonaId;
}>;

export type NuevaLineaDeOrden = Readonly<{
  numero: number;
  productoId: string;
  cantidadPedida: string;
  precioUnitario: string | null;
}>;

/** Cada cambio de estado lleva sus datos; la base fija el número, los momentos y el motivo del cierre (nunca los manda la aplicación). */
export type CambioDeEstadoDeOrden =
  | Readonly<{ estado: "PEDIDA"; por: PersonaId }>
  | Readonly<{ estado: "CERRADA"; por: PersonaId }>
  | Readonly<{ estado: "ANULADA"; por: PersonaId; motivo: string }>;

/**
 * Las órdenes de compra de N4 (0066): la cabecera, sus líneas (editables solo en BORRADOR; una línea se retira, no se borra) y el saldo recibido por línea, que mantiene la
 * base. La base impone las transiciones, la inmutabilidad desde que se pide y el número; acá solo se lee y se escribe.
 */
export interface RepositorioDeOrdenes {
  porClave(empresa: EmpresaId, clave: string): Promise<OrdenGuardada | null>;
  obtener(empresa: EmpresaId, id: string): Promise<OrdenGuardada | null>;
  /** Con `FOR UPDATE`: pedir, cerrar, anular y editar una misma orden se serializan por acá. */
  bloquear(empresa: EmpresaId, id: string): Promise<OrdenGuardada | null>;
  /** `undefined` si perdió una carrera por la clave (otra transacción ya escribió la misma). */
  insertar(empresa: EmpresaId, alta: AltaDeOrden): Promise<string | undefined>;
  insertarLineas(
    empresa: EmpresaId,
    ordenId: string,
    lineas: readonly NuevaLineaDeOrden[],
  ): Promise<void>;
  lineasDe(empresa: EmpresaId, ordenId: string): Promise<readonly LineaDeOrdenGuardada[]>;
  /** Cambia la cabecera de un BORRADOR si la versión es la esperada; `false` si ya cambió. */
  actualizarCabecera(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: Readonly<{
      proveedorId: string;
      sucursalDestinoId: string | null;
      entrega: string | null;
    }>,
  ): Promise<boolean>;
  /** Cambia la cantidad, el precio y si se retiró de una línea de un BORRADOR. */
  actualizarLinea(
    empresa: EmpresaId,
    ordenId: string,
    numero: number,
    cambios: Readonly<{
      cantidadPedida: string;
      precioUnitario: string | null;
      retirada: boolean;
    }>,
  ): Promise<void>;
  cambiarEstado(empresa: EmpresaId, id: string, cambio: CambioDeEstadoDeOrden): Promise<void>;
  saldosDe(empresa: EmpresaId, ordenId: string): Promise<readonly SaldoDeOrden[]>;
  /** De la más nueva a la más vieja (`creado_en`, `id`), con el filtro y el alcance de sucursales. */
  listar(
    empresa: EmpresaId,
    filtro: FiltroDeListaDeOrdenes,
  ): Promise<readonly FilaDeListaDeOrdenes[]>;
}

const esEstado = (texto: string): texto is EstadoDeOrden =>
  (ESTADOS_DE_ORDEN as readonly string[]).includes(texto);

type FilaDeOrden = {
  id: string;
  numero: number | null;
  proveedor_id: string;
  sucursal_destino_id: string | null;
  entrega: string | null;
  estado: string;
  cierre_motivo: string | null;
  huella: string;
  creado_por: string;
  pedida_en: Date | null;
  version: number;
};

function aOrden(f: FilaDeOrden): OrdenGuardada {
  if (!esEstado(f.estado)) throw new RangeError(`estado de orden desconocido: ${f.estado}`);
  if (
    f.cierre_motivo !== null &&
    f.cierre_motivo !== "COMPLETA" &&
    f.cierre_motivo !== "CON_SALDO"
  ) {
    throw new RangeError(`motivo de cierre desconocido: ${f.cierre_motivo}`);
  }
  return {
    id: f.id,
    numero: f.numero,
    proveedorId: f.proveedor_id,
    sucursalDestinoId: f.sucursal_destino_id,
    entrega: f.entrega,
    estado: f.estado,
    cierreMotivo: f.cierre_motivo,
    huella: f.huella,
    creadoPor: f.creado_por,
    pedidaEn: f.pedida_en,
    version: f.version,
  };
}

export function crearRepositorioDeOrdenes(db: Kysely<ComprasDb>): RepositorioDeOrdenes {
  const seleccion = () =>
    db
      .selectFrom("orden_de_compra")
      .select([
        "id",
        "numero",
        "proveedor_id",
        "sucursal_destino_id",
        sql<string | null>`fecha_de_entrega_prevista::text`.as("entrega"),
        "estado",
        "cierre_motivo",
        "huella",
        "creado_por",
        "pedida_en",
        "version",
      ]);
  return {
    async porClave(empresa, clave) {
      const fila = await seleccion()
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aOrden(fila);
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccion()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aOrden(fila);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccion()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aOrden(fila);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("orden_de_compra")
        .values({
          empresa_id: empresa,
          proveedor_id: alta.proveedorId,
          sucursal_destino_id: alta.sucursalDestinoId,
          fecha_de_entrega_prevista: alta.entrega,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          creado_por: alta.creadoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila?.id;
    },
    async insertarLineas(empresa, ordenId, lineas) {
      if (lineas.length === 0) return;
      await db
        .insertInto("linea_de_orden")
        .values(
          lineas.map((l) => ({
            empresa_id: empresa,
            orden_id: ordenId,
            numero: l.numero,
            producto_id: l.productoId,
            cantidad_pedida: l.cantidadPedida,
            precio_unitario: l.precioUnitario,
          })),
        )
        .execute();
    },
    async lineasDe(empresa, ordenId) {
      if (!esUuid(ordenId)) return [];
      const filas = await db
        .selectFrom("linea_de_orden")
        .select(["numero", "producto_id", "cantidad_pedida", "precio_unitario", "retirada"])
        .where("empresa_id", "=", empresa)
        .where("orden_id", "=", ordenId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        productoId: f.producto_id,
        cantidadPedida: f.cantidad_pedida,
        precioUnitario: f.precio_unitario,
        retirada: f.retirada,
      }));
    },
    async actualizarCabecera(empresa, id, versionEsperada, cambios) {
      const fila = await db
        .updateTable("orden_de_compra")
        .set({
          proveedor_id: cambios.proveedorId,
          sucursal_destino_id: cambios.sucursalDestinoId,
          fecha_de_entrega_prevista: cambios.entrega,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async actualizarLinea(empresa, ordenId, numero, cambios) {
      await db
        .updateTable("linea_de_orden")
        .set({
          cantidad_pedida: cambios.cantidadPedida,
          precio_unitario: cambios.precioUnitario,
          retirada: cambios.retirada,
        })
        .where("empresa_id", "=", empresa)
        .where("orden_id", "=", ordenId)
        .where("numero", "=", numero)
        .execute();
    },
    async cambiarEstado(empresa, id, cambio) {
      const base = db
        .updateTable("orden_de_compra")
        .where("empresa_id", "=", empresa)
        .where("id", "=", id);
      if (cambio.estado === "PEDIDA") {
        await base.set({ estado: "PEDIDA", pedida_por: cambio.por }).execute();
      } else if (cambio.estado === "CERRADA") {
        await base.set({ estado: "CERRADA", cerrada_por: cambio.por }).execute();
      } else {
        await base
          .set({ estado: "ANULADA", anulada_por: cambio.por, motivo_de_anulacion: cambio.motivo })
          .execute();
      }
    },
    async listar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = seleccion()
        .select([
          sql<string>`creado_en::text`.as("creado_texto"),
          sql<number>`(select count(*) from linea_de_orden l where l.empresa_id = orden_de_compra.empresa_id and l.orden_id = orden_de_compra.id and not l.retirada)::int`.as(
            "renglones",
          ),
        ])
        .where("empresa_id", "=", empresa);
      if (filtro.sucursales !== "TODAS") {
        consulta = consulta.where("sucursal_destino_id", "in", [...filtro.sucursales]);
      }
      if (filtro.proveedorId !== null)
        consulta = consulta.where("proveedor_id", "=", filtro.proveedorId);
      if (filtro.estado !== null) consulta = consulta.where("estado", "=", filtro.estado);
      if (filtro.despuesDe !== null) {
        consulta = consulta.where(
          sql<boolean>`(creado_en, id) < (${filtro.despuesDe.creadoTexto}::timestamptz, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy("creado_en", "desc")
        .orderBy("id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        ...aOrden(f),
        creadoTexto: f.creado_texto,
        renglones: f.renglones,
      }));
    },
    async saldosDe(empresa, ordenId) {
      if (!esUuid(ordenId)) return [];
      const filas = await db
        .selectFrom("saldo_de_linea_de_orden")
        .select([
          "linea",
          sql<string>`cantidad_pedida::text`.as("pedida"),
          sql<string>`cantidad_recibida::text`.as("recibida"),
        ])
        .where("empresa_id", "=", empresa)
        .where("orden_id", "=", ordenId)
        .orderBy("linea")
        .execute();
      return filas.map((f) => ({ linea: f.linea, pedida: f.pedida, recibida: f.recibida }));
    },
  };
}
