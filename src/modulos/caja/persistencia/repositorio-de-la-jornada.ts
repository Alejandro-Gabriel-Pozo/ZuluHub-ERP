import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ClaseDeMovimiento } from "../estados";
import {
  comoMedio,
  movimientosDeLaJornada,
  type MedioYCuentaConNombre,
} from "./base-de-la-jornada";
import type { CajaDb } from "./esquema";
import type { MovimientoParaSumar } from "./repositorio-de-movimientos";

/**
 * Las LECTURAS de caja que cruzan todas las sesiones de una jornada `(sucursal, fecha de negocio)`: lo que el cierre del día revisa y lo
 * que muestran sus consultas (e3b §4.5). Todas son solo lectura, sin caché, con la empresa en cada filtro (además de la RLS) y los importes
 * como texto decimal que se lee a `bigint` de centavos: nunca `number`. La fecha es la de la SESIÓN (el sello), no la de hoy.
 */

/** Una línea del arqueo guardado al cerrar una sesión de la jornada. */
export type ArqueoDeLaJornada = Readonly<{
  sesionId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  conforme: boolean;
  contado: Importe | null;
  /** contado − esperado; `null` si la línea es conforme. */
  diferencia: Importe | null;
  conformePor: PersonaId | null;
  conformeEn: Date | null;
}>;

/** Un ajuste, con la jornada que corrige y la de la sesión donde cayó. */
export type AjusteConEnlace = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    sesionId: string;
    importe: Importe;
    motivo: string;
    /** La jornada ya cerrada que explica. */
    corrigeJornada: FechaCivil;
    /** La fecha de negocio de la sesión de hoy donde se registró. */
    fechaDeNegocio: FechaCivil;
    registradoEn: Date;
    registradoPor: PersonaId;
  }>;

export type MovimientoManualDeLaJornada = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    sesionId: string;
    clase: ClaseDeMovimiento;
    importe: Importe;
    motivo: string | null;
    anulaA: string | null;
    corrigeJornada: FechaCivil | null;
    registradoEn: Date;
    registradoPor: PersonaId;
  }>;

export type CobradoDeUnOrigenEnLaJornada = Readonly<{
  origen: Readonly<{ tipo: string; id: string }>;
  /** Σ de los cobros de ese origen en la jornada: no cambia con una corrección de medio. */
  cobrado: Importe;
  cobros: number;
}>;

export type CursorDeOrigenes = Readonly<{ tipo: string; id: string }>;

/** Lo cobrado en la jornada por el medio VIGENTE de cada cobro (tras las correcciones de medio). */
export type CobradoPorMedioVigente = Readonly<{
  medioDePagoId: string;
  cobros: number;
  importe: Importe;
}>;

export interface RepositorioDeLaJornada {
  /** Σ de los movimientos de las sesiones de la jornada por (medio, cuenta): lo REGISTRADO de la conciliación. Un par con suma cero también sale. */
  registradoPorPar(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<MovimientoParaSumar[]>;
  /** Las líneas de arqueo de todas las sesiones de la jornada. */
  arqueosDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<ArqueoDeLaJornada[]>;
  /** Los ajustes registrados en las sesiones de ESTA jornada que corrigen una jornada ya cerrada. */
  ajustesQueCorrigen(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<AjusteConEnlace[]>;
  /** Los ajustes (de sesiones posteriores) que citan ESTA jornada como la que corrigen. */
  ajustesPosteriores(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<AjusteConEnlace[]>;
  /** Ingresos, egresos, ajustes y anulaciones de la jornada, por `(registrado_en, id)`. Pide `limite` filas. */
  movimientosManuales(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
    limite: number,
  ): Promise<MovimientoManualDeLaJornada[]>;
  /** Los cobros de la jornada (cantidad e importe) agrupados por el medio vigente de cada uno; ordenados por medio. */
  cobradoPorMedioVigente(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<CobradoPorMedioVigente[]>;
  /** Lo cobrado por origen en la jornada, por `(tipo, id)` del origen. `limite = null`: todos. */
  cobradoPorOrigen(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
    despuesDe: CursorDeOrigenes | null,
    limite: number | null,
  ): Promise<CobradoDeUnOrigenEnLaJornada[]>;
}

const importeONulo = (valor: string | null): Importe | null =>
  valor === null ? null : importeDesdeTexto(ARS, valor);

export function crearRepositorioDeLaJornada(db: Kysely<CajaDb>): RepositorioDeLaJornada {
  const ajustesDe = async (
    consulta: ReturnType<typeof movimientosDeLaJornada>,
  ): Promise<AjusteConEnlace[]> => {
    const filas = await consulta
      .select([
        "m.id as id",
        "m.sesion_id as sesion_id",
        "m.medio_de_pago_id as medio_de_pago_id",
        "md.tipo as medio_tipo",
        "md.nombre as medio_nombre",
        "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
        "cu.nombre as cuenta_nombre",
        sql<string>`m.importe::text`.as("importe"),
        "m.motivo as motivo",
        sql<string>`m.corrige_jornada::text`.as("corrige_jornada"),
        sql<string>`s.fecha_negocio::text`.as("fecha_negocio"),
        "m.registrado_en as registrado_en",
        "m.registrado_por as registrado_por",
      ])
      .where("m.clase", "=", "AJUSTE")
      .orderBy("m.registrado_en")
      .orderBy("m.id")
      .execute();
    return filas.map((f) => ({
      ...comoMedio(f),
      id: f.id,
      sesionId: f.sesion_id,
      importe: importeDesdeTexto(ARS, f.importe),
      motivo: f.motivo ?? "",
      corrigeJornada: f.corrige_jornada as FechaCivil,
      fechaDeNegocio: f.fecha_negocio as FechaCivil,
      registradoEn: f.registrado_en,
      registradoPor: personaId(f.registrado_por),
    }));
  };

  return {
    async registradoPorPar(empresa, sucursal, fecha) {
      const filas = await movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .select([
          "m.medio_de_pago_id as medio_de_pago_id",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          sql<string>`sum(m.importe)::text`.as("importe"),
        ])
        .groupBy(["m.medio_de_pago_id", "m.cuenta_de_cobro_id"])
        .execute();
      return filas.map((f) => ({
        medioDePagoId: f.medio_de_pago_id,
        cuentaDeCobroId: f.cuenta_de_cobro_id,
        importe: importeDesdeTexto(ARS, f.importe),
      }));
    },

    async arqueosDeLaJornada(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("arqueo_caja as a")
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "a.sesion_id").onRef("s.empresa_id", "=", "a.empresa_id"),
        )
        .innerJoin("caja as c", (unir) =>
          unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
        )
        .select([
          "a.sesion_id as sesion_id",
          "a.medio_de_pago_id as medio_de_pago_id",
          "a.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "a.conforme as conforme",
          sql<string | null>`a.contado::text`.as("contado"),
          sql<string | null>`a.diferencia::text`.as("diferencia"),
          "a.conforme_por as conforme_por",
          "a.conforme_en as conforme_en",
        ])
        .where("a.empresa_id", "=", empresa)
        .where("c.sucursal_id", "=", sucursal)
        .where(sql<boolean>`s.fecha_negocio = ${fecha}::date`)
        .orderBy("a.sesion_id")
        .orderBy("a.medio_de_pago_id")
        .orderBy("a.cuenta_de_cobro_id")
        .execute();
      return filas.map((f) => ({
        sesionId: f.sesion_id,
        medioDePagoId: f.medio_de_pago_id,
        cuentaDeCobroId: f.cuenta_de_cobro_id,
        conforme: f.conforme,
        contado: importeONulo(f.contado),
        diferencia: importeONulo(f.diferencia),
        conformePor: f.conforme_por === null ? null : personaId(f.conforme_por),
        conformeEn: f.conforme_en,
      }));
    },

    ajustesQueCorrigen(empresa, sucursal, fecha) {
      return ajustesDe(
        movimientosDeLaJornada(db, empresa, sucursal, fecha).where(
          "m.corrige_jornada",
          "is not",
          null,
        ),
      );
    },

    ajustesPosteriores(empresa, sucursal, fecha) {
      // Las sesiones de la sucursal que citan esta fecha: no se filtra por la fecha de su propia sesión.
      return ajustesDe(
        db
          .selectFrom("movimiento_caja as m")
          .innerJoin("sesion_caja as s", (unir) =>
            unir.onRef("s.id", "=", "m.sesion_id").onRef("s.empresa_id", "=", "m.empresa_id"),
          )
          .innerJoin("caja as c", (unir) =>
            unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
          )
          .innerJoin("medio_de_pago as md", (unir) =>
            unir
              .onRef("md.id", "=", "m.medio_de_pago_id")
              .onRef("md.empresa_id", "=", "m.empresa_id"),
          )
          .leftJoin("cuenta_de_cobro as cu", (unir) =>
            unir
              .onRef("cu.id", "=", "m.cuenta_de_cobro_id")
              .onRef("cu.empresa_id", "=", "m.empresa_id"),
          )
          .where("m.empresa_id", "=", empresa)
          .where("c.sucursal_id", "=", sucursal)
          .where(sql<boolean>`m.corrige_jornada = ${fecha}::date`),
      );
    },

    async movimientosManuales(empresa, sucursal, fecha, limite) {
      const filas = await movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .select([
          "m.id as id",
          "m.sesion_id as sesion_id",
          "m.clase as clase",
          "m.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          sql<string>`m.importe::text`.as("importe"),
          "m.motivo as motivo",
          "m.anula_a as anula_a",
          sql<string | null>`m.corrige_jornada::text`.as("corrige_jornada"),
          "m.registrado_en as registrado_en",
          "m.registrado_por as registrado_por",
        ])
        .where("m.clase", "in", ["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE", "ANULACION"])
        .orderBy("m.registrado_en")
        .orderBy("m.id")
        .limit(limite)
        .execute();
      return filas.map((f) => ({
        ...comoMedio(f),
        id: f.id,
        sesionId: f.sesion_id,
        clase: f.clase,
        importe: importeDesdeTexto(ARS, f.importe),
        motivo: f.motivo,
        anulaA: f.anula_a,
        corrigeJornada: f.corrige_jornada as FechaCivil | null,
        registradoEn: f.registrado_en,
        registradoPor: personaId(f.registrado_por),
      }));
    },

    async cobradoPorMedioVigente(empresa, sucursal, fecha) {
      const filas = await movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .innerJoin("cobro as co", (unir) =>
          unir.onRef("co.movimiento_id", "=", "m.id").onRef("co.empresa_id", "=", "m.empresa_id"),
        )
        .select([
          sql<string>`coalesce((
            select k.medio_despues_id from correccion_de_medio k
             where k.empresa_id = m.empresa_id and k.cobro_id = m.id order by k.secuencia desc limit 1
          ), m.medio_de_pago_id)::text`.as("medio_vigente"),
          sql<string>`count(*)::text`.as("cobros"),
          sql<string>`sum(m.importe)::text`.as("importe"),
        ])
        .groupBy(sql`1`)
        .orderBy(sql`1`)
        .execute();
      return filas.map((f) => ({
        medioDePagoId: f.medio_vigente,
        cobros: Number(f.cobros),
        importe: importeDesdeTexto(ARS, f.importe),
      }));
    },

    async cobradoPorOrigen(empresa, sucursal, fecha, despuesDe, limite) {
      let consulta = movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .innerJoin("cobro as co", (unir) =>
          unir.onRef("co.movimiento_id", "=", "m.id").onRef("co.empresa_id", "=", "m.empresa_id"),
        )
        .select([
          "co.origen_tipo as origen_tipo",
          "co.origen_id as origen_id",
          sql<string>`sum(m.importe)::text`.as("cobrado"),
          sql<string>`count(*)::text`.as("cobros"),
        ])
        .groupBy(["co.origen_tipo", "co.origen_id"]);
      if (despuesDe !== null) {
        consulta = consulta.having(
          sql<boolean>`(co.origen_tipo, co.origen_id) > (${despuesDe.tipo}::text, ${despuesDe.id}::uuid)`,
        );
      }
      consulta = consulta.orderBy("co.origen_tipo").orderBy("co.origen_id");
      const filas = await (limite === null ? consulta : consulta.limit(limite)).execute();
      return filas.map((f) => ({
        origen: { tipo: f.origen_tipo, id: f.origen_id },
        cobrado: importeDesdeTexto(ARS, f.cobrado),
        cobros: Number(f.cobros),
      }));
    },
  };
}
