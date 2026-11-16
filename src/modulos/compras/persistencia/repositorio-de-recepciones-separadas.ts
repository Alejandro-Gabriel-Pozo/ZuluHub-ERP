import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ControlDeLinea } from "../dominio/control-de-recepcion";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";
import {
  aRecepcion,
  COLUMNAS_DE_RECEPCION,
  type EstadoDeRecepcion,
  type FilaDeRecepcion,
  type Recepcion,
} from "./repositorio-de-recepciones";

/** Con N3 (0063) una recepción puede estar PENDIENTE de confirmar: solo la ven las operaciones de N3; N1 y N2 nunca la leen (sus lecturas la excluyen). */
export type EstadoDeRecepcionSeparada = EstadoDeRecepcion | "PENDIENTE";

export type RecepcionSeparada = Omit<Recepcion, "estado"> &
  Readonly<{
    estado: EstadoDeRecepcionSeparada;
    confirmadaPor: string | null;
    confirmadaEn: Date | null;
  }>;

/**
 * Las recepciones de N3 y N4 (E9 §3.8): lo mismo que las de N1 y N2 pero viendo también las PENDIENTES, más el control de la mercadería por línea. Las lecturas son de
 * la misma tabla; N1 y N2 no pasan por acá.
 */
export interface RepositorioDeRecepcionesSeparadas {
  /** Como `porClave` de N1 y N2, pero ve también las PENDIENTES. */
  porClaveSeparada(empresa: EmpresaId, clave: string): Promise<RecepcionSeparada | null>;
  /** Como `porRemito`, pero ve también las PENDIENTES. */
  porRemitoSeparado(
    empresa: EmpresaId,
    proveedorId: string,
    puntoDeVenta: number,
    numero: number,
  ): Promise<RecepcionSeparada | null>;
  obtenerSeparada(empresa: EmpresaId, id: string): Promise<RecepcionSeparada | null>;
  /** Con `FOR UPDATE`: confirmar y anular una pendiente se serializan por acá. */
  bloquearSeparada(empresa: EmpresaId, id: string): Promise<RecepcionSeparada | null>;
  /** El control de la mercadería por línea (misma transacción que la recepción). */
  insertarControles(
    empresa: EmpresaId,
    recepcionId: string,
    controles: readonly ControlDeLinea[],
  ): Promise<void>;
  controlesDe(empresa: EmpresaId, recepcionId: string): Promise<readonly ControlDeLinea[]>;
}

export function aRecepcionSeparada(f: FilaDeRecepcion): RecepcionSeparada {
  if (f.estado !== "PENDIENTE" && f.estado !== "CONFIRMADA" && f.estado !== "ANULADA") {
    throw new RangeError(`estado de recepción desconocido: ${f.estado}`);
  }
  // `aRecepcion` solo conoce los dos estados de N1 y N2: se lo lee como CONFIRMADA y se pone el verdadero.
  const base = aRecepcion({ ...f, estado: f.estado === "PENDIENTE" ? "CONFIRMADA" : f.estado });
  return {
    ...base,
    estado: f.estado,
    confirmadaPor: f.confirmada_por,
    confirmadaEn: f.confirmada_en,
  };
}

function aControl(f: {
  linea: number;
  condicion: string;
  observacion: string | null;
  cantidad_segun_remito: string | null;
  temperatura_en_c: string | null;
}): ControlDeLinea {
  if (
    f.condicion !== "CONFORME" &&
    f.condicion !== "CON_OBSERVACIONES" &&
    f.condicion !== "RECHAZADA"
  ) {
    throw new RangeError(`condición de control desconocida: ${f.condicion}`);
  }
  return {
    linea: f.linea,
    condicion: f.condicion,
    observacion: f.observacion,
    cantidadSegunRemito: f.cantidad_segun_remito,
    temperaturaEnC: f.temperatura_en_c,
  };
}

export function crearRepositorioDeRecepcionesSeparadas(
  db: Kysely<ComprasDb>,
): RepositorioDeRecepcionesSeparadas {
  async function leerSeparada(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("recepcion")
      .select(COLUMNAS_DE_RECEPCION)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aRecepcionSeparada(fila);
  }
  return {
    async porClaveSeparada(empresa, clave) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS_DE_RECEPCION)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcionSeparada(fila);
    },
    async porRemitoSeparado(empresa, proveedorId, puntoDeVenta, numero) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS_DE_RECEPCION)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .where("remito_punto_de_venta", "=", puntoDeVenta)
        .where("remito_numero", "=", numero)
        .where("estado", "in", ["PENDIENTE", "CONFIRMADA"])
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcionSeparada(fila);
    },
    obtenerSeparada: (empresa, id) => leerSeparada(empresa, id, false),
    bloquearSeparada: (empresa, id) => leerSeparada(empresa, id, true),
    async insertarControles(empresa, recepcionId, controles) {
      if (controles.length === 0) return;
      await db
        .insertInto("inspeccion_de_linea_de_recepcion")
        .values(
          controles.map((c) => ({
            empresa_id: empresa,
            recepcion_id: recepcionId,
            linea: c.linea,
            cantidad_segun_remito: c.cantidadSegunRemito,
            condicion: c.condicion,
            observacion: c.observacion,
            temperatura_en_c: c.temperaturaEnC,
          })),
        )
        .execute();
    },
    async controlesDe(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("inspeccion_de_linea_de_recepcion")
        .select([
          "linea",
          "condicion",
          "observacion",
          sql<string | null>`cantidad_segun_remito::text`.as("cantidad_segun_remito"),
          sql<string | null>`temperatura_en_c::text`.as("temperatura_en_c"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("linea")
        .execute();
      return filas.map((f) => aControl(f));
    },
  };
}
