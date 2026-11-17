import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { DatosDelCobroValidos } from "../dominio/datos-del-cobro";
import { esUuid } from "../dominio/identificadores";
import type { ReferenciaOpaca } from "../dominio/identidad-del-cobro";
import type { TipoDeMedio } from "../estados";
import type { CajaDb } from "./esquema";

/** Lo que se guarda de un cobro además de su movimiento: el origen (identidad del efecto) y los datos opcionales ya validados. */
export type CobroNuevo = Readonly<{
  empresa: EmpresaId;
  /** El id del cobro ES el de su movimiento (1:1). */
  movimientoId: string;
  origen: ReferenciaOpaca;
  origenOrden: number;
  datos: DatosDelCobroValidos;
}>;

/** Una corrección de medio de un cobro, reducida a lo que hace falta para saber cuál es su medio vigente. */
export type CorreccionDeCobro = Readonly<{
  secuencia: number;
  medioDespuesId: string;
  medioDespuesTipo: TipoDeMedio;
  cuentaDespuesId: string | null;
}>;

/** Un cobro de un origen tal como se cobró (medio y cuenta ORIGINALES) con sus correcciones de medio, de la primera a la última. */
export type CobroDeOrigenGuardado = Readonly<{
  cobroId: string;
  sesionId: string;
  origenOrden: number;
  importe: Importe;
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  cuentaDeCobroId: string | null;
  /** La jornada de la sesión del cobro (el sello de la sesión, no la fecha de hoy). */
  fechaDeNegocio: FechaCivil;
  correcciones: readonly CorreccionDeCobro[];
}>;

export type MarcaDeTarjeta = Readonly<{ id: string; nombre: string }>;

/**
 * Persistencia del cobro (e3 §3.5). La fila de `cobro` nace en la transacción de quien cobra, después de su movimiento `COBRO`; es de solo
 * inserción para todos (disparadores de la base). Las marcas de tarjeta son una lista GLOBAL del sistema que esta app solo lee. El medio
 * vigente de un cobro es el destino de su última corrección: acá se leen las correcciones, no se escriben (eso es del tramo siguiente).
 */
export interface RepositorioDeCobros {
  /**
   * Alta con `INSERT ... ON CONFLICT DO NOTHING` sin objetivo (cualquier unicidad, sin dejar abortada la transacción del llamador).
   * `false` si no insertó porque ese origen y orden ya tenían su cobro.
   */
  insertar(nuevo: CobroNuevo): Promise<boolean>;
  /** Los cobros de un origen, ordenados por su posición dentro de él. Solo lectura. */
  deOrigen(empresa: EmpresaId, origen: ReferenciaOpaca): Promise<CobroDeOrigenGuardado[]>;
  /** Las marcas de tarjeta ACTIVAS (la lista `MARCAS_DE_TARJETA`), por nombre. Solo lectura. */
  marcasActivas(): Promise<MarcaDeTarjeta[]>;
  /** ¿Es esta una marca de tarjeta activa? Un texto que no es un UUID no puede serlo. */
  esMarcaActiva(id: string): Promise<boolean>;
  /** El nivel de aislamiento de la transacción en curso (`serializable`, `repeatable read`, `read committed`...), tal como lo informa la base. */
  aislamientoDeLaTransaccion(): Promise<string>;
}

export function crearRepositorioDeCobros(db: Kysely<CajaDb>): RepositorioDeCobros {
  return {
    async insertar(nuevo) {
      const resultado = await db
        .insertInto("cobro")
        .values({
          movimiento_id: nuevo.movimientoId,
          empresa_id: nuevo.empresa,
          origen_tipo: nuevo.origen.tipo,
          origen_id: nuevo.origen.id,
          origen_orden: nuevo.origenOrden,
          cupon: nuevo.datos.cupon,
          ultimos4: nuevo.datos.ultimos4,
          marca_de_tarjeta_id: nuevo.datos.marcaDeTarjetaId,
          cuotas: nuevo.datos.cuotas,
          dni: nuevo.datos.dni,
        })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst();
      return resultado.numInsertedOrUpdatedRows === 1n;
    },

    async deOrigen(empresa, origen) {
      if (!esUuid(origen.id)) return [];
      const cobros = await db
        .selectFrom("cobro as co")
        .innerJoin("movimiento_caja as m", (unir) =>
          unir.onRef("m.id", "=", "co.movimiento_id").onRef("m.empresa_id", "=", "co.empresa_id"),
        )
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "m.sesion_id").onRef("s.empresa_id", "=", "m.empresa_id"),
        )
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "m.medio_de_pago_id")
            .onRef("md.empresa_id", "=", "m.empresa_id"),
        )
        .select([
          "co.movimiento_id as cobro_id",
          "m.sesion_id as sesion_id",
          "co.origen_orden as origen_orden",
          sql<string>`m.importe::text`.as("importe"),
          "m.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          sql<string>`s.fecha_negocio::text`.as("fecha_negocio"),
        ])
        .where("co.empresa_id", "=", empresa)
        .where("co.origen_tipo", "=", origen.tipo)
        .where("co.origen_id", "=", origen.id)
        .orderBy("co.origen_orden")
        .execute();
      if (cobros.length === 0) return [];
      const correcciones = await db
        .selectFrom("correccion_de_medio as k")
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "k.medio_despues_id")
            .onRef("md.empresa_id", "=", "k.empresa_id"),
        )
        .select([
          "k.cobro_id as cobro_id",
          "k.secuencia as secuencia",
          "k.medio_despues_id as medio_despues_id",
          "md.tipo as medio_despues_tipo",
          "k.cuenta_despues_id as cuenta_despues_id",
        ])
        .where("k.empresa_id", "=", empresa)
        .where(
          "k.cobro_id",
          "in",
          cobros.map((c) => c.cobro_id),
        )
        .orderBy("k.secuencia")
        .execute();
      return cobros.map((c) => ({
        cobroId: c.cobro_id,
        sesionId: c.sesion_id,
        origenOrden: c.origen_orden,
        importe: importeDesdeTexto(ARS, c.importe),
        medioDePagoId: c.medio_de_pago_id,
        medioTipo: c.medio_tipo,
        cuentaDeCobroId: c.cuenta_de_cobro_id,
        fechaDeNegocio: c.fecha_negocio as FechaCivil,
        correcciones: correcciones
          .filter((k) => k.cobro_id === c.cobro_id)
          .map((k) => ({
            secuencia: k.secuencia,
            medioDespuesId: k.medio_despues_id,
            medioDespuesTipo: k.medio_despues_tipo,
            cuentaDespuesId: k.cuenta_despues_id,
          })),
      }));
    },

    async marcasActivas() {
      return db
        .selectFrom("valor_de_lista")
        .select(["id", "nombre"])
        .where("lista", "=", "MARCAS_DE_TARJETA")
        .where("activo", "=", true)
        .orderBy("nombre")
        .orderBy("id")
        .execute();
    },

    async aislamientoDeLaTransaccion() {
      const { rows } = await sql<{
        aislamiento: string;
      }>`select current_setting('transaction_isolation') as aislamiento`.execute(db);
      return rows[0]?.aislamiento ?? "";
    },

    async esMarcaActiva(id) {
      if (!esUuid(id)) return false;
      const fila = await db
        .selectFrom("valor_de_lista")
        .select("id")
        .where("id", "=", id)
        .where("lista", "=", "MARCAS_DE_TARJETA")
        .where("activo", "=", true)
        .executeTakeFirst();
      return fila !== undefined;
    },
  };
}
