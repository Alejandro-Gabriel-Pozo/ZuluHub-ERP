import { sql, type Kysely } from "kysely";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { Severidad } from "../aporte-al-cierre";
import type { Jornada } from "../dominio/jornada";
import type { EstadoDeJornada } from "../estados";
import type { CierreDb } from "./esquema";

/** Un control tal como quedó guardado al cerrar la jornada. */
export type ControlGuardado = Readonly<{
  modulo: string;
  clave: string;
  severidad: Severidad;
  cantidad: number;
  reconocido: boolean;
  reconocidoEn: Date | null;
  reconocidoPor: PersonaId | null;
  texto: string | null;
}>;

/** Un control a guardar al cerrar: el `reconocido_en/por` los pone el cierre (el `ahora` y la persona del contexto). */
export type ControlAGuardar = Readonly<{
  modulo: string;
  clave: string;
  severidad: Severidad;
  cantidad: number;
  reconocido: boolean;
  texto: string | null;
}>;

export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClaveDeJornada = Readonly<{
  empresa: EmpresaId;
  sucursal: SucursalId;
  fecha: FechaCivil;
}>;

/**
 * Persistencia de la jornada y de la foto de sus controles. Todo corre dentro de la transacción del caso de uso; ninguna lectura usa
 * caché. Los bloqueos son parte del contrato: `FOR UPDATE` (quien cambia el estado) y `FOR SHARE` (quien tiene actividad en la jornada)
 * se esperan entre sí, y bajo `SERIALIZABLE` la lectura es parte de la verificación de conflictos (E3b §3.7).
 */
export interface RepositorioDeJornadas {
  /**
   * La jornada, creándola si todavía no existe (`INSERT ... ON CONFLICT DO NOTHING`), leída con `FOR SHARE`: mientras esta transacción
   * no termine, nadie puede pasarla de estado (iniciar la auditoría espera, o la serializable repite). Quien la llama decide con el
   * estado que lee.
   */
  asegurarYBloquearCompartida(clave: ClaveDeJornada): Promise<Jornada>;
  /** La jornada leída con `FOR SHARE`; `null` si no existe o no es de la empresa. */
  bloquearCompartida(clave: ClaveDeJornada): Promise<Jornada | null>;
  /** La jornada leída con `FOR UPDATE`: quien inicia, cancela o cierra se serializa con todos los demás. `null` si no existe. */
  bloquearParaCambiar(clave: ClaveDeJornada): Promise<Jornada | null>;
  /** Lectura simple (sin bloqueo). */
  obtener(clave: ClaveDeJornada): Promise<Jornada | null>;
  /** Las jornadas de una sucursal entre dos fechas (inclusive), de la más nueva a la más vieja. */
  listar(
    empresa: EmpresaId,
    sucursal: SucursalId,
    desde: FechaCivil,
    hasta: FechaCivil,
    limite: number,
  ): Promise<Jornada[]>;
  /** `ABIERTA → EN_AUDITORIA`. La jornada tiene que estar tomada con `FOR UPDATE`; si no cambia exactamente una fila, lanza. */
  iniciarAuditoria(clave: ClaveDeJornada, persona: PersonaId, ahora: Date): Promise<void>;
  /** `EN_AUDITORIA → ABIERTA` (borra las marcas de la auditoría). Mismo contrato. */
  cancelarAuditoria(clave: ClaveDeJornada): Promise<void>;
  /** `EN_AUDITORIA → CERRADA`. Mismo contrato. */
  cerrar(
    clave: ClaveDeJornada,
    persona: PersonaId,
    ahora: Date,
    huella: string,
    observacion: string | null,
  ): Promise<void>;
  /** La foto de controles de una jornada cerrada, ordenada por módulo y clave. */
  controlesGuardados(clave: ClaveDeJornada): Promise<ControlGuardado[]>;
  /**
   * Guarda la foto de controles (solo inserción), DESPUÉS de pasar la jornada a `CERRADA` en la misma transacción: la base lo exige.
   * `reconocidoPor` es la persona que cierra y `reconocidoEn` el `ahora`, para los controles reconocidos.
   */
  guardarControles(
    clave: ClaveDeJornada,
    controles: readonly ControlAGuardar[],
    reconoce: Readonly<{ persona: PersonaId; ahora: Date }>,
  ): Promise<void>;
}

type FilaDeJornada = Readonly<{
  empresa_id: string;
  sucursal_id: string;
  fecha_negocio: string;
  estado: EstadoDeJornada;
  auditoria_iniciada_en: Date | null;
  auditoria_iniciada_por: string | null;
  cerrada_en: Date | null;
  cerrada_por: string | null;
  huella_de_cierre: string | null;
  observacion: string | null;
  version: number;
}>;

function aJornada(fila: FilaDeJornada): Jornada {
  return {
    empresaId: empresaId(fila.empresa_id),
    sucursalId: sucursalId(fila.sucursal_id),
    fechaDeNegocio: fila.fecha_negocio as FechaCivil,
    estado: fila.estado,
    auditoriaIniciadaEn: fila.auditoria_iniciada_en,
    auditoriaIniciadaPor:
      fila.auditoria_iniciada_por === null ? null : personaId(fila.auditoria_iniciada_por),
    cerradaEn: fila.cerrada_en,
    cerradaPor: fila.cerrada_por === null ? null : personaId(fila.cerrada_por),
    huellaDeCierre: fila.huella_de_cierre,
    observacion: fila.observacion,
    version: fila.version,
  };
}

/** Un único cambio de estado: si no tocó exactamente una fila, la jornada no estaba tomada como se debía y no se sigue. */
function exigirUnaFila(
  resultado: Readonly<{ numUpdatedRows: bigint }> | undefined,
  que: string,
): void {
  if (resultado === undefined || resultado.numUpdatedRows !== 1n) {
    throw new Error(`${que}: la jornada no cambió exactamente una fila`);
  }
}

export function crearRepositorioDeJornadas(db: Kysely<CierreDb>): RepositorioDeJornadas {
  const seleccionar = (clave: ClaveDeJornada) =>
    db
      .selectFrom("jornada_de_sucursal")
      .select([
        "empresa_id",
        "sucursal_id",
        sql<string>`fecha_negocio::text`.as("fecha_negocio"),
        "estado",
        "auditoria_iniciada_en",
        "auditoria_iniciada_por",
        "cerrada_en",
        "cerrada_por",
        "huella_de_cierre",
        "observacion",
        "version",
      ])
      .where("empresa_id", "=", clave.empresa)
      .where("sucursal_id", "=", clave.sucursal)
      .where("fecha_negocio", "=", clave.fecha);
  const alcance = (clave: ClaveDeJornada) =>
    sql<boolean>`empresa_id = ${clave.empresa} and sucursal_id = ${clave.sucursal} and fecha_negocio = ${clave.fecha}::date`;

  return {
    async asegurarYBloquearCompartida(clave) {
      await db
        .insertInto("jornada_de_sucursal")
        .values({
          empresa_id: clave.empresa,
          sucursal_id: clave.sucursal,
          fecha_negocio: clave.fecha,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const fila = await seleccionar(clave).forShare().executeTakeFirst();
      // Recién creada o ya existente, la fila tiene que verse: si no, la política de la base la ocultó (empresa que no opera).
      if (fila === undefined)
        throw new Error("la jornada asegurada no es visible para el contexto");
      return aJornada(fila);
    },

    async bloquearCompartida(clave) {
      const fila = await seleccionar(clave).forShare().executeTakeFirst();
      return fila === undefined ? null : aJornada(fila);
    },

    async bloquearParaCambiar(clave) {
      const fila = await seleccionar(clave).forUpdate().executeTakeFirst();
      return fila === undefined ? null : aJornada(fila);
    },

    async obtener(clave) {
      const fila = await seleccionar(clave).executeTakeFirst();
      return fila === undefined ? null : aJornada(fila);
    },

    async listar(empresa, sucursal, desde, hasta, limite) {
      const filas = await db
        .selectFrom("jornada_de_sucursal")
        .select([
          "empresa_id",
          "sucursal_id",
          sql<string>`fecha_negocio::text`.as("fecha_negocio"),
          "estado",
          "auditoria_iniciada_en",
          "auditoria_iniciada_por",
          "cerrada_en",
          "cerrada_por",
          "huella_de_cierre",
          "observacion",
          "version",
        ])
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where("fecha_negocio", ">=", desde)
        .where("fecha_negocio", "<=", hasta)
        .orderBy("fecha_negocio", "desc")
        .limit(limite)
        .execute();
      return filas.map(aJornada);
    },

    async iniciarAuditoria(clave, persona, ahora) {
      const resultado = await db
        .updateTable("jornada_de_sucursal")
        .set({
          estado: "EN_AUDITORIA",
          auditoria_iniciada_en: ahora,
          auditoria_iniciada_por: persona,
        })
        .where(alcance(clave))
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      exigirUnaFila(resultado, "iniciar la auditoría");
    },

    async cancelarAuditoria(clave) {
      const resultado = await db
        .updateTable("jornada_de_sucursal")
        .set({ estado: "ABIERTA", auditoria_iniciada_en: null, auditoria_iniciada_por: null })
        .where(alcance(clave))
        .where("estado", "=", "EN_AUDITORIA")
        .executeTakeFirst();
      exigirUnaFila(resultado, "cancelar la auditoría");
    },

    async cerrar(clave, persona, ahora, huella, observacion) {
      const resultado = await db
        .updateTable("jornada_de_sucursal")
        .set({
          estado: "CERRADA",
          cerrada_en: ahora,
          cerrada_por: persona,
          huella_de_cierre: huella,
          observacion,
        })
        .where(alcance(clave))
        .where("estado", "=", "EN_AUDITORIA")
        .executeTakeFirst();
      exigirUnaFila(resultado, "cerrar la jornada");
    },

    async controlesGuardados(clave) {
      const filas = await db
        .selectFrom("control_de_jornada_cerrada")
        .select([
          "modulo",
          "clave",
          "severidad",
          "cantidad",
          "reconocido",
          "reconocido_en",
          "reconocido_por",
          "texto",
        ])
        .where("empresa_id", "=", clave.empresa)
        .where("sucursal_id", "=", clave.sucursal)
        .where("fecha_negocio", "=", clave.fecha)
        .orderBy("modulo")
        .orderBy("clave")
        .execute();
      return filas.map((fila) => ({
        modulo: fila.modulo,
        clave: fila.clave,
        severidad: fila.severidad,
        cantidad: fila.cantidad,
        reconocido: fila.reconocido,
        reconocidoEn: fila.reconocido_en,
        reconocidoPor: fila.reconocido_por === null ? null : personaId(fila.reconocido_por),
        texto: fila.texto,
      }));
    },

    async guardarControles(clave, controles, reconoce) {
      if (controles.length === 0) return;
      await db
        .insertInto("control_de_jornada_cerrada")
        .values(
          controles.map((control) => ({
            empresa_id: clave.empresa,
            sucursal_id: clave.sucursal,
            fecha_negocio: clave.fecha,
            modulo: control.modulo,
            clave: control.clave,
            severidad: control.severidad,
            cantidad: control.cantidad,
            reconocido: control.reconocido,
            reconocido_en: control.reconocido ? reconoce.ahora : null,
            reconocido_por: control.reconocido ? reconoce.persona : null,
            texto: control.texto,
          })),
        )
        .execute();
    },
  };
}
