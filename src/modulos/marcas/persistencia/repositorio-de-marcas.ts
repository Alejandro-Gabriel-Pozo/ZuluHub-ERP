import { sql, type Kysely, type Selectable } from "kysely";
import {
  marcaComercialId,
  planId,
  type MarcaComercialId,
} from "../../../primitivas/identificadores/marca";
import { DEFINICION_VACIA, type DefinicionDeMarca } from "../dominio/definicion";
import type { Aspecto } from "../dominio/aspecto";
import type { Tema } from "../dominio/tema";
import { aDominio, type DominioGuardado } from "./repositorios";
import type { DominiosDb, MarcasDb } from "./tablas";

/**
 * Repositorio de marcas y de sus versiones (ADR-005, ADR-009; M5). Cada método tiene una intención y
 * devuelve tipos del dominio. Reglas de este archivo, las mismas del repositorio de dominios:
 *
 *  - Es de PLATAFORMA: solo la plataforma escribe `marca` y `version_de_marca` (y solo un ADMIN).
 *  - Los cambios son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la fila nueva, o `null` si
 *    no la tocaron (otra transacción cambió antes, o no existe): nada de `FOR UPDATE` ni de upserts.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las
 *    traduce a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Quién confirma una versión NO lo elige quien llama: lo escribe `app_actor_plataforma()`, el actor
 *    del contexto firmado, y la política de la base exige que coincida.
 */

export type EstadoDeMarca = "ACTIVA" | "RETIRADA";

/** Una marca tal como está guardada. */
export type MarcaGuardada = Readonly<{
  id: MarcaComercialId;
  codigo: string;
  /** `null`: la principal, o una marca sin padre. */
  marcaPadreId: MarcaComercialId | null;
  nivel: number;
  esPrincipal: boolean;
  estado: EstadoDeMarca;
  version: number;
}>;

/** Una versión de marca tal como está guardada: el borrador (sin número ni vigencia) o una confirmada. */
export type VersionDeMarcaGuardada = Readonly<{
  id: string;
  marcaId: MarcaComercialId;
  /** `null` en el borrador; el número consecutivo de la marca en una confirmada. */
  numero: number | null;
  estado: "BORRADOR" | "CONFIRMADA";
  vigenteDesde: Date | null;
  /** Lo que la versión dice POR SÍ MISMA: un campo vacío hereda de la marca padre. */
  definicion: DefinicionDeMarca;
  reemplazaProgramada: boolean;
  motivo: string | null;
  confirmadaEn: Date | null;
  /** El actor de plataforma que la confirmó (su id). */
  confirmadaPor: string | null;
  /** El candado optimista de la fila (`versionEsperada` del borrador). */
  version: number;
}>;

/** Una versión confirmada: tiene número y vigencia. */
export type VersionConfirmadaDeMarca = VersionDeMarcaGuardada &
  Readonly<{
    numero: number;
    vigenteDesde: Date;
    confirmadaEn: Date;
    confirmadaPor: string;
    motivo: string;
  }>;

/** Lo que se escribe al confirmar un borrador. */
export type ConfirmacionPorEscribir = Readonly<{
  numero: number;
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
  /** El instante de la confirmación (el `ahora` del contexto): la base exige `vigenteDesde >= confirmadaEn - 1 min`. */
  confirmadaEn: Date;
}>;

export interface RepositorioDeMarcas {
  /** Una marca por su id; `null` si no existe. */
  obtener(id: MarcaComercialId): Promise<MarcaGuardada | null>;
  /** Una marca por su código técnico; `null` si no existe. */
  obtenerPorCodigo(codigo: string): Promise<MarcaGuardada | null>;
  /** Todas las marcas, por código. */
  listar(): Promise<readonly MarcaGuardada[]>;
  /**
   * Registra la marca: nace `ACTIVA`, nunca principal, con el nivel que le da su padre. El código
   * repetido, el padre inexistente o retirado y el nivel excedido los impone la base.
   */
  crear(
    alta: Readonly<{ codigo: string; marcaPadreId: MarcaComercialId | null }>,
  ): Promise<MarcaGuardada>;
  /** El borrador de la marca (a lo sumo uno); `null` si no hay. */
  borradorDe(marca: MarcaComercialId): Promise<VersionDeMarcaGuardada | null>;
  /** Las versiones confirmadas de la marca, por número ascendente. */
  confirmadasDe(marca: MarcaComercialId): Promise<readonly VersionConfirmadaDeMarca[]>;
  /** Las versiones confirmadas de todas esas marcas (para listarlas), por marca y número. */
  confirmadasDeLasMarcas(
    marcas: readonly MarcaComercialId[],
  ): Promise<readonly VersionConfirmadaDeMarca[]>;
  /** Los borradores de todas esas marcas. */
  borradoresDeLasMarcas(
    marcas: readonly MarcaComercialId[],
  ): Promise<readonly VersionDeMarcaGuardada[]>;
  /** Abre el borrador con esa definición. Un segundo borrador de la misma marca lo rechaza la base. */
  crearBorrador(
    marca: MarcaComercialId,
    definicion: DefinicionDeMarca,
  ): Promise<VersionDeMarcaGuardada>;
  /** Reemplaza la definición del borrador solo si la versión coincide; `null` si no (otra transacción cambió antes). */
  actualizarBorrador(
    id: string,
    versionEsperada: number,
    definicion: DefinicionDeMarca,
  ): Promise<VersionDeMarcaGuardada | null>;
  /** Confirma el borrador solo si la versión coincide; `null` si no (otra transacción cambió antes o ya no es borrador). */
  confirmar(
    id: string,
    versionEsperada: number,
    confirmacion: ConfirmacionPorEscribir,
  ): Promise<VersionConfirmadaDeMarca | null>;
  /** Los dominios que tienen a esta marca como dueña (los hosts de empresa no entran), por host. */
  dominiosDeLaMarca(marca: MarcaComercialId): Promise<readonly DominioGuardado[]>;
}

type FilaDeMarca = Selectable<MarcasDb["marca"]>;
type FilaDeVersion = Selectable<MarcasDb["version_de_marca"]>;

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function estadoDeMarca(valor: string): EstadoDeMarca {
  if (valor === "ACTIVA" || valor === "RETIRADA") return valor;
  throw new RangeError(`estado de marca desconocido en la base: ${valor}`);
}

function aMarca(fila: FilaDeMarca): MarcaGuardada {
  return {
    id: marcaComercialId(fila.id),
    codigo: fila.codigo,
    marcaPadreId: fila.marca_padre_id === null ? null : marcaComercialId(fila.marca_padre_id),
    nivel: fila.nivel,
    esPrincipal: fila.es_principal,
    estado: estadoDeMarca(fila.estado),
    version: fila.version,
  };
}

/** Lo que la base guarda en una columna `jsonb` de tipo objeto (la forma la impone el CHECK). */
function objetoDe<T extends object>(valor: unknown): T {
  return (typeof valor === "object" && valor !== null && !Array.isArray(valor) ? valor : {}) as T;
}

function aDefinicion(fila: FilaDeVersion): DefinicionDeMarca {
  return {
    ...DEFINICION_VACIA,
    nombreVisible: fila.nombre_visible,
    tema: objetoDe<Tema>(fila.tema),
    aspecto: objetoDe<Aspecto>(fila.aspecto),
    logo: fila.logo,
    vocabulario: objetoDe<Readonly<Record<string, string>>>(fila.vocabulario),
    modulosIniciales: fila.modulos_iniciales,
    planPorDefectoId: fila.plan_por_defecto_id === null ? null : planId(fila.plan_por_defecto_id),
  };
}

function aVersion(fila: FilaDeVersion): VersionDeMarcaGuardada {
  return {
    id: fila.id,
    marcaId: marcaComercialId(fila.marca_id),
    numero: fila.numero,
    estado: fila.estado === "CONFIRMADA" ? "CONFIRMADA" : "BORRADOR",
    vigenteDesde: fila.vigente_desde,
    definicion: aDefinicion(fila),
    reemplazaProgramada: fila.reemplaza_programada,
    motivo: fila.motivo,
    confirmadaEn: fila.confirmada_en,
    confirmadaPor: fila.confirmada_por,
    version: fila.version,
  };
}

/** `confirmada_ck` de la base: una versión CONFIRMADA siempre trae número, vigencia, fecha, actor y motivo. */
function aConfirmada(fila: FilaDeVersion): VersionConfirmadaDeMarca {
  const v = aVersion(fila);
  if (
    v.numero === null ||
    v.vigenteDesde === null ||
    v.confirmadaEn === null ||
    v.confirmadaPor === null ||
    v.motivo === null
  ) {
    throw new RangeError(`la versión de marca ${fila.id} confirmada no está completa`);
  }
  return {
    ...v,
    numero: v.numero,
    vigenteDesde: v.vigenteDesde,
    confirmadaEn: v.confirmadaEn,
    confirmadaPor: v.confirmadaPor,
    motivo: v.motivo,
  };
}

/** Las columnas que el borrador escribe, a partir de una definición. */
function columnasDeLaDefinicion(definicion: DefinicionDeMarca) {
  return {
    nombre_visible: definicion.nombreVisible,
    tema: JSON.stringify(definicion.tema),
    aspecto: JSON.stringify(definicion.aspecto),
    logo: definicion.logo,
    vocabulario: JSON.stringify(definicion.vocabulario),
    modulos_iniciales:
      definicion.modulosIniciales === null ? null : [...definicion.modulosIniciales],
    plan_por_defecto_id: definicion.planPorDefectoId,
  };
}

export function crearRepositorioDeMarcas(db: Kysely<MarcasDb & DominiosDb>): RepositorioDeMarcas {
  return {
    async obtener(id) {
      const fila = await db.selectFrom("marca").selectAll().where("id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aMarca(fila);
    },

    async obtenerPorCodigo(codigo) {
      const fila = await db
        .selectFrom("marca")
        .selectAll()
        .where("codigo", "=", codigo)
        .executeTakeFirst();
      return fila === undefined ? null : aMarca(fila);
    },

    async listar() {
      const filas = await db.selectFrom("marca").selectAll().orderBy("codigo", "asc").execute();
      return filas.map(aMarca);
    },

    async crear(alta) {
      const fila = await db
        .insertInto("marca")
        .values({ codigo: alta.codigo, marca_padre_id: alta.marcaPadreId })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aMarca(fila);
    },

    async borradorDe(marca) {
      const fila = await db
        .selectFrom("version_de_marca")
        .selectAll()
        .where("marca_id", "=", marca)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async confirmadasDe(marca) {
      const filas = await db
        .selectFrom("version_de_marca")
        .selectAll()
        .where("marca_id", "=", marca)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aConfirmada);
    },

    async confirmadasDeLasMarcas(marcas) {
      if (marcas.length === 0) return [];
      const filas = await db
        .selectFrom("version_de_marca")
        .selectAll()
        .where("marca_id", "in", marcas)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("marca_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aConfirmada);
    },

    async borradoresDeLasMarcas(marcas) {
      if (marcas.length === 0) return [];
      const filas = await db
        .selectFrom("version_de_marca")
        .selectAll()
        .where("marca_id", "in", marcas)
        .where("estado", "=", "BORRADOR")
        .execute();
      return filas.map(aVersion);
    },

    async crearBorrador(marca, definicion) {
      const fila = await db
        .insertInto("version_de_marca")
        .values({ marca_id: marca, ...columnasDeLaDefinicion(definicion) })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aVersion(fila);
    },

    async actualizarBorrador(id, versionEsperada, definicion) {
      const fila = await db
        .updateTable("version_de_marca")
        .set(columnasDeLaDefinicion(definicion))
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async confirmar(id, versionEsperada, confirmacion) {
      const fila = await db
        .updateTable("version_de_marca")
        .set({
          estado: "CONFIRMADA",
          numero: confirmacion.numero,
          vigente_desde: confirmacion.vigenteDesde,
          reemplaza_programada: confirmacion.reemplazaProgramada,
          motivo: confirmacion.motivo,
          confirmada_en: confirmacion.confirmadaEn,
          confirmada_por: sql<string>`(select app_actor_plataforma())`,
        })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aConfirmada(fila);
    },

    async dominiosDeLaMarca(marca) {
      const filas = await db
        .selectFrom("dominio")
        .selectAll()
        .where("duenio_marca_id", "=", marca)
        .orderBy("host", "asc")
        .execute();
      return filas.map(aDominio);
    },
  };
}
