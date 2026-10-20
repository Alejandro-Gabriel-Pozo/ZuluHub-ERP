import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { estadoDeDecision, vigenteEn } from "../../src/capacidades/planes/vigencia";
import { estadoEfectivo } from "../../src/contexto/estados";
import { ESTADOS_EFECTIVOS } from "../../src/plataforma/dominio/soporte/consulta";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte } from "./entorno";
import {
  asignarPlan,
  ajustarPerilla,
  crearBorradorDePlan,
  crearMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import { crearConsultasDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import { plataformaEn, sembrarEmpresa, suspenderTenant } from "./soporte-datos";

/**
 * Las listas de tenants y de empresas AMPLIADAS para la consola (marca, plan vigente, empresas en uso con su
 * tope, filtros y búsqueda) contra Postgres real, con el rol de plataforma y el contexto firmado. Dos marcas
 * y varios tenants para comprobar que nada de uno se cuela en otro; que las reglas de vigencia escritas en SQL
 * dicen lo mismo que las funciones puras; y que la cantidad de sentencias NO crece con la cantidad de filas
 * (sin N+1). Base propia de este archivo.
 */

const base = inject("baseDePruebas");
const HORA = 3_600_000;

function esperar<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`no esperaba el error ${JSON.stringify(r.error)}`);
  return r.valor;
}

/**
 * Cuenta las sentencias que ejecuta la lectura de soporte: una por cada RESULTADO. (`transformQuery` también
 * se llama por cada subconsulta que se arma con el generador de expresiones: contaría de más.)
 */
class ContadorDeSentencias implements KyselyPlugin {
  cantidad = 0;
  transformQuery(args: PluginTransformQueryArgs) {
    return args.node;
  }
  transformResult(args: PluginTransformResultArgs) {
    this.cantidad += 1;
    return Promise.resolve(args.result);
  }
}

describe.skipIf(base === null)("listas ampliadas de tenants y empresas: contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeSoporte>;
  let consultas: ReturnType<typeof crearConsultasDeSoporte>;
  const contador = new ContadorDeSentencias();

  // Lo sembrado: dos marcas con nombre y una sin versión, dos planes y cuatro tenants con sus empresas.
  const s = {
    principal: "",
    marcaA: "",
    marcaB: "",
    planX: { plan: "", v1: "", v2: "" },
    planY: { plan: "", v1: "" },
    t1: "", // marca A, planX v1 (con ajuste a 5), una empresa activa y una cancelada
    t2: "", // marca B, planY v1 y planX v2 programada, empresa suspendida y una en alta
    t3: "", // marca principal, sin plan
    t4: "", // marca A, planX v1, tenant suspendido con una empresa activa
    e1: "",
    e2: "",
    e3: "",
    e4: "",
    e5: "",
    e6: "",
    e7: "",
  };
  const cuit = {} as Record<string, string>;

  const ahora = () => new Date();
  const admin = () => plataformaEn(ahora());

  async function tenantDe(marca: string, nombre: string): Promise<string> {
    const { rows } = await dueno.query<{ id: string }>(
      "insert into tenant (nombre, marca_id) values ($1, $2) returning id",
      [nombre, marca],
    );
    return rows[0]?.id as string;
  }

  /** Una empresa con CUIT conocido (el de `cuitAlAzar` ya está en la base: se lo lee). */
  async function empresaDe(
    tenant: string,
    razonSocial: string,
    estado: "ACTIVE" | "SUSPENDED" | "PROVISIONING" | "CANCELLED" | "DELETING" = "ACTIVE",
  ): Promise<string> {
    const id = await sembrarEmpresa(dueno, tenant, { razonSocial, estado });
    const { rows } = await dueno.query<{ cuit: string }>("select cuit from empresa where id = $1", [
      id,
    ]);
    cuit[id] = rows[0]?.cuit as string;
    return id;
  }

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeSoporte(propia.base, 10, (tx) => tx, contador);
    consultas = crearConsultasDeSoporte(entorno);

    s.principal = await marcaPrincipal(dueno);
    s.marcaA = await crearMarca(dueno, { codigo: "marca-a" });
    s.marcaB = await crearMarca(dueno, { codigo: "marca-b" });
    // Marca A: v1 vigente; v2 programada (a una hora): hoy se ve el nombre de la v1.
    await crearVersionDeMarcaConfirmada(dueno, s.marcaA, {
      nombreVisible: "Marca A (v1)",
      desdeSegundos: -30,
    });
    await crearVersionDeMarcaConfirmada(dueno, s.marcaA, {
      nombreVisible: "Marca A (v2)",
      desdeSegundos: 3600,
    });
    // Marca principal con nombre; marca B sin ninguna versión confirmada (solo un borrador no cuenta).
    await crearVersionDeMarcaConfirmada(dueno, s.principal, {
      nombreVisible: "Principal",
      desdeSegundos: -30,
    });

    const x = await crearPlanPublicado(dueno, {
      codigo: "plan-x",
      nombreComercial: "Plan X1",
      perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 3 } },
    });
    const x2 = await crearBorradorDePlan(dueno, x.plan, {
      nombreComercial: "Plan X2",
      perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 4 } },
    });
    await publicarVersionDePlan(dueno, x2);
    const y = await crearPlanPublicado(dueno, { codigo: "plan-y", nombreComercial: "Plan Y1" });
    s.planX = { plan: x.plan, v1: x.version, v2: x2 };
    s.planY = { plan: y.plan, v1: y.version };

    s.t1 = await tenantDe(s.marcaA, "Tenant Uno");
    s.t2 = await tenantDe(s.marcaB, "Tenant Dos");
    s.t3 = await tenantDe(s.principal, "Tenant Tres");
    s.t4 = await tenantDe(s.marcaA, "Tenant Cuatro");

    s.e1 = await empresaDe(s.t1, "Alfa Café SRL");
    s.e2 = await empresaDe(s.t1, "Beta Cancelada SA", "CANCELLED");
    s.e3 = await empresaDe(s.t2, "100% Bueno SA", "SUSPENDED");
    s.e4 = await empresaDe(s.t2, "Gamma_Alta SRL", "PROVISIONING");
    s.e5 = await empresaDe(s.t3, "Delta\\Barra SA");
    s.e6 = await empresaDe(s.t4, "Épsilon SA");
    s.e7 = await empresaDe(s.t4, "Zeta en Baja SA", "DELETING");
    await suspenderTenant(dueno, s.t4);

    await asignarPlan(dueno, s.t1, s.planX.v1, { origen: "ALTA" });
    await asignarPlan(dueno, s.t2, s.planY.v1, { origen: "ALTA" });
    await asignarPlan(dueno, s.t2, s.planX.v2, { desdeSegundos: 3600 });
    await asignarPlan(dueno, s.t4, s.planX.v1, { origen: "ALTA" });
    // El extra del cliente 1: su tope sube a 5 (vigente). Un ajuste de UNA empresa no mueve el del tenant.
    await ajustarPerilla(dueno, s.t1, "empresas_por_tenant", "5");
    await ajustarPerilla(dueno, s.t1, "empresas_por_tenant", "9", { empresa: s.e1 });
  });

  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  // ===========================================================================================
  // listarEmpresas
  // ===========================================================================================
  describe("listarEmpresas", () => {
    const todas = async () =>
      esperar(await consultas.listarEmpresas(admin(), { limite: 100 })).filas;
    const idsDe = (filas: readonly { id: string }[]) => filas.map((f) => f.id).sort();

    it("cada empresa trae el nombre de su tenant, su marca y su plan vigente", async () => {
      const filas = await todas();
      const e = (id: string) => filas.find((f) => f.id === id);
      expect(e(s.e1)).toMatchObject({
        tenantNombre: "Tenant Uno",
        marcaId: s.marcaA,
        marcaCodigo: "marca-a",
        marcaNombreVisible: "Marca A (v1)",
        planId: s.planX.plan,
        versionDePlanId: s.planX.v1,
        planCodigo: "plan-x",
        planNombreComercial: "Plan X1",
        planVersionNumero: 1,
        planProgramado: false,
        estadoEfectivo: "OPERA",
      });
      // Tenant 2: rige Y1 y hay X2 programada.
      expect(e(s.e3)).toMatchObject({
        tenantNombre: "Tenant Dos",
        marcaCodigo: "marca-b",
        marcaNombreVisible: null,
        planCodigo: "plan-y",
        planNombreComercial: "Plan Y1",
        planVersionNumero: 1,
        planProgramado: true,
        estadoEfectivo: "EMPRESA_SUSPENDIDA",
      });
      // Tenant 3: sin ninguna asignación.
      expect(e(s.e5)).toMatchObject({
        tenantNombre: "Tenant Tres",
        marcaCodigo: expect.any(String) as string,
        marcaNombreVisible: "Principal",
        planId: null,
        versionDePlanId: null,
        planCodigo: null,
        planNombreComercial: null,
        planVersionNumero: null,
        planProgramado: false,
      });
      expect(e(s.e6)?.estadoEfectivo).toBe("TENANT_SUSPENDIDO");
      expect(e(s.e7)?.estadoEfectivo).toBe("EMPRESA_EN_BAJA");
      expect(e(s.e2)?.estadoEfectivo).toBe("EMPRESA_CANCELADA");
      expect(e(s.e4)?.estadoEfectivo).toBe("EMPRESA_EN_ALTA");
    });

    it("sin criterios nuevos devuelve las mismas empresas de siempre, por id", async () => {
      const filas = await todas();
      expect(idsDe(filas)).toEqual([s.e1, s.e2, s.e3, s.e4, s.e5, s.e6, s.e7].sort());
      expect(filas.map((f) => f.id)).toEqual(filas.map((f) => f.id).sort());
    });

    it("filtra por marca: solo las de los tenants de esa marca, y la otra marca no se cuela", async () => {
      const deA = esperar(await consultas.listarEmpresas(admin(), { marcaId: s.marcaA })).filas;
      expect(idsDe(deA)).toEqual([s.e1, s.e2, s.e6, s.e7].sort());
      expect(deA.every((f) => f.marcaId === s.marcaA)).toBe(true);
      const deB = esperar(await consultas.listarEmpresas(admin(), { marcaId: s.marcaB })).filas;
      expect(idsDe(deB)).toEqual([s.e3, s.e4].sort());
      // Una marca sin tenants no es un error: es una lista vacía.
      const sinNadie = esperar(
        await consultas.listarEmpresas(admin(), {
          marcaId: "00000000-0000-4000-8000-00000000dead",
        }),
      );
      expect(sinNadie.filas).toEqual([]);
    });

    it("filtra por plan vigente: un plan que solo está PROGRAMADO en un tenant no cuenta; el tenant sin plan no aparece", async () => {
      const deX = esperar(await consultas.listarEmpresas(admin(), { planId: s.planX.plan })).filas;
      expect(idsDe(deX)).toEqual([s.e1, s.e2, s.e6, s.e7].sort());
      const deY = esperar(await consultas.listarEmpresas(admin(), { planId: s.planY.plan })).filas;
      expect(idsDe(deY)).toEqual([s.e3, s.e4].sort());
    });

    it("filtra por cada estado efectivo exactamente como lo calcula la columna", async () => {
      const filas = await todas();
      for (const estado of ESTADOS_EFECTIVOS) {
        const filtradas = esperar(
          await consultas.listarEmpresas(admin(), { estadoEfectivo: estado, limite: 100 }),
        ).filas;
        const esperadas = filas.filter(
          (f) => estadoEfectivo(f.estadoDelTenant, f.estado) === estado,
        );
        expect(idsDe(filtradas), estado).toEqual(idsDe(esperadas));
        expect(
          filtradas.every((f) => f.estadoEfectivo === estado),
          estado,
        ).toBe(true);
      }
      // Los seis estados están sembrados: ninguno pasa por vacío.
      expect(new Set(filas.map((f) => f.estadoEfectivo)).size).toBe(6);
    });

    it("busca por razón social sin distinguir mayúsculas, y por nombre de tenant", async () => {
      const porRazon = esperar(await consultas.listarEmpresas(admin(), { buscar: "ALFA caf" }));
      expect(idsDe(porRazon.filas)).toEqual([s.e1]);
      const porTenant = esperar(await consultas.listarEmpresas(admin(), { buscar: "tenant dos" }));
      expect(idsDe(porTenant.filas)).toEqual([s.e3, s.e4].sort());
      // Una letra con acento dentro del texto buscado se encuentra tal cual (el plegado de mayúsculas acentuadas lo decide la base).
      const acento = esperar(await consultas.listarEmpresas(admin(), { buscar: "psilon" }));
      expect(idsDe(acento.filas)).toEqual([s.e6]);
    });

    it("busca por CUIT con o sin guiones, completo o parcial", async () => {
      const completo = cuit[s.e1] as string;
      const conGuiones = `${completo.slice(0, 2)}-${completo.slice(2, 10)}-${completo.slice(10)}`;
      for (const texto of [completo, conGuiones, completo.slice(2, 10), conGuiones.slice(0, 6)]) {
        const r = esperar(await consultas.listarEmpresas(admin(), { buscar: texto }));
        expect(
          r.filas.map((f) => f.id),
          texto,
        ).toContain(s.e1);
      }
      const unico = esperar(await consultas.listarEmpresas(admin(), { buscar: conGuiones }));
      expect(idsDe(unico.filas)).toEqual([s.e1]);
    });

    it("los comodines de LIKE y la barra valen por sí mismos al buscar", async () => {
      const por = async (buscar: string) =>
        idsDe(esperar(await consultas.listarEmpresas(admin(), { buscar })).filas);
      // `%` solo trae lo que lo contiene (si fuera comodín traería las siete).
      expect(await por("%")).toEqual([s.e3]);
      expect(await por("100%")).toEqual([s.e3]);
      // `_` solo trae lo que tiene un guion bajo (como comodín traería cualquier nombre con un carácter).
      expect(await por("_")).toEqual([s.e4]);
      expect(await por("a_a")).toEqual([s.e4]);
      expect(await por("\\")).toEqual([s.e5]);
      expect(await por("a\\b")).toEqual([s.e5]);
      expect(await por("noexiste%")).toEqual([]);
    });

    it("los criterios se suman con Y", async () => {
      const r = esperar(
        await consultas.listarEmpresas(admin(), {
          marcaId: s.marcaA,
          estadoEfectivo: "OPERA",
          planId: s.planX.plan,
          buscar: "alfa",
        }),
      );
      expect(idsDe(r.filas)).toEqual([s.e1]);
      const ninguna = esperar(
        await consultas.listarEmpresas(admin(), { marcaId: s.marcaB, estadoEfectivo: "OPERA" }),
      );
      expect(ninguna.filas).toEqual([]);
    });

    it("pagina por id con los filtros puestos: cada empresa una vez, en orden, y el cursor sigue filtrando", async () => {
      const vistas: string[] = [];
      let despuesDeId: string | undefined;
      for (;;) {
        const pagina = esperar(
          await consultas.listarEmpresas(admin(), { marcaId: s.marcaA, limite: 1, despuesDeId }),
        );
        vistas.push(...pagina.filas.map((f) => f.id));
        if (pagina.siguienteDespuesDeId === null) break;
        despuesDeId = pagina.siguienteDespuesDeId;
      }
      expect(vistas).toEqual([s.e1, s.e2, s.e6, s.e7].sort());
    });

    it("el plan y la marca de un tenant no se cuelan en las empresas de otro (aislamiento entre tenants)", async () => {
      const filas = await todas();
      const deUno = filas.filter((f) => f.tenantId === s.t1);
      const deDos = filas.filter((f) => f.tenantId === s.t2);
      expect(deUno.every((f) => f.planCodigo === "plan-x" && f.marcaCodigo === "marca-a")).toBe(
        true,
      );
      expect(deDos.every((f) => f.planCodigo === "plan-y" && f.marcaCodigo === "marca-b")).toBe(
        true,
      );
      expect(deUno.every((f) => f.planProgramado === false)).toBe(true);
      expect(deDos.every((f) => f.planProgramado === true)).toBe(true);
    });
  });

  // ===========================================================================================
  // listarTenants
  // ===========================================================================================
  describe("listarTenants", () => {
    const todos = async () =>
      esperar(await consultas.listarTenants(admin(), { limite: 100 })).filas;
    const idsDe = (filas: readonly { id: string }[]) => filas.map((f) => f.id).sort();

    it("cada tenant trae su marca, su plan vigente, sus empresas en uso y su tope efectivo", async () => {
      const filas = await todos();
      const t = (id: string) => filas.find((f) => f.id === id);
      // t1: plan X1 con tope 3, ajuste vigente del tenant a 5; la empresa cancelada no cuenta; el ajuste de UNA empresa no mueve el tope.
      expect(t(s.t1)).toMatchObject({
        nombre: "Tenant Uno",
        marcaId: s.marcaA,
        marcaCodigo: "marca-a",
        marcaNombreVisible: "Marca A (v1)",
        planCodigo: "plan-x",
        planNombreComercial: "Plan X1",
        planVersionNumero: 1,
        planProgramado: false,
        empresasEnUso: 1,
        limiteDeEmpresas: 5,
      });
      // t2: Y1 no fija el tope, rige la base (1); hay dos empresas en uso y X2 programada.
      expect(t(s.t2)).toMatchObject({
        planCodigo: "plan-y",
        planProgramado: true,
        empresasEnUso: 2,
        limiteDeEmpresas: 1,
      });
      // t3: sin plan ni ajuste, la base.
      expect(t(s.t3)).toMatchObject({
        planCodigo: null,
        planProgramado: false,
        empresasEnUso: 1,
        limiteDeEmpresas: 1,
      });
      // t4: tenant suspendido, X1 con tope 3; ambas empresas cuentan (una activa, una en baja).
      expect(t(s.t4)).toMatchObject({
        estado: "SUSPENDED",
        planCodigo: "plan-x",
        empresasEnUso: 2,
        limiteDeEmpresas: 3,
      });
      // Lo crudo del plan no sale a la consola.
      expect(Object.keys(t(s.t1) ?? {})).not.toContain("perillasDelPlan");
    });

    it("el tenant de otra marca tiene su propio plan y su propio tope: nada se mezcla", async () => {
      const filas = await todos();
      const uno = filas.find((f) => f.id === s.t1);
      const dos = filas.find((f) => f.id === s.t2);
      expect(uno?.limiteDeEmpresas).toBe(5);
      expect(dos?.limiteDeEmpresas).toBe(1);
      expect(uno?.marcaId).not.toBe(dos?.marcaId);
    });

    it("filtra por marca, por plan y por nombre", async () => {
      const deA = esperar(await consultas.listarTenants(admin(), { marcaId: s.marcaA }));
      expect(idsDe(deA.filas)).toEqual([s.t1, s.t4].sort());
      const deY = esperar(await consultas.listarTenants(admin(), { planId: s.planY.plan }));
      expect(idsDe(deY.filas)).toEqual([s.t2]);
      const porNombre = esperar(await consultas.listarTenants(admin(), { buscar: "TRES" }));
      expect(idsDe(porNombre.filas)).toEqual([s.t3]);
      const todosLosTenant = esperar(await consultas.listarTenants(admin(), { buscar: "tenant" }));
      expect(idsDe(todosLosTenant.filas)).toEqual([s.t1, s.t2, s.t3, s.t4].sort());
    });

    it("sin criterios trae todos los tenants, por id, y pagina de a uno sin repetir", async () => {
      const filas = await todos();
      expect(idsDe(filas)).toEqual([s.t1, s.t2, s.t3, s.t4].sort());
      expect(filas.map((f) => f.id)).toEqual(filas.map((f) => f.id).sort());
      const vistos: string[] = [];
      let despuesDeId: string | undefined;
      for (;;) {
        const pagina = esperar(await consultas.listarTenants(admin(), { limite: 1, despuesDeId }));
        vistos.push(...pagina.filas.map((f) => f.id));
        if (pagina.siguienteDespuesDeId === null) break;
        despuesDeId = pagina.siguienteDespuesDeId;
      }
      expect(vistos).toEqual(filas.map((f) => f.id));
    });
  });

  // ===========================================================================================
  // Las reglas de vigencia en SQL dicen lo mismo que las funciones puras
  // ===========================================================================================
  describe("el plan vigente y el programado en SQL coinciden con vigenteEn y estadoDeDecision", () => {
    const patrones: Record<
      string,
      Array<{ version: "x1" | "x2" | "y1"; desdeSegundos: number }>
    > = {
      sinNada: [],
      unaVigente: [{ version: "x1", desdeSegundos: -30 }],
      vigenteYProgramada: [
        { version: "x1", desdeSegundos: -30 },
        { version: "x2", desdeSegundos: 3600 },
      ],
      // La 3 pisa a la 2 (mayor número y empieza antes): la 2 nunca rige; la 3 queda programada.
      programadaPisadaPorOtra: [
        { version: "x1", desdeSegundos: -30 },
        { version: "x2", desdeSegundos: 7200 },
        { version: "y1", desdeSegundos: 3600 },
      ],
      // Mismo instante: la de mayor número deja sin efecto a la anterior.
      mismoInstante: [
        { version: "x1", desdeSegundos: -30 },
        { version: "x2", desdeSegundos: 3600 },
        { version: "y1", desdeSegundos: 3600 },
      ],
      soloProgramada: [{ version: "y1", desdeSegundos: 3600 }],
      dosVigentes: [
        { version: "x1", desdeSegundos: -30 },
        { version: "y1", desdeSegundos: -20 },
      ],
    };
    const tenants: Record<string, string> = {};

    beforeAll(async () => {
      const versiones = { x1: s.planX.v1, x2: s.planX.v2, y1: s.planY.v1 };
      for (const [nombre, asignaciones] of Object.entries(patrones)) {
        const marca = nombre.length % 2 === 0 ? s.marcaA : s.marcaB;
        tenants[nombre] = await tenantDe(marca, `Vigencia ${nombre}`);
        await empresaDe(tenants[nombre], `Empresa de ${nombre}`);
        for (const a of asignaciones) {
          await asignarPlan(dueno, tenants[nombre], versiones[a.version], {
            desdeSegundos: a.desdeSegundos,
          });
        }
      }
    });

    it("para cada patrón y en tres momentos distintos, la fila dice lo que dicen las funciones puras", async () => {
      const { rows } = await dueno.query<{
        tenant_id: string;
        numero: number;
        vigente_desde: Date;
        version_de_plan_id: string;
      }>("select tenant_id, numero, vigente_desde, version_de_plan_id from plan_de_tenant");
      const ahoraBase = Date.now();
      for (const momento of [0, 1.5 * HORA, 3 * HORA]) {
        const cuando = new Date(ahoraBase + momento);
        const contexto = plataformaEn(cuando);
        const filas = esperar(await consultas.listarTenants(contexto, { limite: 100 })).filas;
        const deEmpresas = esperar(await consultas.listarEmpresas(contexto, { limite: 100 })).filas;
        for (const [nombre, tenant] of Object.entries(tenants)) {
          const historial = rows
            .filter((r) => r.tenant_id === tenant)
            .map((r) => ({
              numero: r.numero,
              vigenteDesde: r.vigente_desde,
              versionDePlanId: r.version_de_plan_id,
            }));
          const vigente = vigenteEn(historial, cuando);
          const programada = historial.some(
            (a) => estadoDeDecision(historial, a, cuando) === "PROGRAMADA",
          );
          const fila = filas.find((f) => f.id === tenant);
          const etiqueta = `${nombre} a +${momento / HORA} h`;
          expect(fila?.versionDePlanId ?? null, etiqueta).toBe(vigente?.versionDePlanId ?? null);
          expect(fila?.planProgramado, etiqueta).toBe(programada);
          const empresa = deEmpresas.find((f) => f.tenantId === tenant);
          expect(empresa?.versionDePlanId ?? null, etiqueta).toBe(vigente?.versionDePlanId ?? null);
          expect(empresa?.planProgramado, etiqueta).toBe(programada);
        }
      }
    });

    it("hay patrones que ejercen cada rama: con programada, sin ella, pisada y sin ninguna vigente", async () => {
      const filas = esperar(await consultas.listarTenants(admin(), { limite: 100 })).filas;
      const de = (n: string) => filas.find((f) => f.id === tenants[n]);
      expect(de("sinNada")).toMatchObject({ versionDePlanId: null, planProgramado: false });
      expect(de("soloProgramada")).toMatchObject({ versionDePlanId: null, planProgramado: true });
      expect(de("vigenteYProgramada")).toMatchObject({
        versionDePlanId: s.planX.v1,
        planProgramado: true,
      });
      expect(de("dosVigentes")).toMatchObject({
        versionDePlanId: s.planY.v1,
        planProgramado: false,
      });
    });
  });

  // ===========================================================================================
  // Sin N+1
  // ===========================================================================================
  describe("la cantidad de sentencias no crece con la cantidad de filas", () => {
    /** Cuántas sentencias ejecutó la lectura al correr `trabajo`. */
    async function sentencias(trabajo: () => Promise<unknown>): Promise<number> {
      const antes = contador.cantidad;
      await trabajo();
      return contador.cantidad - antes;
    }

    it("listarEmpresas: una sentencia, con 7 filas o con 40", async () => {
      const pocas = await sentencias(() => consultas.listarEmpresas(admin(), { limite: 100 }));
      expect(pocas).toBe(1);
      for (let i = 0; i < 12; i += 1) {
        const tenant = await tenantDe(i % 2 === 0 ? s.marcaA : s.marcaB, `Masivo ${i}`);
        await asignarPlan(dueno, tenant, s.planX.v1, { origen: "ALTA" });
        for (let j = 0; j < 3; j += 1) await empresaDe(tenant, `Masiva ${i}-${j}`);
      }
      const antes = esperar(await consultas.listarEmpresas(admin(), { limite: 100 })).filas.length;
      expect(antes).toBeGreaterThan(40);
      const muchas = await sentencias(() => consultas.listarEmpresas(admin(), { limite: 100 }));
      expect(muchas).toBe(pocas);
    });

    it("listarTenants: dos sentencias (la página y los ajustes del tope), sean pocos o muchos los tenants", async () => {
      const cantidad = await sentencias(() => consultas.listarTenants(admin(), { limite: 100 }));
      expect(cantidad).toBe(2);
      const filas = esperar(await consultas.listarTenants(admin(), { limite: 100 })).filas;
      expect(filas.length).toBeGreaterThan(15);
    });

    it("con filtros y búsqueda sigue siendo la misma cantidad", async () => {
      expect(
        await sentencias(() =>
          consultas.listarEmpresas(admin(), {
            marcaId: s.marcaA,
            planId: s.planX.plan,
            estadoEfectivo: "OPERA",
            buscar: "Masiva",
            limite: 100,
          }),
        ),
      ).toBe(1);
    });
  });
});
