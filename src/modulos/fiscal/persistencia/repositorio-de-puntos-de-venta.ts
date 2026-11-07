import { type Kysely } from "kysely";
import {
  empresaId,
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { AMBIENTES, type Ambiente } from "../dominio/comprobante-nuevo";
import {
  domicilioId,
  emisorId,
  puntoDeVentaId,
  type EmisorId,
  type PuntoDeVentaId,
} from "../dominio/identificadores";
import type { EstadoDePuntoDeVenta, PuntoDeVenta } from "../dominio/punto-de-venta";
import {
  deLaLista,
  serializarAltaDeId,
  type ResultadoDeAlta,
  type ErrorDeAlta,
} from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Repositorio de los puntos de venta. Salió de `repositorios.ts` al partirlo (sin cambiar una línea de lógica); las reglas comunes de los repositorios fiscales están en `repositorios.ts`. */

// =================================================================================================
// Puntos de venta
// =================================================================================================

const ESTADOS_DE_PUNTO_DE_VENTA: readonly EstadoDePuntoDeVenta[] = ["INACTIVO", "ACTIVO"];

type FilaDePuntoDeVenta = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  sucursal_id: string;
  domicilio_id: string | null;
  numero: number;
  estado: string;
  version: number;
  ambiente: string;
}>;

const COLUMNAS_DE_PUNTO_DE_VENTA = [
  "id",
  "empresa_id",
  "emisor_id",
  "sucursal_id",
  "domicilio_id",
  "numero",
  "estado",
  "version",
  "ambiente",
] as const;

/**
 * Un punto de venta tal como lo guarda la base: el del dominio más su `ambiente` (0009). El dominio del
 * punto de venta no lo conoce (no decide nada con él); lo modelan el repositorio y la facturación.
 * Un punto de venta nace en `HOMOLOGACION` y pasa a `PRODUCCION` solo con `cambiarAmbiente`.
 */
export type PuntoDeVentaGuardado = PuntoDeVenta & Readonly<{ ambiente: Ambiente }>;

function aPuntoDeVenta(fila: FilaDePuntoDeVenta): PuntoDeVentaGuardado {
  return {
    id: puntoDeVentaId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    sucursalId: sucursalId(fila.sucursal_id),
    domicilioId: fila.domicilio_id === null ? null : domicilioId(fila.domicilio_id),
    numero: fila.numero,
    estado: deLaLista(ESTADOS_DE_PUNTO_DE_VENTA, fila.estado, "estado de punto de venta"),
    // Único valor que la base admite en H7 (`punto_de_venta_verificacion_ck`).
    verificacionArca: "NO_VERIFICADO",
    version: fila.version,
    ambiente: deLaLista(AMBIENTES, fila.ambiente, "ambiente de punto de venta"),
  };
}

export interface RepositorioDePuntosDeVenta {
  obtener(empresa: EmpresaId, id: PuntoDeVentaId): Promise<PuntoDeVentaGuardado | null>;
  /** Todos los puntos de venta de la empresa, por emisor y número. */
  listar(empresa: EmpresaId): Promise<PuntoDeVentaGuardado[]>;
  /** Los del emisor (para el número único), por número. */
  listarDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<PuntoDeVentaGuardado[]>;
  /** Los de la sucursal (activos o no), por emisor y número. */
  listarDeLaSucursal(empresa: EmpresaId, sucursal: SucursalId): Promise<PuntoDeVentaGuardado[]>;
  /**
   * Da de alta el punto de venta con el `id` de la aplicación (idempotente: repetir devuelve el que
   * ya existe, `creado: false`). Nace como lo dice el dominio (`INACTIVO`). Un número ya usado por
   * el emisor sale como error de la base (`punto_de_venta_numero_uk`). Nace en `HOMOLOGACION`: la
   * aplicación no tiene permiso para elegir el ambiente al insertar.
   */
  crear(
    puntoDeVenta: PuntoDeVenta,
  ): Promise<Resultado<ResultadoDeAlta<PuntoDeVentaGuardado>, ErrorDeAlta>>;
  /**
   * Guarda número, sucursal, domicilio y estado si la versión coincide; si no, `null`. El emisor y el
   * ambiente no se guardan nunca por acá (el emisor no cambia; el ambiente tiene `cambiarAmbiente`).
   */
  guardar(puntoDeVenta: PuntoDeVenta): Promise<PuntoDeVentaGuardado | null>;
  /**
   * Cambia el ambiente (QF2: el gerente) si la versión coincide; si no, `null`. Si ya tiene ese ambiente
   * no escribe y devuelve el punto de venta tal cual («ya estaba», aunque la versión sea otra). La base frena el
   * cambio con una serie `EN_CURSO` (`punto_de_venta_ambiente_con_serie_en_curso`) y la vuelta de
   * `PRODUCCION` a `HOMOLOGACION` si ya emitió (`punto_de_venta_ambiente_no_vuelve`): salen como error
   * de la base. Que haya un certificado de producción vigente lo exige el caso de uso.
   */
  cambiarAmbiente(
    empresa: EmpresaId,
    id: PuntoDeVentaId,
    ambiente: Ambiente,
    versionEsperada: number,
  ): Promise<PuntoDeVentaGuardado | null>;
  /**
   * SOLO PLATAFORMA (la que más lo necesita): cuántos puntos de venta `ACTIVO` tiene el emisor.
   * Lee solo `id`, `empresa_id`, `emisor_id` y `estado`, las 4 columnas que la plataforma ve.
   */
  contarActivosDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<number>;
}

export function crearRepositorioDePuntosDeVenta(db: Kysely<FiscalDb>): RepositorioDePuntosDeVenta {
  const seleccionar = () => db.selectFrom("punto_de_venta").select(COLUMNAS_DE_PUNTO_DE_VENTA);

  async function obtener(
    empresa: EmpresaId,
    id: PuntoDeVentaId,
  ): Promise<PuntoDeVentaGuardado | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aPuntoDeVenta(fila);
  }

  return {
    obtener,

    async listar(empresa) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .orderBy("emisor_id")
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async listarDelEmisor(empresa, emisor) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async listarDeLaSucursal(empresa, sucursal) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .orderBy("emisor_id")
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async crear(puntoDeVenta) {
      // El estado inicial lo fija la base (`INACTIVO`): no hay permiso para elegirlo al insertar.
      if (puntoDeVenta.estado !== "INACTIVO") {
        throw new RangeError("un punto de venta nace INACTIVO: se activa después");
      }
      await serializarAltaDeId(db, "punto_de_venta", puntoDeVenta.id);
      const nuevo = await db
        .insertInto("punto_de_venta")
        .values({
          id: puntoDeVenta.id,
          empresa_id: puntoDeVenta.empresaId,
          emisor_id: puntoDeVenta.emisorId,
          sucursal_id: puntoDeVenta.sucursalId,
          domicilio_id: puntoDeVenta.domicilioId,
          numero: puntoDeVenta.numero,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(puntoDeVenta.empresaId, puntoDeVenta.id);
      if (guardado === null) return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado });
    },

    async guardar(puntoDeVenta) {
      const actualizado = await db
        .updateTable("punto_de_venta")
        .set({
          numero: puntoDeVenta.numero,
          sucursal_id: puntoDeVenta.sucursalId,
          domicilio_id: puntoDeVenta.domicilioId,
          estado: puntoDeVenta.estado,
        })
        .where("empresa_id", "=", puntoDeVenta.empresaId)
        .where("id", "=", puntoDeVenta.id)
        .where("version", "=", puntoDeVenta.version)
        .returning(COLUMNAS_DE_PUNTO_DE_VENTA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aPuntoDeVenta(actualizado);
    },

    async cambiarAmbiente(empresa, id, ambiente, versionEsperada) {
      const actual = await obtener(empresa, id);
      if (actual === null) return null;
      if (actual.ambiente === ambiente) return actual;
      if (actual.version !== versionEsperada) return null;
      const actualizado = await db
        .updateTable("punto_de_venta")
        .set({ ambiente })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS_DE_PUNTO_DE_VENTA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aPuntoDeVenta(actualizado);
    },

    async contarActivosDelEmisor(empresa, emisor) {
      const fila = await db
        .selectFrom("punto_de_venta")
        .select((eb) => eb.fn.count<string>("id").as("n"))
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "ACTIVO")
        .executeTakeFirstOrThrow();
      return Number(fila.n);
    },
  };
}
