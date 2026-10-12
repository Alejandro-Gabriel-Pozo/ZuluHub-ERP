import { sql, type Generated, type Kysely, type Selectable } from "kysely";
import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  sucursalId,
  tenantId,
  type EmpresaId,
  type SucursalId,
  type TenantId,
} from "../../../primitivas/identificadores/marca";
import type { CambioDeEstadoDeEmpresa, Empresa } from "../dominio/empresa";
import type { Sucursal } from "../dominio/sucursal";

/** Tablas del módulo; un test compara estas columnas con el catálogo de la base. */
export type EmpresasDb = {
  empresa: {
    id: Generated<string>;
    tenant_id: string;
    cuit: string;
    razon_social: string;
    estado: Generated<EstadoDeEmpresa>;
    motivo_estado: Generated<string | null>;
    zona_horaria: Generated<string>;
    moneda: Generated<string>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  sucursal: {
    id: Generated<string>;
    empresa_id: string;
    nombre: string;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_EMPRESAS = {
  empresa: [
    "id",
    "tenant_id",
    "cuit",
    "razon_social",
    "estado",
    "motivo_estado",
    "zona_horaria",
    "moneda",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  sucursal: ["id", "empresa_id", "nombre", "activa", "creado_en", "actualizado_en", "version"],
} as const;

/** Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna. */
export const ERRORES_DE_EMPRESAS_POR_RESTRICCION: Readonly<Record<string, string>> = {
  empresa_pkey: "NO_TRADUCIDA",
  empresa_id_tenant_uk: "NO_TRADUCIDA", // apoyo de la FK compuesta de las invitaciones (0002)
  empresa_cuit_ck: "CUIT_INVALIDO",
  empresa_cuit_uk: "CUIT_DUPLICADO",
  empresa_razon_social_ck: "RAZON_SOCIAL_INVALIDA",
  empresa_estado_ck: "NO_TRADUCIDA",
  empresa_zona_horaria_ck: "ZONA_HORARIA_INVALIDA",
  empresa_moneda_ck: "MONEDA_NO_SOPORTADA",
  empresa_motivo_ck: "MOTIVO_OBLIGATORIO",
  empresa_tenant_id_fkey: "TENANT_INEXISTENTE",
  empresa_tenant_inmutable: "EMPRESA_NO_SE_REASIGNA",
  empresa_tenant_no_activo: "TENANT_NO_ACTIVO",
  empresa_transicion_invalida: "TRANSICION_NO_PERMITIDA",
  sucursal_pkey: "NO_TRADUCIDA",
  sucursal_id_empresa_uk: "NO_TRADUCIDA",
  sucursal_nombre_ck: "NOMBRE_DE_SUCURSAL_INVALIDO",
  sucursal_nombre_uk: "SUCURSAL_DUPLICADA",
  sucursal_empresa_id_fkey: "EMPRESA_INEXISTENTE",
};

export type ErrorDeRepositorioDeEmpresas = "EMPRESA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA";

export type NuevaEmpresa = Readonly<{
  tenantId: TenantId;
  cuit: Cuit;
  razonSocial: string;
  zonaHoraria?: string;
}>;

/** Un alta que sigue en `PROVISIONING` y ya cumplió el plazo, con el instante en que se creó la empresa. */
export type AltaVencida = Readonly<{ empresa: Empresa; creadoEn: Date }>;

export interface RepositorioDeEmpresas {
  crear(datos: NuevaEmpresa): Promise<Empresa>;
  obtener(id: EmpresaId): Promise<Empresa | null>;
  listarDelTenant(tenant: TenantId): Promise<Empresa[]>;
  cambiarEstado(
    id: EmpresaId,
    versionEsperada: number,
    cambio: CambioDeEstadoDeEmpresa,
  ): Promise<{ ok: true; empresa: Empresa } | { ok: false; error: ErrorDeRepositorioDeEmpresas }>;
  /**
   * Las altas que siguen en `PROVISIONING` y se crearon en `creadasHasta` o antes (INCLUSIVO:
   * `creado_en <= creadasHasta`), de la más vieja a la más nueva (desempate por id), hasta `limite`.
   * El llamador calcula `creadasHasta = ahora - 72 h` con la constante del dominio de plataforma: el
   * plazo vive en un solo lugar y el repositorio no lo conoce. `limite` es un entero mayor o igual a 1.
   */
  listarAltasVencidas(creadasHasta: Date, limite: number): Promise<AltaVencida[]>;
}

/** Resultado de `crearSiNoExiste`: la sucursal nueva, o la que ya tenía ese nombre. */
export type AltaDeSucursal = Readonly<{ creada: boolean; sucursal: Sucursal }>;

export interface RepositorioDeSucursales {
  crear(empresa: EmpresaId, nombre: string): Promise<Sucursal>;
  listar(empresa: EmpresaId): Promise<Sucursal[]>;
  renombrar(id: SucursalId, versionEsperada: number, nombre: string): Promise<Sucursal | null>;
  /**
   * Da de alta la sucursal SIN leerla de vuelta (`INSERT` sin `RETURNING`): la plataforma puede crear
   * la sucursal inicial de una empresa pero no tiene permiso de lectura sobre `sucursal` (son datos
   * operativos), y un `RETURNING` exigiría ese permiso. Un nombre repetido sale como error de unicidad.
   */
  sembrar(empresa: EmpresaId, nombre: string): Promise<void>;
  /** Una sucursal de la empresa; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: SucursalId): Promise<Sucursal | null>;
  /** Solo las activas de la empresa, ordenadas por nombre e id. */
  listarActivas(empresa: EmpresaId): Promise<Sucursal[]>;
  /**
   * Crea la sucursal salvo que la empresa ya tenga una con ese nombre (sin distinguir mayúsculas,
   * activa o no): `INSERT ... ON CONFLICT DO NOTHING` y, si no insertó, devuelve la existente.
   */
  crearSiNoExiste(empresa: EmpresaId, nombre: string): Promise<AltaDeSucursal>;
  /** Activa o desactiva si la versión coincide; `null` si no coincide o no es de la empresa. */
  cambiarActiva(
    empresa: EmpresaId,
    id: SucursalId,
    versionEsperada: number,
    activa: boolean,
  ): Promise<Sucursal | null>;
}

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function aEmpresa(fila: Selectable<EmpresasDb["empresa"]>): Empresa {
  return {
    id: empresaId(fila.id),
    tenantId: tenantId(fila.tenant_id),
    cuit: fila.cuit as Cuit,
    razonSocial: fila.razon_social,
    estado: fila.estado,
    motivoEstado: fila.motivo_estado,
    zonaHoraria: fila.zona_horaria,
    version: fila.version,
  };
}

function aSucursal(fila: Selectable<EmpresasDb["sucursal"]>): Sucursal {
  return {
    id: sucursalId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    nombre: fila.nombre,
    activa: fila.activa,
    version: fila.version,
  };
}

export function crearRepositorioDeEmpresas(db: Kysely<EmpresasDb>): RepositorioDeEmpresas {
  async function obtener(id: EmpresaId): Promise<Empresa | null> {
    const fila = await db.selectFrom("empresa").selectAll().where("id", "=", id).executeTakeFirst();
    return fila === undefined ? null : aEmpresa(fila);
  }

  return {
    obtener,

    async crear(datos) {
      const fila = await db
        .insertInto("empresa")
        .values({
          tenant_id: datos.tenantId,
          cuit: datos.cuit,
          razon_social: datos.razonSocial,
          ...(datos.zonaHoraria === undefined ? {} : { zona_horaria: datos.zonaHoraria }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aEmpresa(fila);
    },

    async listarDelTenant(tenant) {
      const filas = await db
        .selectFrom("empresa")
        .selectAll()
        .where("tenant_id", "=", tenant)
        .orderBy("razon_social")
        .orderBy("id")
        .execute();
      return filas.map(aEmpresa);
    },

    async listarAltasVencidas(creadasHasta, limite) {
      if (!Number.isInteger(limite) || limite < 1) {
        throw new RangeError(`limite debe ser un entero mayor o igual a 1 (llegó ${limite})`);
      }
      if (Number.isNaN(creadasHasta.getTime())) {
        throw new RangeError("creadasHasta no es una fecha válida");
      }
      const filas = await db
        .selectFrom("empresa")
        .selectAll()
        .where("estado", "=", "PROVISIONING")
        .where("creado_en", "<=", creadasHasta)
        .orderBy("creado_en")
        .orderBy("id")
        .limit(limite)
        .execute();
      return filas.map((fila) => ({ empresa: aEmpresa(fila), creadoEn: fila.creado_en }));
    },

    async cambiarEstado(id, versionEsperada, cambio) {
      const fila = await db
        .updateTable("empresa")
        .set({ estado: cambio.estado, motivo_estado: cambio.motivoEstado })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      if (fila !== undefined) return { ok: true, empresa: aEmpresa(fila) };
      const existente = await obtener(id);
      return {
        ok: false,
        error: existente === null ? "EMPRESA_NO_ENCONTRADA" : "VERSION_DESACTUALIZADA",
      };
    },
  };
}

export function crearRepositorioDeSucursales(db: Kysely<EmpresasDb>): RepositorioDeSucursales {
  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ninguna sucursal: la base lo rechazaría
      // con un error de formato en lugar de "no existe".
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },

    async listarActivas(empresa) {
      const filas = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("nombre")
        .orderBy("id")
        .execute();
      return filas.map(aSucursal);
    },

    async sembrar(empresa, nombre) {
      await db.insertInto("sucursal").values({ empresa_id: empresa, nombre }).execute();
    },

    async crearSiNoExiste(empresa, nombre) {
      const nueva = await db
        .insertInto("sucursal")
        .values({ empresa_id: empresa, nombre })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (nueva !== undefined) return { creada: true, sucursal: aSucursal(nueva) };
      // El índice único es (empresa, lower(nombre)): se busca por la misma expresión.
      const existente = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where(sql<boolean>`lower(nombre) = lower(${nombre})`)
        .executeTakeFirst();
      if (existente === undefined) {
        throw new Error("el alta de sucursal no insertó y tampoco hay una con ese nombre");
      }
      return { creada: false, sucursal: aSucursal(existente) };
    },

    async cambiarActiva(empresa, id, versionEsperada, activa) {
      const fila = await db
        .updateTable("sucursal")
        .set({ activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },

    async crear(empresa, nombre) {
      const fila = await db
        .insertInto("sucursal")
        .values({ empresa_id: empresa, nombre })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aSucursal(fila);
    },

    async listar(empresa) {
      const filas = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .orderBy("nombre")
        .orderBy("id")
        .execute();
      return filas.map(aSucursal);
    },

    async renombrar(id, versionEsperada, nombre) {
      const fila = await db
        .updateTable("sucursal")
        .set({ nombre })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },
  };
}
