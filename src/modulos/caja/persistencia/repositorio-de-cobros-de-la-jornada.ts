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
import {
  comoMedio,
  movimientosDeLaJornada,
  type MedioYCuentaConNombre,
} from "./base-de-la-jornada";
import type { CajaDb } from "./esquema";

/**
 * Los cobros de una jornada con su medio ORIGINAL y el VIGENTE (e3b §4.5): el cobro original no se toca; el vigente es el destino de su
 * última corrección de medio. Solo lectura, sin caché; los importes como texto decimal que se lee a `bigint` de centavos.
 */

export type CorreccionDeUnCobro = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    secuencia: number;
    motivo: string;
    corregidaEn: Date;
    corregidaPor: PersonaId;
  }>;

export type CobroDeLaJornada = Readonly<{
  cobroId: string;
  sesionId: string;
  importe: Importe;
  /** El medio y la cuenta con que se cobró (el cobro original no se toca). */
  original: MedioYCuentaConNombre;
  /** El medio y la cuenta vigentes tras las correcciones (los originales si no hubo). */
  vigente: MedioYCuentaConNombre;
  origen: Readonly<{ tipo: string; id: string; orden: number }>;
  registradoEn: Date;
  registradoPor: PersonaId;
  correcciones: readonly CorreccionDeUnCobro[];
}>;

export type CursorDeCobros = Readonly<{ registradoEn: Date; id: string }>;

export type FiltroDeCobros = Readonly<{
  /** Solo los cobros cuyo medio original o vigente es este; `null`: todos. */
  medioDePagoId: string | null;
  despuesDe: CursorDeCobros | null;
  limite: number;
}>;

export interface RepositorioDeCobrosDeLaJornada {
  /** Una página de cobros de la jornada por `(registrado_en, id)`, con sus correcciones. Pide `limite` filas. */
  cobros(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
    filtro: FiltroDeCobros,
  ): Promise<CobroDeLaJornada[]>;
}

/** El medio y la cuenta vigentes de un cobro: los de su última corrección, sin el resto de lo que ella guardó. */
const sinElDetalleDeLaCorreccion = (c: MedioYCuentaConNombre): MedioYCuentaConNombre => ({
  medioDePagoId: c.medioDePagoId,
  medioTipo: c.medioTipo,
  medioNombre: c.medioNombre,
  cuentaDeCobroId: c.cuentaDeCobroId,
  cuentaNombre: c.cuentaNombre,
});

export function crearRepositorioDeCobrosDeLaJornada(
  db: Kysely<CajaDb>,
): RepositorioDeCobrosDeLaJornada {
  return {
    async cobros(empresa, sucursal, fecha, filtro) {
      let consulta = movimientosDeLaJornada(db, empresa, sucursal, fecha)
        .innerJoin("cobro as co", (unir) =>
          unir.onRef("co.movimiento_id", "=", "m.id").onRef("co.empresa_id", "=", "m.empresa_id"),
        )
        .select([
          "m.id as id",
          "m.sesion_id as sesion_id",
          "m.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          sql<string>`m.importe::text`.as("importe"),
          "co.origen_tipo as origen_tipo",
          "co.origen_id as origen_id",
          "co.origen_orden as origen_orden",
          "m.registrado_en as registrado_en",
          "m.registrado_por as registrado_por",
        ]);
      if (filtro.medioDePagoId !== null) {
        const medio = filtro.medioDePagoId;
        consulta = consulta.where(
          sql<boolean>`(m.medio_de_pago_id = ${medio}::uuid or coalesce((
          select k.medio_despues_id from correccion_de_medio k
           where k.empresa_id = m.empresa_id and k.cobro_id = m.id order by k.secuencia desc limit 1
        ), m.medio_de_pago_id) = ${medio}::uuid)`,
        );
      }
      if (filtro.despuesDe !== null) {
        consulta = consulta.where(
          sql<boolean>`(m.registrado_en, m.id) > (${filtro.despuesDe.registradoEn}::timestamptz, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const cobros = await consulta
        .orderBy("m.registrado_en")
        .orderBy("m.id")
        .limit(filtro.limite)
        .execute();
      if (cobros.length === 0) return [];
      const correcciones = await db
        .selectFrom("correccion_de_medio as k")
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "k.medio_despues_id")
            .onRef("md.empresa_id", "=", "k.empresa_id"),
        )
        .leftJoin("cuenta_de_cobro as cu", (unir) =>
          unir
            .onRef("cu.id", "=", "k.cuenta_despues_id")
            .onRef("cu.empresa_id", "=", "k.empresa_id"),
        )
        .select([
          "k.id as id",
          "k.cobro_id as cobro_id",
          "k.secuencia as secuencia",
          "k.medio_despues_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "k.cuenta_despues_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          "k.motivo as motivo",
          "k.corregido_en as corregido_en",
          "k.corregido_por as corregido_por",
        ])
        .where("k.empresa_id", "=", empresa)
        .where(
          "k.cobro_id",
          "in",
          cobros.map((c) => c.id),
        )
        .orderBy("k.secuencia")
        .execute();
      return cobros.map((c) => {
        const original = comoMedio(c);
        const suyas = correcciones
          .filter((k) => k.cobro_id === c.id)
          .map((k) => ({
            ...comoMedio(k),
            id: k.id,
            secuencia: k.secuencia,
            motivo: k.motivo,
            corregidaEn: k.corregido_en,
            corregidaPor: personaId(k.corregido_por),
          }));
        const ultima = suyas.at(-1);
        return {
          cobroId: c.id,
          sesionId: c.sesion_id,
          importe: importeDesdeTexto(ARS, c.importe),
          original,
          vigente: ultima === undefined ? original : sinElDetalleDeLaCorreccion(ultima),
          origen: { tipo: c.origen_tipo, id: c.origen_id, orden: c.origen_orden },
          registradoEn: c.registrado_en,
          registradoPor: personaId(c.registrado_por),
          correcciones: suyas,
        };
      });
    },
  };
}
