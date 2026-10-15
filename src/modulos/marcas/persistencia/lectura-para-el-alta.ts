import { sql, type Kysely } from "kysely";
import {
  marcaComercialId,
  planId,
  type MarcaComercialId,
} from "../../../primitivas/identificadores/marca";
import type { DefinicionDeMarca } from "../dominio/definicion";
import type { Host } from "../dominio/host";
import type { Tema } from "../dominio/tema";
import { versionVigente } from "../dominio/vigencia";
import type { Vocabulario } from "../../../capacidades/vocabulario/vocabulario";

/**
 * Lo que el alta de una empresa (marcas y planes §B.10, tramo M6) necesita saber de una marca para
 * decidir con qué nace la empresa: si se la puede usar, sus módulos iniciales, su plan por defecto y si su
 * mail puede salir con su propia identidad. Solo lee, con la conexión de PLATAFORMA (que ve todo lo de
 * marcas bajo un actor vigente); no escribe nada y no atrapa ninguna restricción.
 */

/** Las tablas que lee, con solo las columnas que pide (plataforma tiene `SELECT` sobre todas, 0007). */
export type LecturaParaElAltaDb = {
  marca: { id: string; marca_padre_id: string | null; es_principal: boolean; estado: string };
  version_de_marca: {
    marca_id: string;
    numero: number | null;
    vigente_desde: Date | null;
    estado: string;
    nombre_visible: string | null;
    tema: unknown;
    logo: string | null;
    vocabulario: unknown;
    modulos_iniciales: string[] | null;
    plan_por_defecto_id: string | null;
  };
  dominio: {
    host: string;
    duenio_marca_id: string | null;
    superficie: string;
    es_canonico: boolean;
    estado: string;
  };
};

/** Lo leído de la marca; el dominio del alta (`decidirMarcaDelAlta`) decide con esto. */
export type DatosDeMarcaParaElAlta = Readonly<{
  marcaId: MarcaComercialId;
  /** `RETIRADA` no admite altas nuevas. */
  estado: "ACTIVA" | "RETIRADA";
  esPrincipal: boolean;
  /**
   * La versión vigente a `ahora` de la marca y de sus ancestros ACTIVOS, de la marca hacia arriba (a lo
   * sumo tres eslabones). `null` en un eslabón: no tiene ninguna versión confirmada ya vigente. Un
   * ancestro retirado corta la cadena, igual que en la lectura pública (la herencia no pasa por él).
   */
  cadena: readonly (DefinicionDeMarca | null)[];
  /** El host canónico ACTIVO de la aplicación de la PROPIA marca (no se hereda), o `null`. */
  hostCanonico: Host | null;
}>;

export interface LecturaDeMarcaParaElAlta {
  /** `null`: la marca no existe (o no se ve). Una sola foto de la base: la de la transacción. */
  delAlta(marca: MarcaComercialId, ahora: Date): Promise<DatosDeMarcaParaElAlta | null>;
}

/** La base limita el nivel a 2: la cadena llega a tres marcas y se corta ahí por si acaso. */
const ESLABONES_MAXIMOS_DE_LA_CADENA = 3;

function estadoDeLaBase(estado: string): "ACTIVA" | "RETIRADA" {
  // `marca_estado_ck` no deja pasar otro valor: si llega uno distinto, algo se rompió.
  if (estado !== "ACTIVA" && estado !== "RETIRADA") {
    throw new RangeError(`estado de marca desconocido en la base: ${estado}`);
  }
  return estado;
}

export function crearLecturaDeMarcaParaElAlta(
  db: Kysely<LecturaParaElAltaDb>,
): LecturaDeMarcaParaElAlta {
  return {
    async delAlta(marca, ahora) {
      const propia = await db
        .selectFrom("marca")
        .select(["id", "es_principal", "estado"])
        .where("id", "=", marca)
        .executeTakeFirst();
      if (propia === undefined) return null;

      // La marca y sus ancestros ACTIVOS, de la marca hacia arriba.
      const filas = await sql<{ id: string }>`
        with recursive cadena (id, marca_padre_id, profundidad) as (
          select m.id, m.marca_padre_id, 0 from marca m where m.id = ${marca}
          union all
          select p.id, p.marca_padre_id, c.profundidad + 1
            from marca p join cadena c on p.id = c.marca_padre_id
           where c.profundidad + 1 < ${ESLABONES_MAXIMOS_DE_LA_CADENA} and p.estado = 'ACTIVA'
        )
        select id from cadena order by profundidad`.execute(db);
      const ids = filas.rows.map((fila) => fila.id);

      const versiones = await db
        .selectFrom("version_de_marca")
        .select([
          "marca_id",
          "numero",
          "vigente_desde",
          "nombre_visible",
          "tema",
          "logo",
          "vocabulario",
          "modulos_iniciales",
          "plan_por_defecto_id",
        ])
        .where("marca_id", "in", ids)
        .where("estado", "=", "CONFIRMADA")
        .execute();

      const definicionVigenteDe = (id: string): DefinicionDeMarca | null => {
        // `version_de_marca_confirmada_ck`: una versión confirmada tiene número y vigencia.
        const candidatas = versiones.flatMap((v) =>
          v.marca_id !== id || v.numero === null || v.vigente_desde === null
            ? []
            : [{ numero: v.numero, vigenteDesde: v.vigente_desde, fila: v }],
        );
        const vigente = versionVigente(candidatas, ahora);
        if (vigente === null) return null;
        const v = vigente.fila;
        return {
          nombreVisible: v.nombre_visible,
          // La base impone la forma (`tema_valido`, `vocabulario_valido`, la ruta del logo): por eso el cast.
          tema: v.tema as Tema,
          logo: v.logo,
          vocabulario: v.vocabulario as Vocabulario,
          modulosIniciales: v.modulos_iniciales,
          planPorDefectoId: v.plan_por_defecto_id === null ? null : planId(v.plan_por_defecto_id),
        };
      };

      const canonico = await db
        .selectFrom("dominio")
        .select("host")
        .where("duenio_marca_id", "=", marca)
        .where("superficie", "=", "APP")
        .where("es_canonico", "=", true)
        .where("estado", "=", "ACTIVO")
        .limit(1)
        .executeTakeFirst();

      return {
        marcaId: marcaComercialId(propia.id),
        estado: estadoDeLaBase(propia.estado),
        esPrincipal: propia.es_principal,
        cadena: ids.map(definicionVigenteDe),
        // El CHECK `dominio_host_ck` garantiza la forma de un host normalizado.
        hostCanonico: canonico === undefined ? null : (canonico.host as Host),
      };
    },
  };
}
