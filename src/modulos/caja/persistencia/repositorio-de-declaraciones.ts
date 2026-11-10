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
import type { CajaDb } from "./esquema";

export type DeclaracionNueva = Readonly<{
  empresa: EmpresaId;
  sucursalId: SucursalId;
  fechaDeNegocio: FechaCivil;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  secuencia: number;
  importe: Importe;
  declaradoEn: Date;
  declaradoPor: PersonaId;
  claveDeIdempotencia: string;
  huella: string;
}>;

/** Lo mínimo de una declaración hecha con una clave: el id y el contenido (la huella). */
export type DeclaracionPorClave = Readonly<{ id: string; huella: string }>;

export type DeclaracionDeLaJornada = Readonly<{
  id: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  secuencia: number;
  importe: Importe;
  declaradaEn: Date;
  declaradaPor: PersonaId;
}>;

export type ConformeNuevo = Readonly<{
  empresa: EmpresaId;
  sucursalId: SucursalId;
  fechaDeNegocio: FechaCivil;
  conformePor: PersonaId;
  conformeEn: Date;
  claveDeIdempotencia: string;
  huella: string;
}>;

/** El «conforme general» de una jornada: quién y cuándo, con la clave con que se dio (su huella decide un reintento). */
export type ConformeGuardado = Readonly<{
  id: string;
  por: PersonaId;
  en: Date;
  huella: string;
}>;

/**
 * Persistencia de las declaraciones de total y del «conforme general» de la jornada (e3b §4.4): solo inserción (disparadores de la base,
 * también para el dueño). Vigente = la declaración de mayor secuencia del par; el conforme es uno solo por jornada (clave primaria).
 */
export interface RepositorioDeDeclaraciones {
  declaracionPorClave(empresa: EmpresaId, clave: string): Promise<DeclaracionPorClave | null>;
  /** Las secuencias ya usadas por las declaraciones de ese par en la jornada. */
  secuenciasDelPar(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
    medioDePagoId: string,
    cuentaDeCobroId: string | null,
  ): Promise<number[]>;
  insertarDeclaracion(nueva: DeclaracionNueva): Promise<string>;
  /** Todas las declaraciones de la jornada (rige la de mayor secuencia de cada par). Solo lectura. */
  declaracionesDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<DeclaracionDeLaJornada[]>;
  conformePorClave(empresa: EmpresaId, clave: string): Promise<ConformeGuardado | null>;
  conformeDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<ConformeGuardado | null>;
  insertarConforme(nuevo: ConformeNuevo): Promise<string>;
}

export function crearRepositorioDeDeclaraciones(db: Kysely<CajaDb>): RepositorioDeDeclaraciones {
  const delPar = (
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
    medio: string,
    cuenta: string | null,
  ) => {
    const consulta = db
      .selectFrom("declaracion_de_total")
      .where("empresa_id", "=", empresa)
      .where("sucursal_id", "=", sucursal)
      .where(sql<boolean>`fecha_negocio = ${fecha}::date`)
      .where("medio_de_pago_id", "=", medio);
    return cuenta === null
      ? consulta.where("cuenta_de_cobro_id", "is", null)
      : consulta.where("cuenta_de_cobro_id", "=", cuenta);
  };
  const aConforme = (fila: {
    id: string;
    conforme_por: string;
    conforme_en: Date;
    huella: string;
  }): ConformeGuardado => ({
    id: fila.id,
    por: personaId(fila.conforme_por),
    en: fila.conforme_en,
    huella: fila.huella,
  });
  const conformes = () =>
    db.selectFrom("conforme_de_jornada").select(["id", "conforme_por", "conforme_en", "huella"]);

  return {
    async declaracionPorClave(empresa, clave) {
      const fila = await db
        .selectFrom("declaracion_de_total")
        .select(["id", "huella"])
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : { id: fila.id, huella: fila.huella };
    },

    async secuenciasDelPar(empresa, sucursal, fecha, medioDePagoId, cuentaDeCobroId) {
      const filas = await delPar(empresa, sucursal, fecha, medioDePagoId, cuentaDeCobroId)
        .select("secuencia")
        .execute();
      return filas.map((f) => f.secuencia);
    },

    async insertarDeclaracion(nueva) {
      const fila = await db
        .insertInto("declaracion_de_total")
        .values({
          empresa_id: nueva.empresa,
          sucursal_id: nueva.sucursalId,
          fecha_negocio: nueva.fechaDeNegocio,
          medio_de_pago_id: nueva.medioDePagoId,
          cuenta_de_cobro_id: nueva.cuentaDeCobroId,
          secuencia: nueva.secuencia,
          moneda: nueva.importe.moneda,
          importe: importeATexto(nueva.importe),
          declarado_en: nueva.declaradoEn,
          declarado_por: nueva.declaradoPor,
          clave_idempotencia: nueva.claveDeIdempotencia,
          huella: nueva.huella,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async declaracionesDeLaJornada(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("declaracion_de_total")
        .select([
          "id",
          "medio_de_pago_id",
          "cuenta_de_cobro_id",
          "secuencia",
          sql<string>`importe::text`.as("importe"),
          "declarado_en",
          "declarado_por",
        ])
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where(sql<boolean>`fecha_negocio = ${fecha}::date`)
        .orderBy("medio_de_pago_id")
        .orderBy("cuenta_de_cobro_id")
        .orderBy("secuencia")
        .execute();
      return filas.map((f) => ({
        id: f.id,
        medioDePagoId: f.medio_de_pago_id,
        cuentaDeCobroId: f.cuenta_de_cobro_id,
        secuencia: f.secuencia,
        importe: importeDesdeTexto(ARS, f.importe),
        declaradaEn: f.declarado_en,
        declaradaPor: personaId(f.declarado_por),
      }));
    },

    async conformePorClave(empresa, clave) {
      const fila = await conformes()
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aConforme(fila);
    },

    async conformeDeLaJornada(empresa, sucursal, fecha) {
      const fila = await conformes()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where(sql<boolean>`fecha_negocio = ${fecha}::date`)
        .executeTakeFirst();
      return fila === undefined ? null : aConforme(fila);
    },

    async insertarConforme(nuevo) {
      const fila = await db
        .insertInto("conforme_de_jornada")
        .values({
          empresa_id: nuevo.empresa,
          sucursal_id: nuevo.sucursalId,
          fecha_negocio: nuevo.fechaDeNegocio,
          conforme_por: nuevo.conformePor,
          conforme_en: nuevo.conformeEn,
          clave_idempotencia: nuevo.claveDeIdempotencia,
          huella: nuevo.huella,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },
  };
}
