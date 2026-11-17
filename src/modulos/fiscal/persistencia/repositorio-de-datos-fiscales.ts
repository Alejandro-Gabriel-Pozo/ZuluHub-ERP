import { sql, type Kysely } from "kysely";
import { empresaId, personaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  esCondicionDeIibb,
  type CondicionIibb,
  type DatosFiscalesBorrador,
  type DatosFiscalesConfirmados,
} from "../dominio/datos-fiscales";
import { esCondicionDeIva, type CondicionIva } from "../dominio/emisor";
import {
  domicilioId,
  emisorId,
  versionId,
  type EmisorId,
  type VersionId,
} from "../dominio/identificadores";
import {
  exigir,
  serializarAltaDeId,
  type ResultadoDeAlta,
  type ErrorDeAlta,
} from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Repositorio de los datos fiscales de un emisor (versionados). Salió de `repositorios.ts` al partirlo (sin cambiar una línea de lógica); las reglas comunes de los repositorios fiscales están en `repositorios.ts`. */

// =================================================================================================
// Datos fiscales (por emisor, versionados)
// =================================================================================================

/** Un borrador o una versión confirmada, tal como se lee por id. */
export type VersionDeDatosFiscales =
  | Readonly<{ estado: "BORRADOR"; borrador: DatosFiscalesBorrador }>
  | Readonly<{ estado: "CONFIRMADA"; confirmada: DatosFiscalesConfirmados }>;

// `inicio_actividades` es una fecha civil: se lee como texto `YYYY-MM-DD` y no como `Date` (que `pg`
// armaría a la medianoche local y correría un día).
const INICIO_DE_ACTIVIDADES = sql<string | null>`to_char(inicio_actividades, 'YYYY-MM-DD')`.as(
  "inicio_actividades",
);

const COLUMNAS_DE_DATOS_FISCALES = [
  "id",
  "empresa_id",
  "emisor_id",
  "estado",
  "numero",
  "razon_social",
  "condicion_iva",
  "domicilio_fiscal_id",
  INICIO_DE_ACTIVIDADES,
  "iibb_numero",
  "iibb_condicion",
  "vigente_desde",
  "confirmada_en",
  "confirmada_por",
  "motivo",
  "creado_por",
  "version",
] as const;

type FilaDeDatosFiscales = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  estado: string;
  numero: number | null;
  razon_social: string | null;
  condicion_iva: string | null;
  domicilio_fiscal_id: string | null;
  inicio_actividades: string | null;
  iibb_numero: string | null;
  iibb_condicion: string | null;
  vigente_desde: Date | null;
  confirmada_en: Date | null;
  confirmada_por: string | null;
  motivo: string | null;
  creado_por: string;
  version: number;
}>;

function condicionDeIva(texto: string | null): CondicionIva | null {
  if (texto === null) return null;
  if (!esCondicionDeIva(texto))
    throw new RangeError(`condición de IVA desconocida en la base: ${texto}`);
  return texto;
}

function condicionDeIibb(texto: string | null): CondicionIibb | null {
  if (texto === null) return null;
  if (!esCondicionDeIibb(texto))
    throw new RangeError(`condición de IIBB desconocida en la base: ${texto}`);
  return texto;
}

function aBorrador(fila: FilaDeDatosFiscales): DatosFiscalesBorrador {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    razonSocial: fila.razon_social,
    condicionIva: condicionDeIva(fila.condicion_iva),
    domicilioFiscalId:
      fila.domicilio_fiscal_id === null ? null : domicilioId(fila.domicilio_fiscal_id),
    inicioActividades: fila.inicio_actividades,
    iibbNumero: fila.iibb_numero,
    iibbCondicion: condicionDeIibb(fila.iibb_condicion),
    creadoPor: personaId(fila.creado_por),
    version: fila.version,
  };
}

function aConfirmada(fila: FilaDeDatosFiscales): DatosFiscalesConfirmados {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    numero: exigir(fila.numero, "numero"),
    razonSocial: exigir(fila.razon_social, "razon_social"),
    condicionIva: exigir(condicionDeIva(fila.condicion_iva), "condicion_iva"),
    domicilioFiscalId: domicilioId(exigir(fila.domicilio_fiscal_id, "domicilio_fiscal_id")),
    inicioActividades: exigir(fila.inicio_actividades, "inicio_actividades"),
    iibbNumero: fila.iibb_numero,
    iibbCondicion: condicionDeIibb(fila.iibb_condicion),
    vigenteDesde: exigir(fila.vigente_desde, "vigente_desde"),
    confirmadaEn: exigir(fila.confirmada_en, "confirmada_en"),
    confirmadaPor: personaId(exigir(fila.confirmada_por, "confirmada_por")),
    motivo: exigir(fila.motivo, "motivo"),
    version: fila.version,
  };
}

function aVersionDeDatos(fila: FilaDeDatosFiscales): VersionDeDatosFiscales {
  return fila.estado === "CONFIRMADA"
    ? { estado: "CONFIRMADA", confirmada: aConfirmada(fila) }
    : { estado: "BORRADOR", borrador: aBorrador(fila) };
}

export interface RepositorioDeDatosFiscales {
  /** Un borrador o una versión confirmada; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeDatosFiscales | null>;
  /** El borrador del emisor (hay a lo sumo uno). */
  obtenerBorrador(empresa: EmpresaId, emisor: EmisorId): Promise<DatosFiscalesBorrador | null>;
  /** Las versiones confirmadas del emisor, por número creciente. */
  confirmadas(empresa: EmpresaId, emisor: EmisorId): Promise<DatosFiscalesConfirmados[]>;
  /**
   * Crea el borrador con el `id` de la aplicación (idempotente). Un segundo borrador del mismo
   * emisor con otro `id` sale como error de la base (`datos_fiscales_borrador_uk`).
   */
  crearBorrador(
    borrador: DatosFiscalesBorrador,
  ): Promise<Resultado<ResultadoDeAlta<DatosFiscalesBorrador>, ErrorDeAlta>>;
  /** Guarda el contenido de un borrador si la versión coincide y sigue en borrador; si no, `null`. */
  guardarBorrador(borrador: DatosFiscalesBorrador): Promise<DatosFiscalesBorrador | null>;
  /**
   * `BORRADOR` → `CONFIRMADA` con lo que fijó el dominio (`confirmarDatosFiscales`), si la versión
   * coincide con la del borrador leído y sigue en borrador; si no, `null` (otra transacción ya lo
   * confirmó o lo cambió: el caso de uso vuelve a leer, y un «ya estaba» es éxito).
   */
  confirmar(confirmada: DatosFiscalesConfirmados): Promise<DatosFiscalesConfirmados | null>;
}

export function crearRepositorioDeDatosFiscales(db: Kysely<FiscalDb>): RepositorioDeDatosFiscales {
  const seleccionar = () => db.selectFrom("datos_fiscales").select(COLUMNAS_DE_DATOS_FISCALES);

  async function obtener(
    empresa: EmpresaId,
    id: VersionId,
  ): Promise<VersionDeDatosFiscales | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aVersionDeDatos(fila);
  }

  return {
    obtener,

    async obtenerBorrador(empresa, emisor) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aBorrador(fila);
    },

    async confirmadas(empresa, emisor) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("numero")
        .execute();
      return filas.map(aConfirmada);
    },

    async crearBorrador(borrador) {
      await serializarAltaDeId(db, "datos_fiscales", borrador.id);
      const nuevo = await db
        .insertInto("datos_fiscales")
        .values({
          id: borrador.id,
          empresa_id: borrador.empresaId,
          emisor_id: borrador.emisorId,
          razon_social: borrador.razonSocial,
          condicion_iva: borrador.condicionIva,
          domicilio_fiscal_id: borrador.domicilioFiscalId,
          inicio_actividades: borrador.inicioActividades,
          iibb_numero: borrador.iibbNumero,
          iibb_condicion: borrador.iibbCondicion,
          creado_por: borrador.creadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(borrador.empresaId, borrador.id);
      if (guardado === null) return err("ID_EN_USO");
      // El `id` de una versión CONFIRMADA ya no es de un borrador: no es una repetición.
      if (guardado.estado !== "BORRADOR") return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado.borrador });
    },

    async guardarBorrador(borrador) {
      const actualizado = await db
        .updateTable("datos_fiscales")
        .set({
          razon_social: borrador.razonSocial,
          condicion_iva: borrador.condicionIva,
          domicilio_fiscal_id: borrador.domicilioFiscalId,
          inicio_actividades: borrador.inicioActividades,
          iibb_numero: borrador.iibbNumero,
          iibb_condicion: borrador.iibbCondicion,
        })
        .where("empresa_id", "=", borrador.empresaId)
        .where("id", "=", borrador.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", borrador.version)
        .returning(COLUMNAS_DE_DATOS_FISCALES)
        .executeTakeFirst();
      return actualizado === undefined ? null : aBorrador(actualizado);
    },

    async confirmar(confirmada) {
      const actualizado = await db
        .updateTable("datos_fiscales")
        .set({
          estado: "CONFIRMADA",
          numero: confirmada.numero,
          razon_social: confirmada.razonSocial,
          condicion_iva: confirmada.condicionIva,
          domicilio_fiscal_id: confirmada.domicilioFiscalId,
          inicio_actividades: confirmada.inicioActividades,
          iibb_numero: confirmada.iibbNumero,
          iibb_condicion: confirmada.iibbCondicion,
          vigente_desde: confirmada.vigenteDesde,
          confirmada_en: confirmada.confirmadaEn,
          confirmada_por: confirmada.confirmadaPor,
          motivo: confirmada.motivo,
        })
        .where("empresa_id", "=", confirmada.empresaId)
        .where("id", "=", confirmada.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", confirmada.version)
        .returning(COLUMNAS_DE_DATOS_FISCALES)
        .executeTakeFirst();
      return actualizado === undefined ? null : aConfirmada(actualizado);
    },
  };
}
