import { sql, type Kysely } from "kysely";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
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
import type { ClaseDeMovimiento, EstadoDeSesion, TipoDeMedio } from "../estados";
import type { CajaDb } from "./esquema";

/** Un movimiento de caja tal como está guardado. `origen` solo lo tiene un cobro. */
export type MovimientoGuardado = Readonly<{
  id: string;
  sesionId: string;
  clase: ClaseDeMovimiento;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Con signo: entra > 0, sale < 0. */
  importe: Importe;
  motivo: string | null;
  anulaA: string | null;
  corrigeJornada: FechaCivil | null;
  registradoEn: Date;
  registradoPor: PersonaId;
  /** Lo guardado con la clave (el fondo no lleva): decide si un reintento es el mismo pedido. */
  huella: string | null;
  origen: Readonly<{ tipo: string; id: string }> | null;
}>;

/** Un movimiento con lo de su sesión que hace falta para decidir si se puede anular y quién puede hacerlo. */
export type MovimientoConSesion = MovimientoGuardado &
  Readonly<{ estadoDeLaSesion: EstadoDeSesion; sucursalId: SucursalId }>;

export type MovimientoNuevo = Readonly<{
  empresa: EmpresaId;
  sesionId: string;
  clase: ClaseDeMovimiento;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
  motivo: string | null;
  anulaA: string | null;
  corrigeJornada: FechaCivil | null;
  registradoEn: Date;
  registradoPor: PersonaId;
  /** El fondo inicial no lleva clave ni huella (nace con la sesión, que las tiene). */
  claveDeIdempotencia: string | null;
  huella: string | null;
}>;

/** Un movimiento reducido a lo que suma al esperado: de qué (medio, cuenta) y con qué signo. */
export type MovimientoParaSumar = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
}>;

/** El esperado de una línea (medio, cuenta) de la sesión: Σ exacta de sus movimientos, con lo que hace falta para mostrarla. */
export type EsperadoDeLinea = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: Importe;
}>;

/** Dónde seguir una lista paginada: el último `(registrado_en, id)` visto. */
export type CursorDeMovimientos = Readonly<{ registradoEn: Date; id: string }>;

export type MovimientoDeLista = MovimientoGuardado &
  Readonly<{
    medioTipo: TipoDeMedio;
    medioNombre: string | null;
    cuentaNombre: string | null;
    /** El id de la anulación de este movimiento, si ya se anuló. */
    anuladoPor: string | null;
  }>;

/**
 * Persistencia de los movimientos de caja. Solo inserción: nada se actualiza ni se borra (disparadores de la base, también para el dueño).
 * Anular es insertar el espejo. El esperado de una línea es la suma exacta de sus importes: las sumas se hacen en `numeric` (consultas) o en
 * `bigint` de centavos (casos de uso), nunca con `number`.
 */
export interface RepositorioDeMovimientos {
  /** Un movimiento de la empresa con su sesión; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: string): Promise<MovimientoConSesion | null>;
  /** El movimiento que se registró con esa clave de idempotencia (de cualquier sesión de la empresa), si hay. */
  obtenerPorClave(empresa: EmpresaId, clave: string): Promise<MovimientoGuardado | null>;
  /**
   * Lo mínimo de un movimiento por su clave (id, sesión y huella), leyendo SOLO `movimiento_caja`: el puerto de cobrar lo usa en cada cobro
   * y, bajo `SERIALIZABLE`, cada tabla que se lee entera es un conflicto con cualquier alta de otro cobro.
   */
  obtenerHuellaPorClave(
    empresa: EmpresaId,
    clave: string,
  ): Promise<Readonly<{ id: string; sesionId: string; huella: string | null }> | null>;
  /** El id de la anulación de ese movimiento, si ya se anuló. */
  anulacionDe(empresa: EmpresaId, movimientoId: string): Promise<string | null>;
  /** Alta de un movimiento. Devuelve el id que genera la base. */
  insertar(nuevo: MovimientoNuevo): Promise<string>;
  /**
   * Alta idempotente: `INSERT ... ON CONFLICT DO NOTHING` SIN objetivo, así que cubre cualquier unicidad (la clave de idempotencia, el id, la
   * anulación). `null` si no insertó porque otro pedido se adelantó: quien llama relee por clave. Es para quien corre en la transacción de
   * OTRO (el puerto de cobrar) y no puede repetirse solo: un error de unicidad dejaría esa transacción abortada. Bajo `SERIALIZABLE`, un
   * choque con una fila que esta transacción no ve aborta por serialización y el adaptador repite todo; en `read committed` devuelve `null`.
   */
  insertarSiNoExiste(nuevo: MovimientoNuevo): Promise<string | null>;
  /** Todos los movimientos de la sesión, reducidos a lo que suman: con ellos se calcula el arqueo. */
  paraSumar(empresa: EmpresaId, sesionId: string): Promise<MovimientoParaSumar[]>;
  /** El esperado de cada línea (medio, cuenta) de la sesión, ordenado por medio y cuenta. Solo lectura. */
  esperadoPorLinea(empresa: EmpresaId, sesionId: string): Promise<EsperadoDeLinea[]>;
  /** Una página de movimientos de la sesión en orden `(registrado_en, id)`, después del cursor. Pide `limite` filas. Solo lectura. */
  pagina(
    empresa: EmpresaId,
    sesionId: string,
    despuesDe: CursorDeMovimientos | null,
    limite: number,
  ): Promise<MovimientoDeLista[]>;
}

type FilaDeMovimiento = Readonly<{
  id: string;
  sesion_id: string;
  clase: ClaseDeMovimiento;
  medio_de_pago_id: string;
  cuenta_de_cobro_id: string | null;
  importe: string;
  motivo: string | null;
  anula_a: string | null;
  corrige_jornada: string | null;
  registrado_en: Date;
  registrado_por: string;
  huella: string | null;
  origen_tipo: string | null;
  origen_id: string | null;
}>;

function aMovimiento(fila: FilaDeMovimiento): MovimientoGuardado {
  return {
    id: fila.id,
    sesionId: fila.sesion_id,
    clase: fila.clase,
    medioDePagoId: fila.medio_de_pago_id,
    cuentaDeCobroId: fila.cuenta_de_cobro_id,
    importe: importeDesdeTexto(ARS, fila.importe),
    motivo: fila.motivo,
    anulaA: fila.anula_a,
    corrigeJornada: fila.corrige_jornada as FechaCivil | null,
    registradoEn: fila.registrado_en,
    registradoPor: personaId(fila.registrado_por),
    huella: fila.huella,
    origen:
      fila.origen_tipo === null || fila.origen_id === null
        ? null
        : { tipo: fila.origen_tipo, id: fila.origen_id },
  };
}

export function crearRepositorioDeMovimientos(db: Kysely<CajaDb>): RepositorioDeMovimientos {
  const altaDe = (nuevo: MovimientoNuevo) =>
    db.insertInto("movimiento_caja").values({
      empresa_id: nuevo.empresa,
      sesion_id: nuevo.sesionId,
      clase: nuevo.clase,
      medio_de_pago_id: nuevo.medioDePagoId,
      cuenta_de_cobro_id: nuevo.cuentaDeCobroId,
      moneda: nuevo.importe.moneda,
      importe: importeATexto(nuevo.importe),
      motivo: nuevo.motivo,
      anula_a: nuevo.anulaA,
      corrige_jornada: nuevo.corrigeJornada,
      registrado_en: nuevo.registradoEn,
      registrado_por: nuevo.registradoPor,
      clave_idempotencia: nuevo.claveDeIdempotencia,
      huella: nuevo.huella,
    });

  const seleccionar = () =>
    db
      .selectFrom("movimiento_caja as m")
      .leftJoin("cobro as co", (unir) =>
        unir.onRef("co.movimiento_id", "=", "m.id").onRef("co.empresa_id", "=", "m.empresa_id"),
      )
      .select([
        "m.id as id",
        "m.sesion_id as sesion_id",
        "m.clase as clase",
        "m.medio_de_pago_id as medio_de_pago_id",
        "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
        sql<string>`m.importe::text`.as("importe"),
        "m.motivo as motivo",
        "m.anula_a as anula_a",
        sql<string | null>`m.corrige_jornada::text`.as("corrige_jornada"),
        "m.registrado_en as registrado_en",
        "m.registrado_por as registrado_por",
        "m.huella as huella",
        "co.origen_tipo as origen_tipo",
        "co.origen_id as origen_id",
      ]);

  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionar()
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "m.sesion_id").onRef("s.empresa_id", "=", "m.empresa_id"),
        )
        .innerJoin("caja as c", (unir) =>
          unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
        )
        .select(["s.estado as estado_de_la_sesion", "c.sucursal_id as sucursal_id"])
        .where("m.empresa_id", "=", empresa)
        .where("m.id", "=", id)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : {
            ...aMovimiento(fila),
            estadoDeLaSesion: fila.estado_de_la_sesion,
            sucursalId: sucursalId(fila.sucursal_id),
          };
    },

    async obtenerPorClave(empresa, clave) {
      const fila = await seleccionar()
        .where("m.empresa_id", "=", empresa)
        .where("m.clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aMovimiento(fila);
    },

    async obtenerHuellaPorClave(empresa, clave) {
      const fila = await db
        .selectFrom("movimiento_caja")
        .select(["id", "sesion_id", "huella"])
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : { id: fila.id, sesionId: fila.sesion_id, huella: fila.huella };
    },

    async anulacionDe(empresa, movimientoId) {
      const fila = await db
        .selectFrom("movimiento_caja")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("anula_a", "=", movimientoId)
        .executeTakeFirst();
      return fila === undefined ? null : fila.id;
    },

    async insertar(nuevo) {
      const fila = await altaDe(nuevo).returning("id").executeTakeFirstOrThrow();
      return fila.id;
    },

    async insertarSiNoExiste(nuevo) {
      const fila = await altaDe(nuevo)
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila === undefined ? null : fila.id;
    },

    async paraSumar(empresa, sesionId) {
      const filas = await db
        .selectFrom("movimiento_caja")
        .select([
          "medio_de_pago_id",
          "cuenta_de_cobro_id",
          sql<string>`importe::text`.as("importe"),
        ])
        .where("empresa_id", "=", empresa)
        .where("sesion_id", "=", sesionId)
        .execute();
      return filas.map((fila) => ({
        medioDePagoId: fila.medio_de_pago_id,
        cuentaDeCobroId: fila.cuenta_de_cobro_id,
        importe: importeDesdeTexto(ARS, fila.importe),
      }));
    },

    async esperadoPorLinea(empresa, sesionId) {
      const filas = await db
        .selectFrom("movimiento_caja as m")
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
        .select([
          "m.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "m.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          sql<string>`sum(m.importe)::text`.as("esperado"),
        ])
        .where("m.empresa_id", "=", empresa)
        .where("m.sesion_id", "=", sesionId)
        .groupBy([
          "m.medio_de_pago_id",
          "md.tipo",
          "md.nombre",
          "m.cuenta_de_cobro_id",
          "cu.nombre",
        ])
        .orderBy("m.medio_de_pago_id")
        .orderBy("m.cuenta_de_cobro_id")
        .execute();
      return filas.map((fila) => ({
        medioDePagoId: fila.medio_de_pago_id,
        medioTipo: fila.medio_tipo,
        medioNombre: fila.medio_nombre,
        cuentaDeCobroId: fila.cuenta_de_cobro_id,
        cuentaNombre: fila.cuenta_nombre,
        esperado: importeDesdeTexto(ARS, fila.esperado),
      }));
    },

    async pagina(empresa, sesionId, despuesDe, limite) {
      let consulta = seleccionar()
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
        .select([
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "cu.nombre as cuenta_nombre",
          sql<string | null>`(
            select a.id from movimiento_caja a where a.empresa_id = m.empresa_id and a.anula_a = m.id
          )`.as("anulado_por"),
        ])
        .where("m.empresa_id", "=", empresa)
        .where("m.sesion_id", "=", sesionId);
      if (despuesDe !== null) {
        consulta = consulta.where(
          sql<boolean>`(m.registrado_en, m.id) > (${despuesDe.registradoEn}::timestamptz, ${despuesDe.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy("m.registrado_en")
        .orderBy("m.id")
        .limit(limite)
        .execute();
      return filas.map((fila) => ({
        ...aMovimiento(fila),
        medioTipo: fila.medio_tipo,
        medioNombre: fila.medio_nombre,
        cuentaNombre: fila.cuenta_nombre,
        anuladoPor: fila.anulado_por,
      }));
    },
  };
}
