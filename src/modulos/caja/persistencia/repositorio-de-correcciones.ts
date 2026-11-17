import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { esUuid } from "../dominio/identificadores";
import type { ParDeCobro } from "../dominio/medios";
import type { CajaDb } from "./esquema";

/** Un cobro tal como hace falta para corregirle el medio: su jornada (la de su sesión), su importe y sus correcciones hasta hoy. */
export type CobroACorregir = Readonly<{
  cobroId: string;
  sucursalId: SucursalId;
  /** La jornada de la SESIÓN del cobro: la copia sellada que lleva cada corrección. */
  fechaDeNegocio: FechaCivil;
  importe: Importe;
  /** El medio y la cuenta con que se cobró. */
  original: ParDeCobro;
  /** Las correcciones de la primera a la última. */
  correcciones: readonly Readonly<{ secuencia: number; despues: ParDeCobro }>[];
}>;

export type CorreccionNueva = Readonly<{
  empresa: EmpresaId;
  cobroId: string;
  secuencia: number;
  sucursalId: SucursalId;
  fechaDeNegocio: FechaCivil;
  antes: ParDeCobro;
  despues: ParDeCobro;
  motivo: string;
  corregidoEn: Date;
  corregidoPor: PersonaId;
  claveDeIdempotencia: string;
  huella: string;
}>;

/** Lo mínimo de una corrección hecha con una clave: de qué cobro y con qué contenido (la huella). */
export type CorreccionPorClave = Readonly<{
  id: string;
  cobroId: string;
  secuencia: number;
  huella: string;
}>;

/** Una corrección de la jornada con el importe de su cobro (lo que se traslada de un par al otro). */
export type CorreccionDeLaJornada = Readonly<{
  id: string;
  cobroId: string;
  secuencia: number;
  importe: Importe;
  antes: ParDeCobro;
  despues: ParDeCobro;
  motivo: string;
  corregidaEn: Date;
  corregidaPor: PersonaId;
}>;

/**
 * Persistencia de la corrección de medio de un cobro (e3b §4.3): registro NUEVO, solo inserción (disparadores de la base, también para el
 * dueño); el cobro original no se toca. La clave primaria `(cobro, secuencia)` arbitra dos correcciones simultáneas del mismo cobro.
 */
export interface RepositorioDeCorrecciones {
  /** El cobro con su medio original y sus correcciones; `null` si no existe, no es de la empresa o es un movimiento que no es un cobro. */
  cobroACorregir(empresa: EmpresaId, cobroId: string): Promise<CobroACorregir | null>;
  /** La corrección hecha con esa clave de idempotencia, si hay. */
  obtenerPorClave(empresa: EmpresaId, clave: string): Promise<CorreccionPorClave | null>;
  /** Alta de la corrección; devuelve el id que genera la base. La base repite todas las reglas (jornada en auditoría, vigente, destino). */
  insertar(nueva: CorreccionNueva): Promise<string>;
  /** Todas las correcciones de la jornada (sucursal y fecha de la sesión del cobro), por cobro y secuencia. Solo lectura. */
  deLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<CorreccionDeLaJornada[]>;
}

export function crearRepositorioDeCorrecciones(db: Kysely<CajaDb>): RepositorioDeCorrecciones {
  return {
    async cobroACorregir(empresa, cobroId) {
      if (!esUuid(cobroId)) return null;
      const cobro = await db
        .selectFrom("cobro as co")
        .innerJoin("movimiento_caja as m", (unir) =>
          unir.onRef("m.id", "=", "co.movimiento_id").onRef("m.empresa_id", "=", "co.empresa_id"),
        )
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "m.sesion_id").onRef("s.empresa_id", "=", "m.empresa_id"),
        )
        .innerJoin("caja as c", (unir) =>
          unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
        )
        .select([
          "co.movimiento_id as cobro_id",
          "c.sucursal_id as sucursal_id",
          sql<string>`s.fecha_negocio::text`.as("fecha_negocio"),
          sql<string>`m.importe::text`.as("importe"),
          "m.medio_de_pago_id as medio_de_pago_id",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
        ])
        .where("co.empresa_id", "=", empresa)
        .where("co.movimiento_id", "=", cobroId)
        .executeTakeFirst();
      if (cobro === undefined) return null;
      const correcciones = await db
        .selectFrom("correccion_de_medio")
        .select(["secuencia", "medio_despues_id", "cuenta_despues_id"])
        .where("empresa_id", "=", empresa)
        .where("cobro_id", "=", cobroId)
        .orderBy("secuencia")
        .execute();
      return {
        cobroId: cobro.cobro_id,
        sucursalId: sucursalId(cobro.sucursal_id),
        fechaDeNegocio: cobro.fecha_negocio as FechaCivil,
        importe: importeDesdeTexto(ARS, cobro.importe),
        original: {
          medioDePagoId: cobro.medio_de_pago_id,
          cuentaDeCobroId: cobro.cuenta_de_cobro_id,
        },
        correcciones: correcciones.map((k) => ({
          secuencia: k.secuencia,
          despues: { medioDePagoId: k.medio_despues_id, cuentaDeCobroId: k.cuenta_despues_id },
        })),
      };
    },

    async obtenerPorClave(empresa, clave) {
      const fila = await db
        .selectFrom("correccion_de_medio")
        .select(["id", "cobro_id", "secuencia", "huella"])
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : { id: fila.id, cobroId: fila.cobro_id, secuencia: fila.secuencia, huella: fila.huella };
    },

    async insertar(nueva) {
      const fila = await db
        .insertInto("correccion_de_medio")
        .values({
          empresa_id: nueva.empresa,
          cobro_id: nueva.cobroId,
          secuencia: nueva.secuencia,
          sucursal_id: nueva.sucursalId,
          fecha_negocio: nueva.fechaDeNegocio,
          medio_antes_id: nueva.antes.medioDePagoId,
          cuenta_antes_id: nueva.antes.cuentaDeCobroId,
          medio_despues_id: nueva.despues.medioDePagoId,
          cuenta_despues_id: nueva.despues.cuentaDeCobroId,
          motivo: nueva.motivo,
          corregido_en: nueva.corregidoEn,
          corregido_por: nueva.corregidoPor,
          clave_idempotencia: nueva.claveDeIdempotencia,
          huella: nueva.huella,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async deLaJornada(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("correccion_de_medio as k")
        .innerJoin("movimiento_caja as m", (unir) =>
          unir.onRef("m.id", "=", "k.cobro_id").onRef("m.empresa_id", "=", "k.empresa_id"),
        )
        .select([
          "k.id as id",
          "k.cobro_id as cobro_id",
          "k.secuencia as secuencia",
          sql<string>`m.importe::text`.as("importe"),
          "k.medio_antes_id as medio_antes_id",
          "k.cuenta_antes_id as cuenta_antes_id",
          "k.medio_despues_id as medio_despues_id",
          "k.cuenta_despues_id as cuenta_despues_id",
          "k.motivo as motivo",
          "k.corregido_en as corregido_en",
          "k.corregido_por as corregido_por",
        ])
        .where("k.empresa_id", "=", empresa)
        .where("k.sucursal_id", "=", sucursal)
        .where(sql<boolean>`k.fecha_negocio = ${fecha}::date`)
        .orderBy("k.cobro_id")
        .orderBy("k.secuencia")
        .execute();
      return filas.map((k) => ({
        id: k.id,
        cobroId: k.cobro_id,
        secuencia: k.secuencia,
        importe: importeDesdeTexto(ARS, k.importe),
        antes: { medioDePagoId: k.medio_antes_id, cuentaDeCobroId: k.cuenta_antes_id },
        despues: { medioDePagoId: k.medio_despues_id, cuentaDeCobroId: k.cuenta_despues_id },
        motivo: k.motivo,
        corregidaEn: k.corregido_en,
        corregidaPor: personaId(k.corregido_por),
      }));
    },
  };
}
