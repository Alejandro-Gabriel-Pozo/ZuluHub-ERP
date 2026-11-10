import { sql, type Kysely } from "kysely";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { esUuid } from "../dominio/identificadores";
import type { EstadoDeSesion } from "../estados";
import type { CajaDb } from "./esquema";

/** Una sesión de caja tal como está guardada, con la caja y la sucursal a la que pertenece. */
export type SesionGuardada = Readonly<{
  id: string;
  cajaId: string;
  cajaNombre: string;
  sucursalId: SucursalId;
  estado: EstadoDeSesion;
  /** El sello de la jornada: la fecha de negocio, la hora de corte y la zona con que se abrió. No cambia nunca. */
  fechaDeNegocio: FechaCivil;
  horaDeCorte: string;
  zonaHoraria: string;
  abiertaEn: Date;
  abiertaPor: PersonaId;
  cierreIniciadoEn: Date | null;
  cierreIniciadoPor: PersonaId | null;
  cerradaEn: Date | null;
  cerradaPor: PersonaId | null;
  observacion: string | null;
  /** Lo guardado al abrir: con la clave decide si un reintento es el mismo pedido. */
  huella: string;
}>;

export type SesionNueva = Readonly<{
  empresa: EmpresaId;
  cajaId: string;
  fechaDeNegocio: FechaCivil;
  horaDeCorte: string;
  zonaHoraria: string;
  abiertaEn: Date;
  abiertaPor: PersonaId;
  claveDeIdempotencia: string;
  huella: string;
}>;

export type FiltroDeSesiones = Readonly<{
  empresa: EmpresaId;
  sucursal: SucursalId;
  desde: FechaCivil;
  hasta: FechaCivil;
  limite: number;
}>;

/**
 * Persistencia de las sesiones de caja. Todo corre dentro de la transacción del caso de uso y sin caché. Hay una sola sesión NO cerrada
 * por caja (`sesion_caja_vigente_uk`) y la clave de idempotencia es única por empresa. Una sesión cerrada no tiene `UPDATE` para nadie
 * (política y disparador de la base). Los cambios de estado son UN solo `UPDATE` (sin savepoints: los disparadores de arqueo miran que
 * la sesión haya cambiado en la transacción de nivel superior).
 */
export interface RepositorioDeSesiones {
  /** Una sesión de la empresa; `null` si no existe o es de otra empresa (la RLS oculta las ajenas). */
  obtener(empresa: EmpresaId, id: string): Promise<SesionGuardada | null>;
  /** La sesión que se abrió con esa clave de idempotencia, si hay. */
  obtenerPorClave(empresa: EmpresaId, clave: string): Promise<SesionGuardada | null>;
  /** La sesión no cerrada (abierta o en cierre) de la caja, si hay. */
  vigenteDeLaCaja(empresa: EmpresaId, cajaId: string): Promise<SesionGuardada | null>;
  /**
   * Lo mismo, tomando la fila de la sesión con `FOR SHARE` hasta el fin de la transacción (e3 §3.5, paso 3): `iniciarCierre` y `cerrar`
   * (UPDATE) esperan al cobro en vuelo, y el cobro que llega después los ve. Solo la sesión: la caja no se bloquea.
   */
  vigenteDeLaCajaCompartida(empresa: EmpresaId, cajaId: string): Promise<SesionGuardada | null>;
  /** Alta de una sesión `ABIERTA` con su sello. Devuelve el id que genera la base. */
  abrir(nueva: SesionNueva): Promise<string>;
  /** `ABIERTA → EN_CIERRE`; `false` si no cambió ninguna fila (no estaba abierta). */
  iniciarCierre(empresa: EmpresaId, id: string, persona: PersonaId, ahora: Date): Promise<boolean>;
  /** `EN_CIERRE → ABIERTA` (borra las marcas del cierre); `false` si no cambió ninguna fila. */
  cancelarCierre(empresa: EmpresaId, id: string): Promise<boolean>;
  /**
   * `ABIERTA` o `EN_CIERRE → CERRADA`. Desde `ABIERTA` (cierre directo) el inicio del cierre toma los valores del cierre; desde
   * `EN_CIERRE` queda quien lo inició y cuándo. `false` si no cambió ninguna fila (no estaba en `desde`).
   */
  cerrar(
    empresa: EmpresaId,
    id: string,
    desde: "ABIERTA" | "EN_CIERRE",
    persona: PersonaId,
    ahora: Date,
    observacion: string | null,
  ): Promise<boolean>;
  /** Las sesiones de una sucursal entre dos fechas de negocio (inclusive), de la más nueva a la más vieja. Solo lectura. */
  listar(filtro: FiltroDeSesiones): Promise<SesionGuardada[]>;
}

type FilaDeSesion = Readonly<{
  id: string;
  caja_id: string;
  caja_nombre: string;
  sucursal_id: string;
  estado: EstadoDeSesion;
  fecha_negocio: string;
  hora_de_corte: string;
  zona_horaria: string;
  abierta_en: Date;
  abierta_por: string;
  cierre_iniciado_en: Date | null;
  cierre_iniciado_por: string | null;
  cerrada_en: Date | null;
  cerrada_por: string | null;
  observacion: string | null;
  huella: string;
}>;

function aSesion(fila: FilaDeSesion): SesionGuardada {
  return {
    id: fila.id,
    cajaId: fila.caja_id,
    cajaNombre: fila.caja_nombre,
    sucursalId: sucursalId(fila.sucursal_id),
    estado: fila.estado,
    fechaDeNegocio: fila.fecha_negocio as FechaCivil,
    horaDeCorte: fila.hora_de_corte,
    zonaHoraria: fila.zona_horaria,
    abiertaEn: fila.abierta_en,
    abiertaPor: personaId(fila.abierta_por),
    cierreIniciadoEn: fila.cierre_iniciado_en,
    cierreIniciadoPor:
      fila.cierre_iniciado_por === null ? null : personaId(fila.cierre_iniciado_por),
    cerradaEn: fila.cerrada_en,
    cerradaPor: fila.cerrada_por === null ? null : personaId(fila.cerrada_por),
    observacion: fila.observacion,
    huella: fila.huella,
  };
}

export function crearRepositorioDeSesiones(db: Kysely<CajaDb>): RepositorioDeSesiones {
  const seleccionar = () =>
    db
      .selectFrom("sesion_caja as s")
      .innerJoin("caja as c", (unir) =>
        unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
      )
      .select([
        "s.id as id",
        "s.caja_id as caja_id",
        "c.nombre as caja_nombre",
        "c.sucursal_id as sucursal_id",
        "s.estado as estado",
        sql<string>`s.fecha_negocio::text`.as("fecha_negocio"),
        sql<string>`to_char(s.hora_de_corte, 'HH24:MI')`.as("hora_de_corte"),
        "s.zona_horaria as zona_horaria",
        "s.abierta_en as abierta_en",
        "s.abierta_por as abierta_por",
        "s.cierre_iniciado_en as cierre_iniciado_en",
        "s.cierre_iniciado_por as cierre_iniciado_por",
        "s.cerrada_en as cerrada_en",
        "s.cerrada_por as cerrada_por",
        "s.observacion as observacion",
        "s.huella as huella",
      ]);

  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ninguna sesión: la base lo rechazaría con un error de formato.
      if (!esUuid(id)) return null;
      const fila = await seleccionar()
        .where("s.empresa_id", "=", empresa)
        .where("s.id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aSesion(fila);
    },

    async obtenerPorClave(empresa, clave) {
      const fila = await seleccionar()
        .where("s.empresa_id", "=", empresa)
        .where("s.clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aSesion(fila);
    },

    async vigenteDeLaCaja(empresa, cajaId) {
      const fila = await seleccionar()
        .where("s.empresa_id", "=", empresa)
        .where("s.caja_id", "=", cajaId)
        .where("s.estado", "<>", "CERRADA")
        .executeTakeFirst();
      return fila === undefined ? null : aSesion(fila);
    },

    async vigenteDeLaCajaCompartida(empresa, cajaId) {
      const fila = await seleccionar()
        .where("s.empresa_id", "=", empresa)
        .where("s.caja_id", "=", cajaId)
        .where("s.estado", "<>", "CERRADA")
        .forShare("s")
        .executeTakeFirst();
      return fila === undefined ? null : aSesion(fila);
    },

    async abrir(nueva) {
      const fila = await db
        .insertInto("sesion_caja")
        .values({
          empresa_id: nueva.empresa,
          caja_id: nueva.cajaId,
          fecha_negocio: nueva.fechaDeNegocio,
          hora_de_corte: nueva.horaDeCorte,
          zona_horaria: nueva.zonaHoraria,
          abierta_en: nueva.abiertaEn,
          abierta_por: nueva.abiertaPor,
          clave_idempotencia: nueva.claveDeIdempotencia,
          huella: nueva.huella,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async iniciarCierre(empresa, id, persona, ahora) {
      const resultado = await db
        .updateTable("sesion_caja")
        .set({ estado: "EN_CIERRE", cierre_iniciado_en: ahora, cierre_iniciado_por: persona })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return resultado.numUpdatedRows === 1n;
    },

    async cancelarCierre(empresa, id) {
      const resultado = await db
        .updateTable("sesion_caja")
        .set({ estado: "ABIERTA", cierre_iniciado_en: null, cierre_iniciado_por: null })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "EN_CIERRE")
        .executeTakeFirst();
      return resultado.numUpdatedRows === 1n;
    },

    async cerrar(empresa, id, desde, persona, ahora, observacion) {
      const cambios = {
        estado: "CERRADA",
        cerrada_en: ahora,
        cerrada_por: persona,
        observacion,
      } as const;
      const resultado = await db
        .updateTable("sesion_caja")
        .set(
          desde === "ABIERTA"
            ? { ...cambios, cierre_iniciado_en: ahora, cierre_iniciado_por: persona }
            : cambios,
        )
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", desde)
        .executeTakeFirst();
      return resultado.numUpdatedRows === 1n;
    },

    async listar(filtro) {
      const filas = await seleccionar()
        .where("s.empresa_id", "=", filtro.empresa)
        .where("c.sucursal_id", "=", filtro.sucursal)
        .where(
          sql<boolean>`s.fecha_negocio between ${filtro.desde}::date and ${filtro.hasta}::date`,
        )
        .orderBy("s.fecha_negocio", "desc")
        .orderBy("s.abierta_en", "desc")
        .orderBy("s.id")
        .limit(filtro.limite)
        .execute();
      return filas.map(aSesion);
    },
  };
}
