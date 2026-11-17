import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type {
  EstadoDeTrabajo,
  PapelEnMm,
  ResultadoDeIntento,
  TipoDeDocumento,
  UsoDeImpresora,
} from "../dominio/impresion";
import type { ComandasDb } from "./esquema";

type Db = Kysely<ComandasDb>;

export type Impresora = Readonly<{
  id: string;
  sucursalId: string;
  nombre: string;
  uso: UsoDeImpresora;
  papelMm: PapelEnMm;
  activa: boolean;
  version: number;
}>;

export type AltaDeImpresora = Readonly<{
  id: string;
  sucursalId: string;
  nombre: string;
  uso: UsoDeImpresora;
  papelMm: PapelEnMm;
  creadaPor: PersonaId;
  creadaEn: Date;
}>;

export type Trabajo = Readonly<{
  id: string;
  sucursalId: string;
  impresoraId: string | null;
  documentoTipo: TipoDeDocumento;
  documentoId: string;
  esCopia: boolean;
  estado: EstadoDeTrabajo;
  intentos: number;
  clave: string;
  huella: string;
  solicitadoPor: PersonaId;
  solicitadoEn: Date;
}>;

export type AltaDeTrabajo = Readonly<{
  id: string;
  sucursalId: string;
  impresoraId: string | null;
  documentoTipo: TipoDeDocumento;
  documentoId: string;
  esCopia: boolean;
  clave: string;
  huella: string;
  solicitadoPor: PersonaId;
  solicitadoEn: Date;
}>;

export type Intento = Readonly<{ numero: number; resultado: ResultadoDeIntento }>;

/** Persistencia de impresoras, trabajos de impresión e intentos (0038, E7 §3.2). Dentro de la transacción del caso de uso; siempre por empresa. */
export interface RepositorioDeImpresion {
  insertarImpresora(empresa: EmpresaId, alta: AltaDeImpresora): Promise<boolean>;
  impresoraPorId(empresa: EmpresaId, id: string): Promise<Impresora | null>;
  impresorasDeSucursal(
    empresa: EmpresaId,
    sucursal: string,
    filtro?: Readonly<{ incluirInactivas?: boolean; uso?: UsoDeImpresora }>,
  ): Promise<Impresora[]>;
  /** `UPDATE … WHERE version = esperada` (si se pidió): `false` si cambió en el medio. */
  actualizarImpresora(
    empresa: EmpresaId,
    id: string,
    cambios: Readonly<{
      nombre?: string;
      uso?: UsoDeImpresora;
      papelMm?: PapelEnMm;
      activa?: boolean;
    }>,
    versionEsperada?: number,
  ): Promise<boolean>;
  trabajoOriginalDe(
    empresa: EmpresaId,
    tipo: TipoDeDocumento,
    documentoId: string,
  ): Promise<Trabajo | null>;
  trabajoPorId(empresa: EmpresaId, id: string): Promise<Trabajo | null>;
  trabajoPorClave(empresa: EmpresaId, clave: string): Promise<Trabajo | null>;
  trabajosDeDocumento(empresa: EmpresaId, documentoId: string): Promise<Trabajo[]>;
  /** `INSERT … ON CONFLICT DO NOTHING`: `false` si el original ya existía (única parcial) o el id/clave ya estaban. */
  insertarTrabajo(empresa: EmpresaId, alta: AltaDeTrabajo): Promise<boolean>;
  /** «Reintentar»: `FALLIDA → PENDIENTE` con un intento más (el mismo trabajo); `false` si ya no estaba fallida. */
  reintentar(empresa: EmpresaId, id: string): Promise<boolean>;
  /** `INSERT … ON CONFLICT DO NOTHING`: `false` si ese intento ya tenía resultado. */
  insertarIntento(
    empresa: EmpresaId,
    intento: Readonly<{
      trabajoId: string;
      numero: number;
      resultado: ResultadoDeIntento;
      declaradoPor: PersonaId;
      declaradoEn: Date;
    }>,
  ): Promise<boolean>;
  intentoDe(empresa: EmpresaId, trabajoId: string, numero: number): Promise<Intento | null>;
}

const aImpresora = (f: {
  id: string;
  sucursal_id: string;
  nombre: string;
  uso: UsoDeImpresora;
  papel_mm: number;
  activa: boolean;
  version: number;
}): Impresora => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  nombre: f.nombre,
  uso: f.uso,
  papelMm: f.papel_mm as PapelEnMm,
  activa: f.activa,
  version: f.version,
});

const aTrabajo = (f: {
  id: string;
  sucursal_id: string;
  impresora_id: string | null;
  documento_tipo: TipoDeDocumento;
  documento_id: string;
  es_copia: boolean;
  estado: EstadoDeTrabajo;
  intentos: number;
  clave: string;
  huella: string;
  solicitado_por: string;
  solicitado_en: Date;
}): Trabajo => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  impresoraId: f.impresora_id,
  documentoTipo: f.documento_tipo,
  documentoId: f.documento_id,
  esCopia: f.es_copia,
  estado: f.estado,
  intentos: f.intentos,
  clave: f.clave,
  huella: f.huella,
  solicitadoPor: f.solicitado_por as PersonaId,
  solicitadoEn: f.solicitado_en,
});

export function crearRepositorioDeImpresion(db: Db): RepositorioDeImpresion {
  const seleccionarImpresora = () =>
    db
      .selectFrom("impresora")
      .select(["id", "sucursal_id", "nombre", "uso", "papel_mm", "activa", "version"]);
  const seleccionarTrabajo = () =>
    db
      .selectFrom("trabajo_de_impresion")
      .select([
        "id",
        "sucursal_id",
        "impresora_id",
        "documento_tipo",
        "documento_id",
        "es_copia",
        "estado",
        "intentos",
        "clave",
        "huella",
        "solicitado_por",
        "solicitado_en",
      ]);

  return {
    async insertarImpresora(empresa, alta) {
      const fila = await db
        .insertInto("impresora")
        .values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          nombre: alta.nombre,
          uso: alta.uso,
          papel_mm: alta.papelMm,
          creada_por: alta.creadaPor,
          creada_en: alta.creadaEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },

    async impresoraPorId(empresa, id) {
      const fila = await seleccionarImpresora()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aImpresora(fila);
    },

    async impresorasDeSucursal(empresa, sucursal, filtro = {}) {
      let q = seleccionarImpresora()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal);
      if (filtro.incluirInactivas !== true) q = q.where("activa", "=", true);
      if (filtro.uso !== undefined) q = q.where("uso", "=", filtro.uso);
      return (await q.orderBy("nombre").orderBy("id").execute()).map(aImpresora);
    },

    async actualizarImpresora(empresa, id, cambios, versionEsperada) {
      const valores: Record<string, unknown> = {};
      if (cambios.nombre !== undefined) valores["nombre"] = cambios.nombre;
      if (cambios.uso !== undefined) valores["uso"] = cambios.uso;
      if (cambios.papelMm !== undefined) valores["papel_mm"] = cambios.papelMm;
      if (cambios.activa !== undefined) valores["activa"] = cambios.activa;
      let q = db
        .updateTable("impresora")
        .set(valores)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id);
      if (versionEsperada !== undefined) q = q.where("version", "=", versionEsperada);
      return (await q.executeTakeFirst()).numUpdatedRows === 1n;
    },

    async trabajoOriginalDe(empresa, tipo, documentoId) {
      const fila = await seleccionarTrabajo()
        .where("empresa_id", "=", empresa)
        .where("documento_tipo", "=", tipo)
        .where("documento_id", "=", documentoId)
        .where("es_copia", "=", false)
        .executeTakeFirst();
      return fila === undefined ? null : aTrabajo(fila);
    },

    async trabajoPorId(empresa, id) {
      const fila = await seleccionarTrabajo()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aTrabajo(fila);
    },

    async trabajoPorClave(empresa, clave) {
      const fila = await seleccionarTrabajo()
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aTrabajo(fila);
    },

    async trabajosDeDocumento(empresa, documentoId) {
      const filas = await seleccionarTrabajo()
        .where("empresa_id", "=", empresa)
        .where("documento_id", "=", documentoId)
        .orderBy("solicitado_en")
        .orderBy("id")
        .execute();
      return filas.map(aTrabajo);
    },

    async insertarTrabajo(empresa, alta) {
      const fila = await db
        .insertInto("trabajo_de_impresion")
        .values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          impresora_id: alta.impresoraId,
          documento_tipo: alta.documentoTipo,
          documento_id: alta.documentoId,
          es_copia: alta.esCopia,
          clave: alta.clave,
          huella: alta.huella,
          solicitado_por: alta.solicitadoPor,
          solicitado_en: alta.solicitadoEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },

    async reintentar(empresa, id) {
      const r = await db
        .updateTable("trabajo_de_impresion")
        .set({ estado: "PENDIENTE", intentos: sql<number>`intentos + 1` })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "FALLIDA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async insertarIntento(empresa, intento) {
      const fila = await db
        .insertInto("intento_de_impresion")
        .values({
          empresa_id: empresa,
          trabajo_id: intento.trabajoId,
          numero: intento.numero,
          resultado: intento.resultado,
          declarado_por: intento.declaradoPor,
          declarado_en: intento.declaradoEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("numero")
        .executeTakeFirst();
      return fila !== undefined;
    },

    async intentoDe(empresa, trabajoId, numero) {
      const fila = await db
        .selectFrom("intento_de_impresion")
        .select(["numero", "resultado"])
        .where("empresa_id", "=", empresa)
        .where("trabajo_id", "=", trabajoId)
        .where("numero", "=", numero)
        .executeTakeFirst();
      return fila === undefined ? null : fila;
    },
  };
}
