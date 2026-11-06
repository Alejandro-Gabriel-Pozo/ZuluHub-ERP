import { sql, type Kysely } from "kysely";
import type { Domicilio } from "../../../primitivas/domicilio/domicilio";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { type Emisor } from "../dominio/emisor";
import { emisorId, type DomicilioId, type EmisorId } from "../dominio/identificadores";
import { aDomicilioGuardado, domiciliosPorIds, type DomicilioGuardado } from "./domicilios";
import {
  serializarAltaDeId,
  type ResultadoDeAlta,
  type ErrorDeAlta,
} from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Repositorios de emisores y de domicilios. Salió de `repositorios.ts` al partirlo (sin cambiar una línea de lógica); las reglas comunes de los repositorios fiscales están en `repositorios.ts`. */

// =================================================================================================
// Emisores
// =================================================================================================

type FilaDeEmisor = Readonly<{
  id: string;
  empresa_id: string;
  es_principal: boolean;
  activo: boolean;
  cuit: string;
  version: number;
}>;

function aEmisor(fila: FilaDeEmisor): Emisor {
  return {
    id: emisorId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    esPrincipal: fila.es_principal,
    cuit: fila.cuit as Cuit,
    activo: fila.activo,
    version: fila.version,
  };
}

export interface RepositorioDeEmisores {
  /** Un emisor de la empresa; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: EmisorId): Promise<Emisor | null>;
  /** El emisor principal (siempre existe: lo crea el disparador de la empresa, y el relleno de 0006). */
  delPrincipal(empresa: EmpresaId): Promise<Emisor | null>;
  /** Todos los emisores de la empresa: primero el principal, después los secundarios por antigüedad. */
  listar(empresa: EmpresaId): Promise<Emisor[]>;
  /**
   * SOLO PLATAFORMA. Crea un emisor secundario, activo, con su CUIT propio. Repetir el alta del
   * mismo CUIT en la misma empresa devuelve el emisor que ya existe (`creado: false`); un CUIT que
   * es de otra empresa o de otro emisor es `CUIT_EN_USO`. El `id` lo genera la base (la plataforma
   * no tiene permiso para elegirlo). Las demás reglas (empresa operable, CUIT que ya es de una
   * empresa) las impone la base y salen como error de la base.
   */
  crearSecundario(
    empresa: EmpresaId,
    cuit: Cuit,
  ): Promise<Resultado<ResultadoDeAlta<Emisor>, "CUIT_EN_USO">>;
  /**
   * SOLO PLATAFORMA. Guarda el CUIT y el estado de un emisor SECUNDARIO si la versión coincide.
   * El CUIT del principal es `empresa.cuit`: ese no se guarda acá (lanza `RangeError`).
   */
  guardar(emisor: Emisor): Promise<Emisor | null>;
  /**
   * SOLO PLATAFORMA (los demás ven solo lo propio). Cuáles de esos CUIT ya están tomados en la
   * instalación: el de todo emisor secundario y el de toda empresa no cancelada (la entrada de
   * `ContextoDeCuit.cuitsEnUso`).
   */
  cuitsTomados(candidatos: readonly Cuit[]): Promise<ReadonlySet<Cuit>>;
}

export function crearRepositorioDeEmisores(db: Kysely<FiscalDb>): RepositorioDeEmisores {
  // El CUIT del principal es el de la empresa: una sola fuente, sin copias (spec H7 §B.2).
  const seleccionar = () =>
    db
      .selectFrom("emisor")
      .innerJoin("empresa", "empresa.id", "emisor.empresa_id")
      .select([
        "emisor.id",
        "emisor.empresa_id",
        "emisor.es_principal",
        "emisor.activo",
        "emisor.version",
        sql<string>`coalesce(emisor.cuit, empresa.cuit)`.as("cuit"),
      ]);

  async function obtener(empresa: EmpresaId, id: EmisorId): Promise<Emisor | null> {
    const fila = await seleccionar()
      .where("emisor.empresa_id", "=", empresa)
      .where("emisor.id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aEmisor(fila);
  }

  return {
    obtener,

    async delPrincipal(empresa) {
      const fila = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .where("emisor.es_principal", "=", true)
        .executeTakeFirst();
      return fila === undefined ? null : aEmisor(fila);
    },

    async listar(empresa) {
      const filas = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .orderBy("emisor.es_principal", "desc")
        .orderBy("emisor.creado_en")
        .orderBy("emisor.id")
        .execute();
      return filas.map(aEmisor);
    },

    async crearSecundario(empresa, cuit) {
      const nuevo = await db
        .insertInto("emisor")
        .values({ empresa_id: empresa, es_principal: false, cuit })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (nuevo !== undefined) {
        const creado = await obtener(empresa, emisorId(nuevo.id));
        if (creado === null) throw new Error("el emisor recién creado no se pudo leer");
        return ok({ creado: true, valor: creado });
      }
      // No insertó: el CUIT ya es de un emisor. Si es de esta empresa, la repetición es un éxito.
      const existente = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .where("emisor.cuit", "=", cuit)
        .executeTakeFirst();
      return existente === undefined
        ? err("CUIT_EN_USO")
        : ok({ creado: false, valor: aEmisor(existente) });
    },

    async guardar(emisor) {
      if (emisor.esPrincipal) {
        throw new RangeError("el CUIT del emisor principal es el de la empresa: no se guarda acá");
      }
      const actualizado = await db
        .updateTable("emisor")
        .set({ cuit: emisor.cuit, activo: emisor.activo })
        .where("empresa_id", "=", emisor.empresaId)
        .where("id", "=", emisor.id)
        .where("version", "=", emisor.version)
        .returning("id")
        .executeTakeFirst();
      return actualizado === undefined ? null : obtener(emisor.empresaId, emisor.id);
    },

    async cuitsTomados(candidatos) {
      if (candidatos.length === 0) return new Set();
      const lista = [...candidatos];
      const deEmisores = await db
        .selectFrom("emisor")
        .select("cuit")
        .where("cuit", "in", lista)
        .execute();
      const deEmpresas = await db
        .selectFrom("empresa")
        .select("cuit")
        .where("cuit", "in", lista)
        .where("estado", "<>", "CANCELLED")
        .execute();
      return new Set([...deEmisores, ...deEmpresas].map((f) => f.cuit as Cuit));
    },
  };
}

// =================================================================================================
// Domicilios (solo inserción: cambiar un domicilio es crear otro)
// =================================================================================================

export type { DomicilioGuardado };

function mismoDomicilio(a: Domicilio, b: Domicilio): boolean {
  return (
    a.calle === b.calle &&
    a.numero === b.numero &&
    a.piso === b.piso &&
    a.departamento === b.departamento &&
    a.localidad === b.localidad &&
    a.provincia === b.provincia &&
    a.codigoPostal === b.codigoPostal
  );
}

export interface RepositorioDeDomicilios {
  /**
   * Guarda un domicilio con el `id` que manda la aplicación. Repetir el mismo `id` con el MISMO
   * contenido devuelve el que ya existe (`creado: false`); el mismo `id` con otro contenido, o un
   * `id` de una fila que esta empresa no ve, es `ID_EN_USO` (un domicilio no se edita).
   */
  crear(
    empresa: EmpresaId,
    id: DomicilioId,
    domicilio: Domicilio,
  ): Promise<Resultado<ResultadoDeAlta<DomicilioGuardado>, ErrorDeAlta>>;
  obtener(empresa: EmpresaId, id: DomicilioId): Promise<DomicilioGuardado | null>;
  /** Varios domicilios de la empresa en UNA lectura (sin N+1); los ids ajenos o inexistentes no aparecen. */
  obtenerVarios(empresa: EmpresaId, ids: readonly DomicilioId[]): Promise<DomicilioGuardado[]>;
}

export function crearRepositorioDeDomicilios(db: Kysely<FiscalDb>): RepositorioDeDomicilios {
  async function obtener(empresa: EmpresaId, id: DomicilioId): Promise<DomicilioGuardado | null> {
    const fila = await db
      .selectFrom("domicilio")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aDomicilioGuardado(fila);
  }

  return {
    obtener,
    obtenerVarios: (empresa, ids) => domiciliosPorIds(db, empresa, ids),

    async crear(empresa, id, domicilio) {
      await serializarAltaDeId(db, "domicilio", id);
      const nuevo = await db
        .insertInto("domicilio")
        .values({
          id,
          empresa_id: empresa,
          calle: domicilio.calle,
          numero: domicilio.numero,
          piso: domicilio.piso,
          departamento: domicilio.departamento,
          localidad: domicilio.localidad,
          provincia: domicilio.provincia,
          codigo_postal: domicilio.codigoPostal,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(empresa, id);
      if (guardado === null) return err("ID_EN_USO");
      if (nuevo !== undefined) return ok({ creado: true, valor: guardado });
      return mismoDomicilio(guardado.domicilio, domicilio)
        ? ok({ creado: false, valor: guardado })
        : err("ID_EN_USO");
    },
  };
}
