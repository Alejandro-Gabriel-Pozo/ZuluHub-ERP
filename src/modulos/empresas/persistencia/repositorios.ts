import type { Generated, Kysely, Selectable } from "kysely";
import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  tenantId,
  type EmpresaId,
  type TenantId,
} from "../../../primitivas/identificadores/marca";
import type { CambioDeEstadoDeEmpresa, Empresa } from "../dominio/empresa";

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
    /** `time` de Postgres: llega como `HH:MM:SS` (la base exige los segundos en cero). */
    hora_de_corte: Generated<string>;
    /** 0019: contacto opcional (nulo = no existe). La plataforma no lo escribe. */
    telefono: Generated<string | null>;
    correo: Generated<string | null>;
    web: Generated<string | null>;
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
  sucursal: [
    "id",
    "empresa_id",
    "nombre",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
    "hora_de_corte", // 0007: la hora de corte de la jornada (tramo previo común)
    "telefono", // 0019: contacto opcional de la sucursal
    "correo",
    "web",
  ],
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
  // 0005 (H6): el nombre sin depender del locale, su largo y sus caracteres, y la última sucursal.
  sucursal_nombre_ci_uk: "SUCURSAL_DUPLICADA",
  sucursal_nombre_largo_ck: "NOMBRE_DE_SUCURSAL_INVALIDO",
  sucursal_nombre_control_ck: "NOMBRE_DE_SUCURSAL_INVALIDO",
  sucursal_ultima_activa: "ULTIMA_SUCURSAL_ACTIVA", // la lanza un disparador
  // 0007: la hora de corte de la jornada (minutos enteros, de 00:00 a 23:59); `editarSucursal` la valida
  // antes, así que esto es la red de seguridad de la base.
  sucursal_hora_de_corte_ck: "HORA_DE_CORTE_INVALIDA",
  // 0019: el contacto opcional de la sucursal; `editarSucursal` y `crearSucursal` lo validan antes, esto es la red de seguridad.
  sucursal_telefono_ck: "TELEFONO_DE_SUCURSAL_INVALIDO",
  sucursal_correo_ck: "CORREO_DE_SUCURSAL_INVALIDO",
  sucursal_web_ck: "WEB_DE_SUCURSAL_INVALIDA",
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

/** La empresa con el instante en que se creó: el plazo del alta cuenta desde ahí. */
export type EmpresaConCreadoEn = Readonly<{ empresa: Empresa; creadoEn: Date }>;

export interface RepositorioDeEmpresas {
  crear(datos: NuevaEmpresa): Promise<Empresa>;
  obtener(id: EmpresaId): Promise<Empresa | null>;
  /** Lo mismo con el instante de creación (el plazo del alta de 72 h cuenta desde ahí); `null` si no existe o no se ve. */
  obtenerConCreadoEn(id: EmpresaId): Promise<EmpresaConCreadoEn | null>;
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

export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function crearRepositorioDeEmpresas(db: Kysely<EmpresasDb>): RepositorioDeEmpresas {
  async function obtener(id: EmpresaId): Promise<Empresa | null> {
    const fila = await db.selectFrom("empresa").selectAll().where("id", "=", id).executeTakeFirst();
    return fila === undefined ? null : aEmpresa(fila);
  }

  return {
    obtener,

    async obtenerConCreadoEn(id) {
      const fila = await db
        .selectFrom("empresa")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : { empresa: aEmpresa(fila), creadoEn: fila.creado_en };
    },

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
