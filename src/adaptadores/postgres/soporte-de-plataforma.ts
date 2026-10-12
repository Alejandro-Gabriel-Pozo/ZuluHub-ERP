import type { Generated, Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../capacidades/permisos/roles";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../contexto/estados";
import {
  emailDesdeTexto,
  type EmpresaInvitada,
  type EstadoGuardado,
  type Invitacion,
  type Persona,
  type TipoDeInvitacion,
} from "../../modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  tenantId,
  type EmpresaId,
  type InvitacionId,
} from "../../primitivas/identificadores/marca";
import type {
  FilaDeEmpresa,
  LecturaDeSoporte,
  MembresiaVisible,
} from "../../plataforma/consultas/contrato";
import type { Dato } from "../../puertos/sin-secretos";

/**
 * Lectura de soporte de plataforma (H5 §B.5.9) sobre las tablas que el rol de plataforma PUEDE leer:
 * `tenant`, `empresa`, `persona`, `membresia` (solo `empresa_id`, `persona_id`, `rol`, `activo`: decisión
 * F1), `invitacion`, `invitacion_empresa`, `trabajo`, `auditoria_plataforma` y `referencia_de_error`.
 *
 * Reglas de este archivo, que una prueba comprueba leyendo su propio texto:
 *  - NUNCA toca las tablas operativas (`sucursal`, `asignacion_sucursal`, `invitacion_sucursal`,
 *    `auditoria_empresa`): el rol de plataforma no tiene permiso y la lectura fallaría con 42501.
 *  - NUNCA selecciona `token_hash` (de `invitacion` ni de `invitacion_empresa`) ni `clave_idempotencia`
 *    (de `trabajo`): las columnas se piden una por una, jamás `selectAll`.
 *  - Solo lee. Todo lo que devuelve va ordenado por id (páginas estables).
 *
 * Con un contexto de plataforma sin actor vigente, las políticas restrictivas de 0004 dejan 0 filas.
 */
export type SoporteDb = {
  tenant: {
    id: Generated<string>;
    nombre: string;
    estado: string;
    motivo_estado: string | null;
    creado_en: Date;
  };
  empresa: {
    id: Generated<string>;
    tenant_id: string;
    cuit: string;
    razon_social: string;
    estado: string;
    motivo_estado: string | null;
    zona_horaria: string;
    moneda: string;
    creado_en: Date;
  };
  persona: { id: Generated<string>; email: string; activo_global: boolean };
  membresia: { empresa_id: string; persona_id: string; rol: string; activo: boolean };
  invitacion: {
    id: string;
    tenant_id: string;
    tipo: string;
    email: string;
    estado: string;
    emitida_en: Date;
    vence_en: Date;
    aceptada_por: string | null;
    reemplazada_por: string | null;
    version: number;
  };
  invitacion_empresa: { invitacion_id: string; empresa_id: string; rol: string; tipo: string };
  trabajo: {
    id: Generated<string>;
    empresa_id: string | null;
    tipo: string;
    datos: unknown;
    estado: string;
    intentos: number;
    ultimo_error: string | null;
    creado_en: Date;
    actualizado_en: Date;
  };
  auditoria_plataforma: {
    id: Generated<string>;
    actor: string;
    accion: string;
    entidad: string;
    entidad_id: string;
    antes: unknown;
    despues: unknown;
    creado_en: Date;
  };
  referencia_de_error: {
    id: Generated<string>;
    referencia: string;
    accion: string;
    motivo: string;
    empresa_id: string | null;
    persona_id: string | null;
    creado_en: Date;
  };
};

const ESTADOS_DE_EMPRESA: readonly EstadoDeEmpresa[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
const ESTADOS_DE_TENANT: readonly EstadoDeTenant[] = ["ACTIVE", "SUSPENDED"];
const TIPOS_DE_INVITACION: readonly TipoDeInvitacion[] = ["ALTA_GERENTE", "USUARIO"];
const ESTADOS_DE_INVITACION: readonly EstadoGuardado[] = ["PENDIENTE", "ACEPTADA", "REVOCADA"];

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

function aEmail(texto: string) {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new RangeError("email guardado inválido en la base");
  return r.valor;
}

/** El contenido de una columna `jsonb` (el driver ya lo trae parseado) como dato; `null` si no hay. */
const aDato = (valor: unknown): Dato => (valor ?? null) as Dato;

export function crearLecturaDeSoporteDePostgres(db: Kysely<SoporteDb>): LecturaDeSoporte {
  async function empresasConTenant(
    filtro: { tenantId: string | null; estado: string | null },
    pagina: { limite: number; despuesDeId: string | null },
  ): Promise<FilaDeEmpresa[]> {
    let consulta = db
      .selectFrom("empresa as e")
      .innerJoin("tenant as t", "t.id", "e.tenant_id")
      .select([
        "e.id",
        "e.tenant_id",
        "e.cuit",
        "e.razon_social",
        "e.estado",
        "e.motivo_estado",
        "t.estado as estado_del_tenant",
        "e.zona_horaria",
        "e.moneda",
        "e.creado_en",
      ])
      .orderBy("e.id")
      .limit(pagina.limite);
    if (filtro.tenantId !== null) consulta = consulta.where("e.tenant_id", "=", filtro.tenantId);
    if (filtro.estado !== null) consulta = consulta.where("e.estado", "=", filtro.estado);
    if (pagina.despuesDeId !== null) consulta = consulta.where("e.id", ">", pagina.despuesDeId);
    const filas = await consulta.execute();
    return filas.map((f) => ({
      id: empresaId(f.id),
      tenantId: tenantId(f.tenant_id),
      cuit: f.cuit,
      razonSocial: f.razon_social,
      estado: deLaLista(ESTADOS_DE_EMPRESA, f.estado, "estado de empresa"),
      motivoEstado: f.motivo_estado,
      estadoDelTenant: deLaLista(ESTADOS_DE_TENANT, f.estado_del_tenant, "estado de tenant"),
      zonaHoraria: f.zona_horaria,
      moneda: f.moneda,
      creadoEn: f.creado_en,
    }));
  }

  /**
   * Arma las invitaciones con sus empresas, en el orden de `ids`. Sin `invitacion_sucursal` (la
   * plataforma no la lee): las empresas llevan `sucursales: []`. Sin `token_hash`.
   */
  async function cargarInvitaciones(ids: readonly string[]): Promise<Invitacion[]> {
    if (ids.length === 0) return [];
    const cabeceras = await db
      .selectFrom("invitacion")
      .select([
        "id",
        "tenant_id",
        "tipo",
        "email",
        "estado",
        "emitida_en",
        "vence_en",
        "aceptada_por",
        "reemplazada_por",
        "version",
      ])
      .where("id", "in", [...ids])
      .execute();
    const empresas = await db
      .selectFrom("invitacion_empresa")
      .select(["invitacion_id", "empresa_id", "rol"])
      .where("invitacion_id", "in", [...ids])
      .orderBy("empresa_id")
      .execute();
    const porId = new Map(cabeceras.map((c) => [c.id, c] as const));
    return ids.flatMap((id): Invitacion[] => {
      const c = porId.get(id);
      if (c === undefined) return [];
      return [
        {
          id: invitacionId(c.id),
          tenantId: tenantId(c.tenant_id),
          tipo: deLaLista(TIPOS_DE_INVITACION, c.tipo, "tipo de invitación"),
          email: aEmail(c.email),
          estado: deLaLista(ESTADOS_DE_INVITACION, c.estado, "estado de invitación"),
          emitidaEn: c.emitida_en,
          venceEn: c.vence_en,
          empresas: empresas
            .filter((e) => e.invitacion_id === c.id)
            .map((e): EmpresaInvitada => ({
              empresaId: empresaId(e.empresa_id),
              rol: deLaLista(ROLES_DE_EMPRESA, e.rol, "rol"),
              sucursales: [],
            })),
          aceptadaPor: c.aceptada_por === null ? null : personaId(c.aceptada_por),
          reemplazadaPor: c.reemplazada_por === null ? null : invitacionId(c.reemplazada_por),
          version: c.version,
        },
      ];
    });
  }

  const aPersona = (f: { id: string; email: string; activo_global: boolean }): Persona => ({
    id: personaId(f.id),
    email: aEmail(f.email),
    activoGlobal: f.activo_global,
  });

  return {
    async listarTenants(pagina) {
      let consulta = db
        .selectFrom("tenant")
        .select(["id", "nombre", "estado", "motivo_estado", "creado_en"])
        .orderBy("id")
        .limit(pagina.limite);
      if (pagina.despuesDeId !== null) consulta = consulta.where("id", ">", pagina.despuesDeId);
      const filas = await consulta.execute();
      return filas.map((f) => ({
        id: tenantId(f.id),
        nombre: f.nombre,
        estado: deLaLista(ESTADOS_DE_TENANT, f.estado, "estado de tenant"),
        motivoEstado: f.motivo_estado,
        creadoEn: f.creado_en,
      }));
    },

    listarEmpresas(filtro, pagina) {
      return empresasConTenant(filtro, pagina);
    },

    async listarAltasPendientes(pagina) {
      const empresas = await empresasConTenant({ tenantId: null, estado: "PROVISIONING" }, pagina);
      if (empresas.length === 0) return [];
      // La última invitación del alta de cada empresa: la de `emitida_en` más reciente (desempate por id).
      const candidatas = await db
        .selectFrom("invitacion_empresa as ie")
        .innerJoin("invitacion as i", "i.id", "ie.invitacion_id")
        .select(["ie.empresa_id", "i.id as invitacion_id"])
        .where(
          "ie.empresa_id",
          "in",
          empresas.map((e) => e.id),
        )
        .where("i.tipo", "=", "ALTA_GERENTE")
        .orderBy("i.emitida_en", "desc")
        .orderBy("i.id", "desc")
        .execute();
      const ultimaPorEmpresa = new Map<string, string>();
      for (const c of candidatas) {
        if (!ultimaPorEmpresa.has(c.empresa_id))
          ultimaPorEmpresa.set(c.empresa_id, c.invitacion_id);
      }
      const invitaciones = await cargarInvitaciones([...new Set(ultimaPorEmpresa.values())]);
      return empresas.map((empresa) => {
        const id = ultimaPorEmpresa.get(empresa.id);
        return { empresa, invitacion: invitaciones.find((i) => i.id === id) ?? null };
      });
    },

    async listarInvitaciones(filtro, pagina) {
      let consulta = db.selectFrom("invitacion").select("id").orderBy("id").limit(pagina.limite);
      if (filtro.tenantId !== null) consulta = consulta.where("tenant_id", "=", filtro.tenantId);
      if (filtro.estado !== null) consulta = consulta.where("estado", "=", filtro.estado);
      if (filtro.empresaId !== null) {
        const empresa = filtro.empresaId;
        consulta = consulta.where(
          "id",
          "in",
          db
            .selectFrom("invitacion_empresa")
            .select("invitacion_id")
            .where("empresa_id", "=", empresa),
        );
      }
      if (pagina.despuesDeId !== null) consulta = consulta.where("id", ">", pagina.despuesDeId);
      const ids = await consulta.execute();
      return cargarInvitaciones(ids.map((i) => i.id));
    },

    async listarTrabajosFallidos(pagina) {
      let consulta = db
        .selectFrom("trabajo")
        .select([
          "id",
          "empresa_id",
          "tipo",
          "datos",
          "intentos",
          "ultimo_error",
          "creado_en",
          "actualizado_en",
        ])
        .where("estado", "=", "FALLIDO")
        .orderBy("id")
        .limit(pagina.limite);
      if (pagina.despuesDeId !== null) consulta = consulta.where("id", ">", pagina.despuesDeId);
      const filas = await consulta.execute();
      return filas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        empresaId: f.empresa_id === null ? null : empresaId(f.empresa_id),
        intentos: f.intentos,
        ultimoError: f.ultimo_error,
        datos: aDato(f.datos),
        creadoEn: f.creado_en,
        actualizadoEn: f.actualizado_en,
      }));
    },

    async consultarAuditoria(filtro, pagina) {
      let consulta = db
        .selectFrom("auditoria_plataforma")
        .select(["id", "actor", "accion", "entidad", "entidad_id", "antes", "despues", "creado_en"])
        .orderBy("id")
        .limit(pagina.limite);
      if (filtro.entidad !== null) consulta = consulta.where("entidad", "=", filtro.entidad);
      if (filtro.entidadId !== null) consulta = consulta.where("entidad_id", "=", filtro.entidadId);
      if (filtro.desde !== null) consulta = consulta.where("creado_en", ">=", filtro.desde);
      if (filtro.hasta !== null) consulta = consulta.where("creado_en", "<=", filtro.hasta);
      if (pagina.despuesDeId !== null) consulta = consulta.where("id", ">", pagina.despuesDeId);
      const filas = await consulta.execute();
      return filas.map((f) => ({
        id: String(f.id),
        actor: f.actor,
        accion: f.accion,
        entidad: f.entidad,
        entidadId: f.entidad_id,
        antes: aDato(f.antes),
        despues: aDato(f.despues),
        creadoEn: f.creado_en,
      }));
    },

    async buscarReferencias(referencia) {
      const filas = await db
        .selectFrom("referencia_de_error")
        .select(["referencia", "accion", "motivo", "empresa_id", "persona_id", "creado_en"])
        .where("referencia", "=", referencia)
        .orderBy("creado_en")
        .orderBy("id")
        .execute();
      return filas.map((f) => ({
        referencia: f.referencia,
        accion: f.accion,
        motivo: f.motivo,
        empresaId: f.empresa_id === null ? null : empresaId(f.empresa_id),
        personaId: f.persona_id === null ? null : personaId(f.persona_id),
        creadoEn: f.creado_en,
      }));
    },

    async estadosDeEmpresas(empresas) {
      const estados = new Map<
        EmpresaId,
        Readonly<{ empresa: EstadoDeEmpresa; tenant: EstadoDeTenant }>
      >();
      if (empresas.length === 0) return estados;
      const filas = await db
        .selectFrom("empresa as e")
        .innerJoin("tenant as t", "t.id", "e.tenant_id")
        .select(["e.id", "e.estado", "t.estado as estado_del_tenant"])
        .where("e.id", "in", [...empresas])
        .execute();
      for (const f of filas) {
        estados.set(empresaId(f.id), {
          empresa: deLaLista(ESTADOS_DE_EMPRESA, f.estado, "estado de empresa"),
          tenant: deLaLista(ESTADOS_DE_TENANT, f.estado_del_tenant, "estado de tenant"),
        });
      }
      return estados;
    },

    async personaPorEmail(email) {
      const fila = await db
        .selectFrom("persona")
        .select(["id", "email", "activo_global"])
        .where("email", "=", email)
        .executeTakeFirst();
      return fila === undefined ? null : aPersona(fila);
    },

    async personaPorId(id) {
      const fila = await db
        .selectFrom("persona")
        .select(["id", "email", "activo_global"])
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aPersona(fila);
    },

    async membresiasDe(persona, empresas): Promise<MembresiaVisible[]> {
      if (empresas.length === 0) return [];
      const filas = await db
        .selectFrom("membresia")
        .select(["empresa_id", "persona_id", "rol", "activo"])
        .where("persona_id", "=", persona)
        .where("empresa_id", "in", [...empresas])
        .orderBy("empresa_id")
        .execute();
      return filas.map((f) => ({
        empresaId: empresaId(f.empresa_id),
        personaId: personaId(f.persona_id),
        rol: deLaLista(ROLES_DE_EMPRESA, f.rol, "rol"),
        activo: f.activo,
      }));
    },

    async invitacionPorId(id: InvitacionId) {
      return (await cargarInvitaciones([id]))[0] ?? null;
    },

    /**
     * Módulos activables por empresa: todavía no existe la tabla (el único módulo, `administracion`, es
     * obligatorio y no se guarda), igual que en `autorizacion.ts`. Cuando aparezca el primero, cambian
     * las dos a la vez; una prueba de fidelidad contra los casos reales lo delataría.
     */
    modulosActivadosDe() {
      return Promise.resolve([]);
    },
  };
}
