import { type Kysely } from "kysely";
import {
  empresaId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { versionId, type VersionId } from "../dominio/identificadores";
import type {
  ReglaDeEmisor,
  VersionGuardadaDeReglaDeEmisor,
} from "../dominio/resolucion-de-emisor";
import {
  exigir,
  serializarAltaDeId,
  type ResultadoDeAlta,
  type ErrorDeAlta,
} from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Repositorio de la regla del emisor (versionada por empresa). Salió de `repositorios.ts` al partirlo (sin cambiar una línea de lógica); las reglas comunes de los repositorios fiscales están en `repositorios.ts`. */

// =================================================================================================
// Regla del emisor (por empresa, versionada igual que los datos fiscales)
// =================================================================================================

/** El borrador de la regla: hoy un solo campo. */
export type BorradorDeReglaDeEmisor = ReglaDeEmisor &
  Readonly<{ id: VersionId; empresaId: EmpresaId; creadoPor: PersonaId; version: number }>;

export type VersionDeRegla =
  | Readonly<{ estado: "BORRADOR"; borrador: BorradorDeReglaDeEmisor }>
  | Readonly<{ estado: "CONFIRMADA"; confirmada: VersionGuardadaDeReglaDeEmisor }>;

type FilaDeRegla = Readonly<{
  id: string;
  empresa_id: string;
  estado: string;
  numero: number | null;
  permitir_eleccion_manual: boolean;
  vigente_desde: Date | null;
  confirmada_en: Date | null;
  confirmada_por: string | null;
  motivo: string | null;
  creado_por: string;
  version: number;
}>;

const COLUMNAS_DE_REGLA = [
  "id",
  "empresa_id",
  "estado",
  "numero",
  "permitir_eleccion_manual",
  "vigente_desde",
  "confirmada_en",
  "confirmada_por",
  "motivo",
  "creado_por",
  "version",
] as const;

function aBorradorDeRegla(fila: FilaDeRegla): BorradorDeReglaDeEmisor {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    permitirEleccionManual: fila.permitir_eleccion_manual,
    creadoPor: personaId(fila.creado_por),
    version: fila.version,
  };
}

function aReglaConfirmada(fila: FilaDeRegla): VersionGuardadaDeReglaDeEmisor {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    permitirEleccionManual: fila.permitir_eleccion_manual,
    numero: exigir(fila.numero, "numero"),
    vigenteDesde: exigir(fila.vigente_desde, "vigente_desde"),
    confirmadaEn: exigir(fila.confirmada_en, "confirmada_en"),
    confirmadaPor: personaId(exigir(fila.confirmada_por, "confirmada_por")),
    motivo: exigir(fila.motivo, "motivo"),
  };
}

export interface RepositorioDeReglasDeEmisor {
  obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeRegla | null>;
  obtenerBorrador(empresa: EmpresaId): Promise<BorradorDeReglaDeEmisor | null>;
  /** Las versiones confirmadas de la empresa, por número creciente (para `reglaDeEmisorVigente`). */
  confirmadas(empresa: EmpresaId): Promise<VersionGuardadaDeReglaDeEmisor[]>;
  /** Crea el borrador con el `id` de la aplicación (idempotente). Otro borrador con otro `id` es error de la base. */
  crearBorrador(
    borrador: Omit<BorradorDeReglaDeEmisor, "version">,
  ): Promise<Resultado<ResultadoDeAlta<BorradorDeReglaDeEmisor>, ErrorDeAlta>>;
  guardarBorrador(borrador: BorradorDeReglaDeEmisor): Promise<BorradorDeReglaDeEmisor | null>;
  /**
   * `BORRADOR` → `CONFIRMADA` con lo que fijó el dominio (`confirmarReglaDeEmisor`), si la versión
   * del borrador coincide y sigue en borrador; si no, `null`.
   */
  confirmar(
    confirmada: VersionGuardadaDeReglaDeEmisor,
    versionEsperada: number,
  ): Promise<VersionGuardadaDeReglaDeEmisor | null>;
}

export function crearRepositorioDeReglasDeEmisor(
  db: Kysely<FiscalDb>,
): RepositorioDeReglasDeEmisor {
  const seleccionar = () => db.selectFrom("regla_emisor").select(COLUMNAS_DE_REGLA);

  async function obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeRegla | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    if (fila === undefined) return null;
    return fila.estado === "CONFIRMADA"
      ? { estado: "CONFIRMADA", confirmada: aReglaConfirmada(fila) }
      : { estado: "BORRADOR", borrador: aBorradorDeRegla(fila) };
  }

  return {
    obtener,

    async obtenerBorrador(empresa) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aBorradorDeRegla(fila);
    },

    async confirmadas(empresa) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("numero")
        .execute();
      return filas.map(aReglaConfirmada);
    },

    async crearBorrador(borrador) {
      await serializarAltaDeId(db, "regla_emisor", borrador.id);
      const nuevo = await db
        .insertInto("regla_emisor")
        .values({
          id: borrador.id,
          empresa_id: borrador.empresaId,
          permitir_eleccion_manual: borrador.permitirEleccionManual,
          creado_por: borrador.creadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(borrador.empresaId, borrador.id);
      if (guardado === null || guardado.estado !== "BORRADOR") return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado.borrador });
    },

    async guardarBorrador(borrador) {
      const actualizado = await db
        .updateTable("regla_emisor")
        .set({ permitir_eleccion_manual: borrador.permitirEleccionManual })
        .where("empresa_id", "=", borrador.empresaId)
        .where("id", "=", borrador.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", borrador.version)
        .returning(COLUMNAS_DE_REGLA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aBorradorDeRegla(actualizado);
    },

    async confirmar(confirmada, versionEsperada) {
      const actualizado = await db
        .updateTable("regla_emisor")
        .set({
          estado: "CONFIRMADA",
          numero: confirmada.numero,
          permitir_eleccion_manual: confirmada.permitirEleccionManual,
          vigente_desde: confirmada.vigenteDesde,
          confirmada_en: confirmada.confirmadaEn,
          confirmada_por: confirmada.confirmadaPor,
          motivo: confirmada.motivo,
        })
        .where("empresa_id", "=", confirmada.empresaId)
        .where("id", "=", confirmada.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS_DE_REGLA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aReglaConfirmada(actualizado);
    },
  };
}
