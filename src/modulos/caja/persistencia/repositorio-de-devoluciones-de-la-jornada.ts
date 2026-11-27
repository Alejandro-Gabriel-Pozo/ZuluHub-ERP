import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { DevueltoDeUnOrigen } from "../dominio/cobrado-contra-ticket";
import type { OrigenDevoluble } from "../dominio/devolucion";
import { movimientosDeLaJornada } from "./base-de-la-jornada";
import type { CajaDb } from "./esquema";

/** Un importe de la jornada por (medio, cuenta). */
export type ImportePorPar = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
}>;

/**
 * Las LECTURAS de lo cobrado y lo devuelto de una jornada `(sucursal, fecha de negocio)` que usa el cierre del día con la devolución con medio (DM-3). Solo lectura, con la empresa
 * en cada filtro (además de la RLS) y los importes como texto decimal leído a `bigint` de centavos. Una devolución es VIGENTE si su egreso no tiene una anulación espejo (la misma
 * regla que `movimiento_de_dinero_devolvible_de_origen` y que el disparador `cierre_de_caja_verificar` de la base: una regla, tres lugares que se comparan por prueba).
 */
export interface RepositorioDeDevolucionesDeLaJornada {
  /** Σ de los COBROS de la jornada por (medio, cuenta) con que se cobraron (antes de las correcciones de medio). Informativo: no entra en la diferencia del cierre. */
  cobradoPorPar(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<ImportePorPar[]>;
  /** Σ, en positivo, de las devoluciones VIGENTES de la jornada por (medio, cuenta) del egreso. Informativo. */
  devueltoPorPar(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<ImportePorPar[]>;
  /** Lo devuelto (vigente, HASTA AHORA, de cualquier jornada) de cada una de esas cobranzas; las que no tienen devoluciones no figuran. */
  devueltoPorOrigen(
    empresa: EmpresaId,
    tipo: OrigenDevoluble,
    origenIds: readonly string[],
  ): Promise<DevueltoDeUnOrigen[]>;
}

export function crearRepositorioDeDevolucionesDeLaJornada(
  db: Kysely<CajaDb>,
): RepositorioDeDevolucionesDeLaJornada {
  const porPar = (f: {
    medio_de_pago_id: string;
    cuenta_de_cobro_id: string | null;
    importe: string;
  }): ImportePorPar => ({
    medioDePagoId: f.medio_de_pago_id,
    cuentaDeCobroId: f.cuenta_de_cobro_id,
    importe: importeDesdeTexto(ARS, f.importe),
  });

  return {
    async cobradoPorPar(empresa, sucursal, fecha) {
      const filas = await movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .where("m.clase", "=", "COBRO")
        .select([
          "m.medio_de_pago_id as medio_de_pago_id",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          sql<string>`sum(m.importe)::text`.as("importe"),
        ])
        .groupBy(["m.medio_de_pago_id", "m.cuenta_de_cobro_id"])
        .execute();
      return filas.map(porPar);
    },

    async devueltoPorPar(empresa, sucursal, fecha) {
      const filas = await movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .innerJoin("movimiento_de_dinero as d", (unir) =>
          unir.onRef("d.movimiento_id", "=", "m.id").onRef("d.empresa_id", "=", "m.empresa_id"),
        )
        .where("m.clase", "=", "EGRESO_MANUAL")
        .where("d.devuelve_origen_id", "is not", null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("movimiento_caja as a")
                .select("a.id")
                .whereRef("a.empresa_id", "=", "m.empresa_id")
                .whereRef("a.anula_a", "=", "m.id")
                .where("a.clase", "=", "ANULACION"),
            ),
          ),
        )
        .select([
          "m.medio_de_pago_id as medio_de_pago_id",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          sql<string>`(-sum(m.importe))::text`.as("importe"),
        ])
        .groupBy(["m.medio_de_pago_id", "m.cuenta_de_cobro_id"])
        .execute();
      return filas.map(porPar);
    },

    async devueltoPorOrigen(empresa, tipo, origenIds) {
      if (origenIds.length === 0) return [];
      const filas = await db
        .selectFrom("movimiento_de_dinero as d")
        .where("d.empresa_id", "=", empresa)
        .where("d.devuelve_origen_tipo", "=", tipo)
        .where("d.devuelve_origen_id", "in", [...origenIds])
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("movimiento_caja as a")
                .select("a.id")
                .whereRef("a.empresa_id", "=", "d.empresa_id")
                .whereRef("a.anula_a", "=", "d.movimiento_id")
                .where("a.clase", "=", "ANULACION"),
            ),
          ),
        )
        .select([
          "d.devuelve_origen_id as origen_id",
          sql<string>`sum(d.importe)::text`.as("devuelto"),
        ])
        .groupBy("d.devuelve_origen_id")
        .execute();
      return filas.map((f) => ({
        origenId: f.origen_id as string,
        devuelto: importeDesdeTexto(ARS, f.devuelto),
      }));
    },
  };
}
