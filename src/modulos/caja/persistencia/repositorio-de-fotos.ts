import { sql, type Kysely } from "kysely";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { EstadoDeConteo } from "../estados";
import type { CajaDb } from "./esquema";
import type { MedioYCuentaConNombre } from "./base-de-la-jornada";

/** Una línea de la conciliación por medio que caja congela al cerrar la jornada (e3b §4.4). */
export type LineaDeFoto = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  registrado: Importe;
  correcciones: Importe;
  declarado: Importe | null;
  estado: EstadoDeConteo;
  conformePor: string | null;
  conformeEn: Date | null;
  explicacion: string | null;
}>;

/** Un origen cuyo cobrado difiere del total vigente del ticket (e3b §4.6). */
export type OrigenDeFoto = Readonly<{
  origenTipo: string;
  origenId: string;
  ticketId: string;
  cobrado: Importe;
  totalDelTicket: Importe;
  explicacion: string | null;
}>;

export type FotoDeCaja = Readonly<{
  empresa: EmpresaId;
  sucursal: SucursalId;
  fecha: FechaCivil;
  congeladoEn: Date;
  congeladoPor: PersonaId;
  lineas: readonly LineaDeFoto[];
  origenes: readonly OrigenDeFoto[];
}>;

export type LineaGuardada = MedioYCuentaConNombre &
  Readonly<{
    registrado: Importe;
    correcciones: Importe;
    declarado: Importe | null;
    estado: EstadoDeConteo;
    conformePor: PersonaId | null;
    conformeEn: Date | null;
    /** La calcula la base: `null` si `CONFORME` o `SIN_DATO`. */
    diferencia: Importe | null;
    explicacion: string | null;
  }>;

export type OrigenGuardado = Readonly<{
  origenTipo: string;
  origenId: string;
  ticketId: string;
  cobrado: Importe;
  totalDelTicket: Importe;
  diferencia: Importe;
  explicacion: string | null;
}>;

/**
 * Persistencia de la foto que caja congela al cerrar la jornada: la cabecera, una línea por (medio, cuenta) y los orígenes con diferencia
 * contra el ticket. Solo inserción y SOLO en la transacción que cierra la jornada (disparadores de la base); al confirmar la base recalcula
 * todo y rechaza una foto que no cuadra (`caja_conciliacion_no_cuadra`, `caja_conciliacion_incompleta`). Nada de esto se actualiza ni se
 * borra, tampoco para el dueño de la base.
 */
export interface RepositorioDeFotos {
  /** La cabecera primero y después las líneas (la base exige ese orden y la misma transacción). */
  guardar(foto: FotoDeCaja): Promise<void>;
  /** ¿Caja congeló esta jornada? Solo hay foto de una jornada cerrada. */
  existe(empresa: EmpresaId, sucursal: SucursalId, fecha: FechaCivil): Promise<boolean>;
  lineas(empresa: EmpresaId, sucursal: SucursalId, fecha: FechaCivil): Promise<LineaGuardada[]>;
  origenes(empresa: EmpresaId, sucursal: SucursalId, fecha: FechaCivil): Promise<OrigenGuardado[]>;
}

export function crearRepositorioDeFotos(db: Kysely<CajaDb>): RepositorioDeFotos {
  return {
    async guardar(foto) {
      await db
        .insertInto("cierre_de_caja_de_jornada")
        .values({
          empresa_id: foto.empresa,
          sucursal_id: foto.sucursal,
          fecha_negocio: foto.fecha,
          congelado_en: foto.congeladoEn,
          congelado_por: foto.congeladoPor,
        })
        .execute();
      if (foto.lineas.length > 0) {
        await db
          .insertInto("conciliacion_de_jornada")
          .values(
            foto.lineas.map((l) => ({
              empresa_id: foto.empresa,
              sucursal_id: foto.sucursal,
              fecha_negocio: foto.fecha,
              medio_de_pago_id: l.medioDePagoId,
              cuenta_de_cobro_id: l.cuentaDeCobroId,
              registrado: importeATexto(l.registrado),
              correcciones: importeATexto(l.correcciones),
              declarado: l.declarado === null ? null : importeATexto(l.declarado),
              estado_de_conteo: l.estado,
              conforme_por: l.conformePor,
              conforme_en: l.conformeEn,
              explicacion: l.explicacion,
            })),
          )
          .execute();
      }
      if (foto.origenes.length > 0) {
        await db
          .insertInto("conciliacion_de_cobro_por_origen")
          .values(
            foto.origenes.map((o) => ({
              empresa_id: foto.empresa,
              sucursal_id: foto.sucursal,
              fecha_negocio: foto.fecha,
              origen_tipo: o.origenTipo,
              origen_id: o.origenId,
              ticket_id: o.ticketId,
              cobrado: importeATexto(o.cobrado),
              total_del_ticket: importeATexto(o.totalDelTicket),
              explicacion: o.explicacion,
            })),
          )
          .execute();
      }
    },

    async existe(empresa, sucursal, fecha) {
      const fila = await db
        .selectFrom("cierre_de_caja_de_jornada")
        .select("fecha_negocio")
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where(sql<boolean>`fecha_negocio = ${fecha}::date`)
        .executeTakeFirst();
      return fila !== undefined;
    },

    async lineas(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("conciliacion_de_jornada as l")
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "l.medio_de_pago_id")
            .onRef("md.empresa_id", "=", "l.empresa_id"),
        )
        .leftJoin("cuenta_de_cobro as cu", (unir) =>
          unir
            .onRef("cu.id", "=", "l.cuenta_de_cobro_id")
            .onRef("cu.empresa_id", "=", "l.empresa_id"),
        )
        .select([
          "l.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "l.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          sql<string>`l.registrado::text`.as("registrado"),
          sql<string>`l.correcciones::text`.as("correcciones"),
          sql<string | null>`l.declarado::text`.as("declarado"),
          "l.estado_de_conteo as estado_de_conteo",
          "l.conforme_por as conforme_por",
          "l.conforme_en as conforme_en",
          sql<string | null>`l.diferencia::text`.as("diferencia"),
          "l.explicacion as explicacion",
        ])
        .where("l.empresa_id", "=", empresa)
        .where("l.sucursal_id", "=", sucursal)
        .where(sql<boolean>`l.fecha_negocio = ${fecha}::date`)
        .orderBy("l.medio_de_pago_id")
        .orderBy("l.cuenta_de_cobro_id")
        .execute();
      return filas.map((f) => ({
        medioDePagoId: f.medio_de_pago_id,
        medioTipo: f.medio_tipo,
        medioNombre: f.medio_nombre,
        cuentaDeCobroId: f.cuenta_de_cobro_id,
        cuentaNombre: f.cuenta_nombre,
        registrado: importeDesdeTexto(ARS, f.registrado),
        correcciones: importeDesdeTexto(ARS, f.correcciones),
        declarado: f.declarado === null ? null : importeDesdeTexto(ARS, f.declarado),
        estado: f.estado_de_conteo,
        conformePor: f.conforme_por === null ? null : personaId(f.conforme_por),
        conformeEn: f.conforme_en,
        diferencia: f.diferencia === null ? null : importeDesdeTexto(ARS, f.diferencia),
        explicacion: f.explicacion,
      }));
    },

    async origenes(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("conciliacion_de_cobro_por_origen")
        .select([
          "origen_tipo",
          "origen_id",
          "ticket_id",
          sql<string>`cobrado::text`.as("cobrado"),
          sql<string>`total_del_ticket::text`.as("total_del_ticket"),
          sql<string>`diferencia::text`.as("diferencia"),
          "explicacion",
        ])
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where(sql<boolean>`fecha_negocio = ${fecha}::date`)
        .orderBy("origen_tipo")
        .orderBy("origen_id")
        .execute();
      return filas.map((f) => ({
        origenTipo: f.origen_tipo,
        origenId: f.origen_id,
        ticketId: f.ticket_id,
        cobrado: importeDesdeTexto(ARS, f.cobrado),
        totalDelTicket: importeDesdeTexto(ARS, f.total_del_ticket),
        diferencia: importeDesdeTexto(ARS, f.diferencia),
        explicacion: f.explicacion,
      }));
    },
  };
}
