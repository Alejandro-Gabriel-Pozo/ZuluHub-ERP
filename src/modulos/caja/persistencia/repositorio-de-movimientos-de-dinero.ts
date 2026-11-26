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
import type {
  CategoriaDeSalida,
  SentidoDeMovimientoDeDinero,
} from "../dominio/movimiento-de-dinero";
import type { OrigenDevoluble } from "../dominio/devolucion";
import type { CajaDb } from "./esquema";

/** Un movimiento de dinero por alta. Lo que el sentido no admite va `null` (la base lo repite en `movimiento_de_dinero_forma_ck`). */
export type MovimientoDeDineroNuevo = Readonly<{
  empresa: EmpresaId;
  sucursalId: SucursalId;
  sesionId: string;
  sentido: SentidoDeMovimientoDeDinero;
  importe: Importe;
  categoria: CategoriaDeSalida | null;
  concepto: string | null;
  motivo: string | null;
  terceroNombre: string | null;
  terceroPersonaId: string | null;
  referencia: string | null;
  devuelveA: string | null;
  /** La cobranza que devuelve (0113), con el pedido de devolución que agrupa sus líneas; `null` fuera de una devolución de cobranza. */
  devuelveOrigen?: Readonly<{ tipo: OrigenDevoluble; id: string; devolucionId: string }> | null;
  /** El egreso manual de la salida; `null` en la entrada (sus movimientos son los cobros con origen del acto). */
  movimientoId: string | null;
  claveDeIdempotencia: string;
  huella: string;
  registradoEn: Date;
  registradoPor: PersonaId;
}>;

export type MovimientoDeDineroGuardado = Readonly<{
  id: string;
  sucursalId: SucursalId;
  sesionId: string;
  sentido: SentidoDeMovimientoDeDinero;
  importe: Importe;
  categoria: CategoriaDeSalida | null;
  concepto: string | null;
  motivo: string | null;
  terceroNombre: string | null;
  terceroPersonaId: string | null;
  referencia: string | null;
  devuelveA: string | null;
  devuelveOrigen: Readonly<{ tipo: OrigenDevoluble; id: string; devolucionId: string }> | null;
  movimientoId: string | null;
  claveDeIdempotencia: string;
  huella: string;
  registradoEn: Date;
  registradoPor: PersonaId;
}>;

/**
 * Persistencia del acto «movimiento de dinero» (0091): solo inserción (disparadores de la base, también para el dueño). Sin caso de uso todavía
 * (PR-S2, PR-E1, PR-D1). La base repite todas las reglas (sesión abierta, egreso, tope de devoluciones, cuadre de la entrada).
 */
export interface RepositorioDeMovimientosDeDinero {
  /** Alta del acto; devuelve el id que genera la base. Una clave repetida choca con `movimiento_de_dinero_clave_uk`. */
  insertar(nuevo: MovimientoDeDineroNuevo): Promise<string>;
  /** El acto hecho con esa clave de idempotencia, si hay. */
  porClave(empresa: EmpresaId, clave: string): Promise<MovimientoDeDineroGuardado | null>;
  obtener(empresa: EmpresaId, id: string): Promise<MovimientoDeDineroGuardado | null>;
  /** Los actos de la jornada de una sucursal (la fecha de negocio de su sesión), por orden de registro. Solo lectura. */
  deLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<MovimientoDeDineroGuardado[]>;
  /** Lo ya devuelto de una entrada: Σ de sus devoluciones vigentes (las que no se anularon el mismo día). */
  devueltoDe(empresa: EmpresaId, entradaId: string): Promise<Importe>;
  /** Lo que queda por devolver de un origen (una entrada de dinero o una cobranza de ticket): la función de la base, la regla única del tope. */
  devolvibleDeOrigen(empresa: EmpresaId, tipo: string, id: string): Promise<Importe>;
}

type Fila = Readonly<{
  id: string;
  sucursal_id: string;
  sesion_id: string;
  sentido: SentidoDeMovimientoDeDinero;
  importe: string;
  categoria: CategoriaDeSalida | null;
  concepto: string | null;
  motivo: string | null;
  tercero_nombre: string | null;
  tercero_persona_id: string | null;
  referencia: string | null;
  devuelve_a: string | null;
  devuelve_origen_tipo: OrigenDevoluble | null;
  devuelve_origen_id: string | null;
  devolucion_id: string | null;
  movimiento_id: string | null;
  clave: string;
  huella: string;
  registrado_en: Date;
  registrado_por: string;
}>;

const aGuardado = (f: Fila): MovimientoDeDineroGuardado => ({
  id: f.id,
  sucursalId: sucursalId(f.sucursal_id),
  sesionId: f.sesion_id,
  sentido: f.sentido,
  importe: importeDesdeTexto(ARS, f.importe),
  categoria: f.categoria,
  concepto: f.concepto,
  motivo: f.motivo,
  terceroNombre: f.tercero_nombre,
  terceroPersonaId: f.tercero_persona_id,
  referencia: f.referencia,
  devuelveA: f.devuelve_a,
  devuelveOrigen:
    f.devuelve_origen_tipo === null
      ? null
      : {
          tipo: f.devuelve_origen_tipo,
          id: f.devuelve_origen_id as string,
          devolucionId: f.devolucion_id as string,
        },
  movimientoId: f.movimiento_id,
  claveDeIdempotencia: f.clave,
  huella: f.huella,
  registradoEn: f.registrado_en,
  registradoPor: personaId(f.registrado_por),
});

export function crearRepositorioDeMovimientosDeDinero(
  db: Kysely<CajaDb>,
): RepositorioDeMovimientosDeDinero {
  const columnas = [
    "d.id as id",
    "d.sucursal_id as sucursal_id",
    "d.sesion_id as sesion_id",
    "d.sentido as sentido",
    sql<string>`d.importe::text`.as("importe"),
    "d.categoria as categoria",
    "d.concepto as concepto",
    "d.motivo as motivo",
    "d.tercero_nombre as tercero_nombre",
    "d.tercero_persona_id as tercero_persona_id",
    "d.referencia as referencia",
    "d.devuelve_a as devuelve_a",
    "d.devuelve_origen_tipo as devuelve_origen_tipo",
    "d.devuelve_origen_id as devuelve_origen_id",
    "d.devolucion_id as devolucion_id",
    "d.movimiento_id as movimiento_id",
    "d.clave as clave",
    "d.huella as huella",
    "d.registrado_en as registrado_en",
    "d.registrado_por as registrado_por",
  ] as const;

  return {
    async insertar(nuevo) {
      const fila = await db
        .insertInto("movimiento_de_dinero")
        .values({
          empresa_id: nuevo.empresa,
          sucursal_id: nuevo.sucursalId,
          sesion_id: nuevo.sesionId,
          sentido: nuevo.sentido,
          importe: importeATexto(nuevo.importe),
          categoria: nuevo.categoria,
          concepto: nuevo.concepto,
          motivo: nuevo.motivo,
          tercero_nombre: nuevo.terceroNombre,
          tercero_persona_id: nuevo.terceroPersonaId,
          referencia: nuevo.referencia,
          devuelve_a: nuevo.devuelveA,
          devuelve_origen_tipo: nuevo.devuelveOrigen?.tipo ?? null,
          devuelve_origen_id: nuevo.devuelveOrigen?.id ?? null,
          devolucion_id: nuevo.devuelveOrigen?.devolucionId ?? null,
          movimiento_id: nuevo.movimientoId,
          clave: nuevo.claveDeIdempotencia,
          huella: nuevo.huella,
          registrado_en: nuevo.registradoEn,
          registrado_por: nuevo.registradoPor,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("movimiento_de_dinero as d")
        .select(columnas)
        .where("d.empresa_id", "=", empresa)
        .where("d.clave", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aGuardado(fila);
    },

    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("movimiento_de_dinero as d")
        .select(columnas)
        .where("d.empresa_id", "=", empresa)
        .where("d.id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aGuardado(fila);
    },

    async deLaJornada(empresa, sucursal, fecha) {
      const filas = await db
        .selectFrom("movimiento_de_dinero as d")
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "d.sesion_id").onRef("s.empresa_id", "=", "d.empresa_id"),
        )
        .select(columnas)
        .where("d.empresa_id", "=", empresa)
        .where("d.sucursal_id", "=", sucursal)
        .where(sql<boolean>`s.fecha_negocio = ${fecha}::date`)
        .orderBy("d.registrado_en")
        .orderBy("d.id")
        .execute();
      return filas.map(aGuardado);
    },

    async devueltoDe(empresa, entradaId) {
      if (!esUuid(entradaId)) return importeDesdeTexto(ARS, "0.00");
      const fila = await db
        .selectFrom("movimiento_de_dinero as d")
        .select(sql<string>`coalesce(sum(d.importe), 0)::text`.as("total"))
        .where("d.empresa_id", "=", empresa)
        .where("d.devuelve_a", "=", entradaId)
        // Vigente = su egreso no tiene una anulación espejo (misma regla que `movimiento_de_dinero_devolvible` en la base).
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
        .executeTakeFirstOrThrow();
      return importeDesdeTexto(ARS, fila.total);
    },

    async devolvibleDeOrigen(empresa, tipo, id) {
      if (!esUuid(id)) return importeDesdeTexto(ARS, "0.00");
      const { rows } = await sql<{ total: string }>`
        select public.movimiento_de_dinero_devolvible_de_origen(${empresa}::uuid, ${tipo}::text, ${id}::uuid)::numeric(18,2)::text as total`.execute(
        db,
      );
      return importeDesdeTexto(ARS, rows[0]?.total ?? "0.00");
    },
  };
}
