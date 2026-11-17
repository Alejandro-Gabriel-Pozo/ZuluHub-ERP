import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../capacidades/permisos/roles";
import type { EmpresaInvitada, Invitacion } from "../../modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
  personaId,
  planId,
  tenantId,
  versionDePlanId,
} from "../../primitivas/identificadores/marca";
import { patronDeContiene } from "../../plataforma/dominio/soporte/consulta";
import type {
  FilaDeEmpresa,
  FilaDeEmpresaAmpliada,
  FilaDeTenant,
  FiltroDeEmpresas,
  FiltroDeTenants,
} from "../../plataforma/consultas/contrato";
import type { SoporteDb } from "./soporte-de-plataforma-db";
import {
  ESTADOS_DE_EMPRESA,
  ESTADOS_DE_TENANT,
  TIPOS_DE_INVITACION,
  ESTADOS_DE_INVITACION,
  deLaLista,
  aEmail,
  objetoODeNulo,
  type ColumnasDeMarcaYPlan,
} from "./soporte-de-plataforma-comunes";

/** Las listas armadas de la lectura de soporte (empresas, tenants e invitaciones), que el adaptador compone. Las reglas de `soporte-de-plataforma.ts` (solo tablas legibles por plataforma, sin secretos, solo lectura) rigen también acá. */

export function crearListasDeSoporte(db: Kysely<SoporteDb>) {
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

  return { empresasConTenant, empresasAmpliadas, tenantsAmpliados, cargarInvitaciones };
}
