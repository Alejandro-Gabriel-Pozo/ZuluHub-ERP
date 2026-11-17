import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../capacidades/permisos/roles";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../contexto/estados";
import type { Persona } from "../../modulos/identidad/publico";
import {
  empresaId,
  personaId,
  tenantId,
  type EmpresaId,
  type InvitacionId,
} from "../../primitivas/identificadores/marca";
import type { LecturaDeSoporte, MembresiaVisible } from "../../plataforma/consultas/contrato";
import type { SoporteDb } from "./soporte-de-plataforma-db";
import {
  ESTADOS_DE_EMPRESA,
  ESTADOS_DE_TENANT,
  deLaLista,
  aEmail,
  aDato,
} from "./soporte-de-plataforma-comunes";
import { crearListasDeSoporte } from "./soporte-de-plataforma-listas";

/**
 * Lectura de soporte de plataforma (H5 §B.5.9) sobre las tablas que el rol de plataforma PUEDE leer:
 * `tenant`, `empresa`, `persona`, `membresia` (solo `empresa_id`, `persona_id`, `rol`, `activo`: decisión
 * F1), `invitacion`, `invitacion_empresa`, `trabajo`, `auditoria_plataforma` y `referencia_de_error`; y, para
 * mostrar la marca y el plan vigente de cada tenant en las listas de la consola, `marca`, `version_de_marca`,
 * `plan`, `version_de_plan`, `plan_de_tenant` y `ajuste_de_perilla` (la migración 0007 le da `SELECT` a
 * plataforma sobre todas ellas; solo las columnas que se piden acá).
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

export type { SoporteDb } from "./soporte-de-plataforma-db";

export function crearLecturaDeSoporteDePostgres(db: Kysely<SoporteDb>): LecturaDeSoporte {
  const { empresasConTenant, empresasAmpliadas, tenantsAmpliados, cargarInvitaciones } =
    crearListasDeSoporte(db);

  const aPersona = (f: { id: string; email: string; activo_global: boolean }): Persona => ({
    id: personaId(f.id),
    email: aEmail(f.email),
    activoGlobal: f.activo_global,
  });

  return {
    listarTenants(filtro, pagina, ahora) {
      return tenantsAmpliados(filtro, pagina, ahora);
    },

    async ajustesDeTenants(tenants, perilla) {
      if (tenants.length === 0) return [];
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .select(["tenant_id", "perilla", "empresa_id", "numero", "vigente_desde", "valor"])
        .where("tenant_id", "in", [...tenants])
        .where("perilla", "=", perilla)
        .where("empresa_id", "is", null)
        .orderBy("tenant_id")
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        tenantId: tenantId(f.tenant_id),
        perilla: f.perilla,
        empresaId: null,
        numero: f.numero,
        vigenteDesde: f.vigente_desde,
        valor: f.valor,
      }));
    },

    listarEmpresas(filtro, pagina, ahora) {
      return empresasAmpliadas(filtro, pagina, ahora);
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
