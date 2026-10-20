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
  marcaComercialId,
  personaId,
  planId,
  tenantId,
  versionDePlanId,
  type EmpresaId,
  type InvitacionId,
} from "../../primitivas/identificadores/marca";
import { patronDeContiene } from "../../plataforma/dominio/soporte/consulta";
import type {
  FilaDeEmpresa,
  FilaDeEmpresaAmpliada,
  FilaDeTenant,
  FiltroDeEmpresas,
  FiltroDeTenants,
  LecturaDeSoporte,
  MembresiaVisible,
} from "../../plataforma/consultas/contrato";
import type { Dato } from "../../puertos/sin-secretos";

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
export type SoporteDb = {
  tenant: {
    id: Generated<string>;
    nombre: string;
    estado: string;
    motivo_estado: string | null;
    creado_en: Date;
    marca_id: string;
  };
  marca: { id: string; codigo: string };
  version_de_marca: {
    marca_id: string;
    numero: number | null;
    estado: string;
    vigente_desde: Date | null;
    nombre_visible: string | null;
  };
  plan: { id: string; codigo: string };
  version_de_plan: {
    id: string;
    plan_id: string;
    numero: number | null;
    nombre_comercial: string;
    perillas: unknown;
  };
  plan_de_tenant: {
    tenant_id: string;
    numero: number;
    version_de_plan_id: string;
    vigente_desde: Date;
  };
  ajuste_de_perilla: {
    tenant_id: string;
    empresa_id: string | null;
    perilla: string;
    numero: number;
    valor: string;
    vigente_desde: Date;
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

/** Un `jsonb` que es un objeto (el driver ya lo trae parseado); `null` si no hay o no es un objeto. */
const objetoODeNulo = (valor: unknown): Readonly<Record<string, unknown>> | null =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Readonly<Record<string, unknown>>)
    : null;

/** El contenido de una columna `jsonb` (el driver ya lo trae parseado) como dato; `null` si no hay. */
const aDato = (valor: unknown): Dato => (valor ?? null) as Dato;

/** Las columnas de marca y plan vigente que trae `tenantsConMarcaYPlan` (el plan es todo nulo si ninguna asignación empezó). */
type ColumnasDeMarcaYPlan = {
  marca_id: string;
  marca_codigo: string;
  marca_nombre_visible: string | null;
  version_de_plan_id: string | null;
  plan_id: string | null;
  plan_codigo: string | null;
  plan_nombre_comercial: string | null;
  plan_version_numero: number | null;
  plan_programado: unknown;
};

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
   * Cada tenant con su marca y su plan VIGENTE a `ahora`, en una sola sentencia (sin lecturas por fila).
   * Las dos reglas de vigencia son las de siempre, escritas en SQL y comprobadas contra las funciones puras
   * por una prueba de integración:
   *  - plan vigente (`vigenteEn`): la asignación de mayor número entre las que ya empezaron;
   *  - plan programado (`estadoDeDecision`): una asignación que todavía no empezó y a la que ninguna de mayor
   *    número, que empiece a su hora o antes, deja sin efecto;
   *  - nombre visible de la marca (`versionVigente`): el de la versión confirmada de mayor número que ya empezó.
   */
  const tenantsConMarcaYPlan = (ahora: Date) =>
    db
      .selectFrom("tenant as t")
      .innerJoin("marca as m", "m.id", "t.marca_id")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("version_de_marca as vm")
            .select("vm.nombre_visible")
            .whereRef("vm.marca_id", "=", "t.marca_id")
            .where("vm.estado", "=", "CONFIRMADA")
            .where("vm.vigente_desde", "<=", ahora)
            .orderBy("vm.numero", "desc")
            .limit(1)
            .as("mv"),
        (unir) => unir.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("plan_de_tenant as a")
            .select("a.version_de_plan_id")
            .whereRef("a.tenant_id", "=", "t.id")
            .where("a.vigente_desde", "<=", ahora)
            .orderBy("a.numero", "desc")
            .limit(1)
            .as("av"),
        (unir) => unir.onTrue(),
      )
      .leftJoin("version_de_plan as v", "v.id", "av.version_de_plan_id")
      .leftJoin("plan as p", "p.id", "v.plan_id")
      .select((eb) => [
        "t.id as id",
        "t.nombre as nombre",
        "t.estado as estado",
        "t.motivo_estado as motivo_estado",
        "t.creado_en as creado_en",
        "t.marca_id as marca_id",
        "m.codigo as marca_codigo",
        "mv.nombre_visible as marca_nombre_visible",
        "v.id as version_de_plan_id",
        "v.plan_id as plan_id",
        "p.codigo as plan_codigo",
        "v.nombre_comercial as plan_nombre_comercial",
        "v.numero as plan_version_numero",
        "v.perillas as perillas_del_plan",
        eb
          .exists(
            eb
              .selectFrom("plan_de_tenant as pr")
              .select("pr.tenant_id")
              .whereRef("pr.tenant_id", "=", "t.id")
              .where("pr.vigente_desde", ">", ahora)
              .where((eb2) =>
                eb2.not(
                  eb2.exists(
                    eb2
                      .selectFrom("plan_de_tenant as po")
                      .select("po.tenant_id")
                      .whereRef("po.tenant_id", "=", "pr.tenant_id")
                      .whereRef("po.numero", ">", "pr.numero")
                      .whereRef("po.vigente_desde", "<=", "pr.vigente_desde"),
                  ),
                ),
              ),
          )
          .as("plan_programado"),
      ]);

  /** La marca y el plan vigente de una fila de `tenantsConMarcaYPlan`; el plan es todo nulo si ninguna asignación empezó. */
  function marcaYPlanDe(f: ColumnasDeMarcaYPlan) {
    return {
      marcaId: marcaComercialId(f.marca_id),
      marcaCodigo: f.marca_codigo,
      marcaNombreVisible: f.marca_nombre_visible,
      planId: f.plan_id === null ? null : planId(f.plan_id),
      versionDePlanId: f.version_de_plan_id === null ? null : versionDePlanId(f.version_de_plan_id),
      planCodigo: f.plan_codigo,
      planNombreComercial: f.plan_nombre_comercial,
      planVersionNumero: f.plan_version_numero,
      planProgramado: Boolean(f.plan_programado),
    };
  }

  async function empresasAmpliadas(
    filtro: FiltroDeEmpresas,
    pagina: { limite: number; despuesDeId: string | null },
    ahora: Date,
  ): Promise<FilaDeEmpresaAmpliada[]> {
    let consulta = db
      .selectFrom("empresa as e")
      .innerJoin(tenantsConMarcaYPlan(ahora).as("ta"), "ta.id", "e.tenant_id")
      .select([
        "e.id",
        "e.tenant_id",
        "e.cuit",
        "e.razon_social",
        "e.estado",
        "e.motivo_estado",
        "ta.estado as estado_del_tenant",
        "e.zona_horaria",
        "e.moneda",
        "e.creado_en",
        "ta.nombre as tenant_nombre",
        "ta.marca_id",
        "ta.marca_codigo",
        "ta.marca_nombre_visible",
        "ta.version_de_plan_id",
        "ta.plan_id",
        "ta.plan_codigo",
        "ta.plan_nombre_comercial",
        "ta.plan_version_numero",
        "ta.plan_programado",
      ])
      .orderBy("e.id")
      .limit(pagina.limite);
    if (filtro.tenantId !== null) consulta = consulta.where("e.tenant_id", "=", filtro.tenantId);
    if (filtro.estado !== null) consulta = consulta.where("e.estado", "=", filtro.estado);
    if (filtro.marcaId !== null) consulta = consulta.where("ta.marca_id", "=", filtro.marcaId);
    if (filtro.planId !== null) consulta = consulta.where("ta.plan_id", "=", filtro.planId);
    const efectivos = filtro.estadosEfectivos;
    if (efectivos !== null) {
      consulta = consulta.where((eb) =>
        eb.or(
          efectivos.map((par) =>
            eb.and([eb("ta.estado", "=", par.tenant), eb("e.estado", "=", par.empresa)]),
          ),
        ),
      );
    }
    const buscar = filtro.buscar;
    if (buscar !== null) {
      const texto = patronDeContiene(buscar.texto);
      const cuit = buscar.cuit === null ? null : patronDeContiene(buscar.cuit);
      consulta = consulta.where((eb) =>
        eb.or([
          eb("e.razon_social", "ilike", texto),
          eb("ta.nombre", "ilike", texto),
          ...(cuit === null ? [] : [eb("e.cuit", "like", cuit)]),
        ]),
      );
    }
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
      tenantNombre: f.tenant_nombre,
      ...marcaYPlanDe(f),
    }));
  }

  async function tenantsAmpliados(
    filtro: FiltroDeTenants,
    pagina: { limite: number; despuesDeId: string | null },
    ahora: Date,
  ): Promise<FilaDeTenant[]> {
    let consulta = db
      .selectFrom(tenantsConMarcaYPlan(ahora).as("ta"))
      .select((eb) => [
        "ta.id",
        "ta.nombre",
        "ta.estado",
        "ta.motivo_estado",
        "ta.creado_en",
        "ta.marca_id",
        "ta.marca_codigo",
        "ta.marca_nombre_visible",
        "ta.version_de_plan_id",
        "ta.plan_id",
        "ta.plan_codigo",
        "ta.plan_nombre_comercial",
        "ta.plan_version_numero",
        "ta.plan_programado",
        "ta.perillas_del_plan",
        // Las empresas que ocupan lugar contra el tope: todas menos las canceladas (como cuenta el alta).
        eb
          .selectFrom("empresa as ec")
          .select(eb.fn.countAll<string>().as("n"))
          .whereRef("ec.tenant_id", "=", "ta.id")
          .where("ec.estado", "<>", "CANCELLED")
          .as("empresas_en_uso"),
      ])
      .orderBy("ta.id")
      .limit(pagina.limite);
    if (filtro.marcaId !== null) consulta = consulta.where("ta.marca_id", "=", filtro.marcaId);
    if (filtro.planId !== null) consulta = consulta.where("ta.plan_id", "=", filtro.planId);
    if (filtro.buscar !== null) {
      consulta = consulta.where("ta.nombre", "ilike", patronDeContiene(filtro.buscar.texto));
    }
    if (pagina.despuesDeId !== null) consulta = consulta.where("ta.id", ">", pagina.despuesDeId);
    const filas = await consulta.execute();
    return filas.map((f) => ({
      id: tenantId(f.id),
      nombre: f.nombre,
      estado: deLaLista(ESTADOS_DE_TENANT, f.estado, "estado de tenant"),
      motivoEstado: f.motivo_estado,
      creadoEn: f.creado_en,
      ...marcaYPlanDe(f),
      empresasEnUso: Number(f.empresas_en_uso),
      perillasDelPlan: objetoODeNulo(f.perillas_del_plan),
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
