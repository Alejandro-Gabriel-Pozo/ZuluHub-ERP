import type { Kysely } from "kysely";
import {
  empresaId,
  personaId,
  traspasoId,
  type EmpresaId,
  type PersonaId,
  type TraspasoId,
} from "../../../primitivas/identificadores/marca";
import type { EstadoGuardadoDeTraspaso, OrigenDeTraspaso, Traspaso } from "../dominio/traspaso";
import type { IdentidadDb } from "./tablas";
import { deLaLista, FORMA_DE_UUID } from "./repositorios-comunes";

const ORIGENES_DE_TRASPASO: readonly OrigenDeTraspaso[] = ["GERENTE", "PLATAFORMA"];
const ESTADOS_DE_TRASPASO: readonly EstadoGuardadoDeTraspaso[] = [
  "PROPUESTO",
  "ACEPTADO",
  "RECHAZADO",
  "CANCELADO",
];

/**
 * Un traspaso tal como está guardado: el del dominio (con su identificador con marca) y la fecha en
 * que se propuso, que la pantalla necesita y el dominio no.
 */
export type TraspasoGuardado = Readonly<
  Omit<Traspaso, "id"> & { id: TraspasoId; propuestoEn: Date }
>;

export interface RepositorioDeTraspasos {
  /** Un traspaso de la empresa (en cualquier estado); `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: string): Promise<TraspasoGuardado | null>;
  /**
   * El traspaso guardado como `PROPUESTO` de la empresa, vigente o vencido (el vencimiento no se
   * guarda). La base admite a lo sumo uno (`traspaso_gerencia_en_curso_uk`).
   */
  enCurso(empresa: EmpresaId): Promise<TraspasoGuardado | null>;
  /**
   * Propone un traspaso con origen `GERENTE`: quien propone es también el saliente. Devuelve el id que
   * generó la base. Que sea el gerente vigente y que el entrante sea un miembro activo lo impone la base.
   */
  proponer(datos: {
    empresaId: EmpresaId;
    proponePor: PersonaId;
    entrante: PersonaId;
    propuestoEn: Date;
    venceEn: Date;
  }): Promise<TraspasoId>;
  /** `PROPUESTO` → `ACEPTADO`, anotando al saliente. `false`: ya no estaba propuesto o cambió de versión. */
  aceptar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
    saliente: PersonaId,
  ): Promise<boolean>;
  /** `PROPUESTO` → `RECHAZADO`. `false`: ya no estaba propuesto o cambió de versión. */
  rechazar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
  ): Promise<boolean>;
  /** `PROPUESTO` → `CANCELADO`, con un motivo (clave) o sin él. `false`: ya no estaba propuesto o cambió de versión. */
  cancelar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
    motivo: string | null,
  ): Promise<boolean>;
}

export function crearRepositorioDeTraspasos(db: Kysely<IdentidadDb>): RepositorioDeTraspasos {
  const columnas = [
    "id",
    "empresa_id",
    "origen",
    "saliente_persona_id",
    "entrante_persona_id",
    "estado",
    "propuesto_en",
    "vence_en",
    "version",
  ] as const;
  const aTraspaso = (fila: {
    id: string;
    empresa_id: string;
    origen: string;
    saliente_persona_id: string | null;
    entrante_persona_id: string;
    estado: string;
    propuesto_en: Date;
    vence_en: Date;
    version: number;
  }): TraspasoGuardado => ({
    id: traspasoId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    origen: deLaLista(ORIGENES_DE_TRASPASO, fila.origen, "origen de traspaso"),
    salientePersonaId:
      fila.saliente_persona_id === null ? null : personaId(fila.saliente_persona_id),
    entrantePersonaId: personaId(fila.entrante_persona_id),
    estado: deLaLista(ESTADOS_DE_TRASPASO, fila.estado, "estado de traspaso"),
    propuestoEn: fila.propuesto_en,
    venceEn: fila.vence_en,
    version: fila.version,
  });
  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ningún traspaso: la base lo rechazaría con
      // un error de formato, y para quien pregunta es un traspaso que no existe.
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("traspaso_gerencia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aTraspaso(fila);
    },

    async enCurso(empresa) {
      const fila = await db
        .selectFrom("traspaso_gerencia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "PROPUESTO")
        .executeTakeFirst();
      return fila === undefined ? null : aTraspaso(fila);
    },

    async proponer(datos) {
      const fila = await db
        .insertInto("traspaso_gerencia")
        .values({
          empresa_id: datos.empresaId,
          origen: "GERENTE",
          propuesto_por: datos.proponePor,
          saliente_persona_id: datos.proponePor,
          entrante_persona_id: datos.entrante,
          propuesto_en: datos.propuestoEn,
          vence_en: datos.venceEn,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return traspasoId(fila.id);
    },

    async aceptar(empresa, id, versionEsperada, resueltoEn, saliente) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "ACEPTADO", resuelto_en: resueltoEn, saliente_persona_id: saliente })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async rechazar(empresa, id, versionEsperada, resueltoEn) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "RECHAZADO", resuelto_en: resueltoEn })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cancelar(empresa, id, versionEsperada, resueltoEn, motivo) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "CANCELADO", resuelto_en: resueltoEn, motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}
