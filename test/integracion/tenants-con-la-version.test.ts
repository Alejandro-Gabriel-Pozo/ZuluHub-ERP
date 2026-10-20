import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { estadoDeDecision, vigenteEn } from "../../src/capacidades/planes/vigencia";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import type { TenantConLaVersion } from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import {
  asignarPlan,
  crearBorradorDePlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlanPublicado,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import { adminInexistente, crearAdminDeBase } from "./plataforma-apoyo";
import {
  clave,
  comoAdminAhora,
  comoAdministradorAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  enLaHora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";
import { plataformaEn, sembrarEmpresa, suspenderTenant } from "./soporte-datos";

/**
 * `tenantsConLaVersion` contra Postgres real: los tenants cuya asignación VIGENTE es una versión de plan,
 * paginados, con el número que `migrarTenantsDeVersion` pide como `numeroEsperado`. Dos marcas y varios
 * tenants con historias distintas (programadas, cambios, suspendido) para ver que nada se cuela, y la prueba
 * de punta a punta: una página de esta consulta alimenta el lote de migración y funciona. Base propia.
 */

const base = inject("baseDePruebas");
const INEXISTENTE = "00000000-0000-4000-8000-00000000dead";
const HORA = 3_600_000;

describe.skipIf(base === null)("tenantsConLaVersion: contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let consultas: ConsultasDeMarcasYPlanes;
  let casos: CasosDeUsoDeMarcasYPlanes;

  const s = {
    marcaA: "",
    marcaB: "",
    plan: "",
    v1: "",
    v2: "",
    otroPlan: "",
    w1: "",
    t1: "", // marca A: v1 vigente, dos empresas (una cancelada)
    t2: "", // marca B: v1 vigente + v2 programada (+1 h): última asignación = 2
    t3: "", // marca A: v2 vigente
    t4: "", // marca B: v1 y después v2 (rige v2); 3 asignaciones
    t5: "", // marca A: v1 vigente, tenant suspendido
    t6: "", // marca B: otro plan
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    consultas = crearConsultasDeMarcasYPlanesDePrueba(entorno);
    casos = crearCasosDeMarcasYPlanes(entorno);

    s.marcaA = await crearMarca(dueno, { codigo: "marca-a" });
    s.marcaB = await crearMarca(dueno, { codigo: "marca-b" });
    const p = await crearPlanPublicado(dueno, { codigo: "plan-principal", modulos: ["caja"] });
    s.plan = p.plan;
    s.v1 = p.version;
    const v2 = await crearBorradorDePlan(dueno, p.plan, { modulos: ["caja", "ventas"] });
    await publicarVersionDePlan(dueno, v2);
    s.v2 = v2;
    const otro = await crearPlanPublicado(dueno, { codigo: "plan-otro", modulos: [] });
    s.otroPlan = otro.plan;
    s.w1 = otro.version;

    s.t1 = (await crearMundoDeMarca(dueno, { marca: s.marcaA })).tenant;
    await sembrarEmpresa(dueno, s.t1, { estado: "CANCELLED" });
    s.t2 = (await crearMundoDeMarca(dueno, { marca: s.marcaB })).tenant;
    s.t3 = (await crearMundoDeMarca(dueno, { marca: s.marcaA })).tenant;
    s.t4 = (await crearMundoDeMarca(dueno, { marca: s.marcaB })).tenant;
    s.t5 = (await crearMundoDeMarca(dueno, { marca: s.marcaA })).tenant;
    s.t6 = (await crearMundoDeMarca(dueno, { marca: s.marcaB })).tenant;
    await suspenderTenant(dueno, s.t5);

    await asignarPlan(dueno, s.t1, s.v1, { origen: "ALTA" });
    await asignarPlan(dueno, s.t2, s.v1, { origen: "ALTA" });
    await asignarPlan(dueno, s.t2, s.v2, { desdeSegundos: 3600 });
    await asignarPlan(dueno, s.t3, s.v2, { origen: "ALTA" });
    await asignarPlan(dueno, s.t4, s.v1, { origen: "ALTA", desdeSegundos: -60 });
    await asignarPlan(dueno, s.t4, s.v2, { desdeSegundos: -30 });
    await asignarPlan(dueno, s.t5, s.v1, { origen: "ALTA" });
    await asignarPlan(dueno, s.t6, s.w1, { origen: "ALTA" });
  });

  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const de = async (
    versionDePlanId: string,
    extra: { limite?: number; despuesDeId?: string } = {},
  ) => exito(await consultas.tenantsConLaVersion(comoAdminAhora(), { versionDePlanId, ...extra }));
  const idsDe = (filas: readonly TenantConLaVersion[]) => filas.map((f) => f.tenantId);

  it("trae los tenants cuya asignación VIGENTE es la versión, con lo que el lote necesita de cada uno", async () => {
    const { filas } = await de(s.v1);
    expect(idsDe(filas)).toEqual([s.t1, s.t2, s.t5].sort());
    const f = (id: string) => filas.find((x) => x.tenantId === id);
    expect(f(s.t1)).toEqual({
      tenantId: s.t1,
      nombre: expect.any(String) as string,
      estado: "ACTIVE",
      marcaId: s.marcaA,
      marcaCodigo: "marca-a",
      ultimoNumeroDeAsignacion: 1,
      hayProgramada: false,
      empresas: 1, // la cancelada no cuenta
    });
    // t2: rige la v1 (número 1) pero la última decisión es la programada (número 2): ESE es el numeroEsperado.
    expect(f(s.t2)).toMatchObject({
      marcaCodigo: "marca-b",
      ultimoNumeroDeAsignacion: 2,
      hayProgramada: true,
      empresas: 1,
    });
    expect(f(s.t5)).toMatchObject({ estado: "SUSPENDED", ultimoNumeroDeAsignacion: 1 });
  });

  it("no trae a quien tuvo la versión y ya tiene otra, ni a quien la tiene solo programada, ni a otro plan", async () => {
    const v1 = idsDe((await de(s.v1)).filas);
    expect(v1).not.toContain(s.t4); // pasó a la v2
    expect(v1).not.toContain(s.t3);
    expect(v1).not.toContain(s.t6);
    const v2 = await de(s.v2);
    expect(idsDe(v2.filas)).toEqual([s.t3, s.t4].sort());
    // t2 tiene la v2 programada, todavía no vigente.
    expect(idsDe(v2.filas)).not.toContain(s.t2);
    expect(v2.filas.find((x) => x.tenantId === s.t4)).toMatchObject({
      ultimoNumeroDeAsignacion: 2,
      hayProgramada: false,
    });
    expect(idsDe((await de(s.w1)).filas)).toEqual([s.t6]);
  });

  it("con el reloj en otro momento, la vigente y la programada cambian como dicen las funciones puras", async () => {
    const { rows } = await dueno.query<{
      tenant_id: string;
      numero: number;
      vigente_desde: Date;
      version_de_plan_id: string;
    }>("select tenant_id, numero, vigente_desde, version_de_plan_id from plan_de_tenant");
    const base0 = Date.now();
    for (const momento of [0, 2 * HORA]) {
      const cuando = new Date(base0 + momento);
      for (const version of [s.v1, s.v2]) {
        const r = exito(
          await consultas.tenantsConLaVersion(plataformaEn(cuando), { versionDePlanId: version }),
        );
        const esperados = new Set<string>();
        for (const tenant of new Set(rows.map((x) => x.tenant_id))) {
          const historial = rows
            .filter((x) => x.tenant_id === tenant)
            .map((x) => ({
              numero: x.numero,
              vigenteDesde: x.vigente_desde,
              v: x.version_de_plan_id,
            }));
          if (vigenteEn(historial, cuando)?.v === version) esperados.add(tenant);
        }
        expect(idsDe(r.filas).sort(), `+${momento / HORA} h`).toEqual([...esperados].sort());
        for (const fila of r.filas) {
          const historial = rows
            .filter((x) => x.tenant_id === fila.tenantId)
            .map((x) => ({ numero: x.numero, vigenteDesde: x.vigente_desde }));
          expect(fila.hayProgramada).toBe(
            historial.some((a) => estadoDeDecision(historial, a, cuando) === "PROGRAMADA"),
          );
          expect(fila.ultimoNumeroDeAsignacion).toBe(Math.max(...historial.map((a) => a.numero)));
        }
      }
    }
    // A las dos horas la v2 programada de t2 ya rige: t2 pasó de la v1 a la v2.
    const dentroDeDos = exito(
      await consultas.tenantsConLaVersion(enLaHora(new Date(base0 + 2 * HORA)), {
        versionDePlanId: s.v2,
      }),
    );
    expect(idsDe(dentroDeDos.filas)).toContain(s.t2);
  });

  it("una versión sin tenants da una lista vacía; una que no existe, VERSION_DE_PLAN_NO_ENCONTRADA", async () => {
    const borrador = await crearBorradorDePlan(dueno, s.otroPlan, { modulos: [] });
    expect(await de(borrador)).toEqual({ filas: [], siguienteDespuesDeId: null });
    expect(
      falla(
        await consultas.tenantsConLaVersion(comoAdminAhora(), { versionDePlanId: INEXISTENTE }),
      ),
    ).toBe("VERSION_DE_PLAN_NO_ENCONTRADA");
  });

  it("valida el id, el límite y el cursor con sus errores", async () => {
    const pedir = (entrada: { versionDePlanId: string; limite?: number; despuesDeId?: string }) =>
      consultas.tenantsConLaVersion(comoAdminAhora(), entrada);
    expect(falla(await pedir({ versionDePlanId: "x" }))).toBe("ID_INVALIDO");
    expect(falla(await pedir({ versionDePlanId: s.v1, limite: 0 }))).toBe("LIMITE_INVALIDO");
    expect(falla(await pedir({ versionDePlanId: s.v1, limite: 101 }))).toBe("LIMITE_INVALIDO");
    expect(falla(await pedir({ versionDePlanId: s.v1, despuesDeId: "x" }))).toBe("CURSOR_INVALIDO");
    // El id en mayúsculas se acepta.
    expect((await pedir({ versionDePlanId: s.v1.toUpperCase() })).ok).toBe(true);
  });

  it("pagina por id: cada tenant una vez, en orden, y una página corta no tiene siguiente", async () => {
    const extra: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const t = (await crearMundoDeMarca(dueno, { marca: i % 2 === 0 ? s.marcaA : s.marcaB }))
        .tenant;
      await asignarPlan(dueno, t, s.v1, { origen: "ALTA" });
      extra.push(t);
    }
    const todos = (await de(s.v1, { limite: 100 })).filas;
    expect(todos).toHaveLength(15);
    expect(idsDe(todos)).toEqual(idsDe(todos).slice().sort());
    const vistos: string[] = [];
    let despuesDeId: string | undefined;
    let paginas = 0;
    for (;;) {
      const pagina = await de(s.v1, {
        limite: 4,
        ...(despuesDeId === undefined ? {} : { despuesDeId }),
      });
      vistos.push(...idsDe(pagina.filas));
      paginas += 1;
      if (pagina.siguienteDespuesDeId === null) break;
      expect(pagina.filas).toHaveLength(4);
      despuesDeId = pagina.siguienteDespuesDeId;
    }
    expect(vistos).toEqual(idsDe(todos));
    expect(paginas).toBe(4);
    for (const t of extra) expect(vistos).toContain(t);
  });

  it("de punta a punta: una página alimenta migrarTenantsDeVersion con su ultimoNumeroDeAsignacion y migra a todos", async () => {
    const pagina = await de(s.v1, { limite: 100 });
    expect(pagina.filas.length).toBeGreaterThan(10);
    const contexto = comoAdminAhora();
    const lote = {
      claveDeLote: `lote-${clave().slice(6)}`,
      versionDePlanId: s.v2,
      vigenteDesde: contexto.ahora,
      motivo: "migración a la versión 2",
      tenants: pagina.filas.map((f) => ({
        tenantId: f.tenantId,
        numeroEsperado: f.ultimoNumeroDeAsignacion,
      })),
      // t2 tiene una programada: hay que decir que se la reemplaza.
      reemplazaProgramada: true,
    };
    const antes = await dueno.query<{ n: number }>("select count(*)::int as n from plan_de_tenant");
    const r = exito(await casos.migrarTenantsDeVersion(contexto, lote));
    expect(r.resultados).toHaveLength(pagina.filas.length);
    for (const resultado of r.resultados) {
      expect(resultado, resultado.tenantId).toMatchObject({ resultado: "MIGRADO", error: null });
    }
    // Se crearon asignaciones nuevas: una por tenant migrado.
    const despues = await dueno.query<{ n: number }>(
      "select count(*)::int as n from plan_de_tenant",
    );
    expect((despues.rows[0]?.n ?? 0) - (antes.rows[0]?.n ?? 0)).toBe(pagina.filas.length);
    // Ahora ninguno tiene la v1 vigente, y todos tienen la v2 con un número más.
    expect((await de(s.v1, { limite: 100 })).filas).toEqual([]);
    const enV2 = (await de(s.v2, { limite: 100 })).filas;
    for (const f of pagina.filas) {
      const nueva = enV2.find((x) => x.tenantId === f.tenantId);
      expect(nueva, f.tenantId).toBeDefined();
      expect(nueva?.ultimoNumeroDeAsignacion).toBe(f.ultimoNumeroDeAsignacion + 1);
    }
    // Lo viejo no sirve más: con los números de antes, el lote ya sería VERSION_DESACTUALIZADA.
    const repetido = exito(
      await casos.migrarTenantsDeVersion(contexto, {
        ...lote,
        claveDeLote: `lote-${clave().slice(6)}`,
        versionDePlanId: s.w1,
      }),
    );
    for (const resultado of repetido.resultados) {
      expect(resultado.error, resultado.tenantId).toBe("VERSION_DESACTUALIZADA");
    }
  });

  it("quién puede: ADMIN y SOPORTE sí; de baja o inexistente, SIN_PERMISO; solo lee", async () => {
    const antes = await huellaDeEscrituras(dueno);
    for (const contexto of [comoAdminAhora(), comoSoporteAhora()]) {
      expect((await consultas.tenantsConLaVersion(contexto, { versionDePlanId: s.v2 })).ok).toBe(
        true,
      );
    }
    const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
    for (const contexto of [
      comoAdministradorAhora(deBaja.id),
      comoAdministradorAhora(adminInexistente()),
    ]) {
      expect(await consultas.tenantsConLaVersion(contexto, { versionDePlanId: s.v2 })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    }
    expect(await huellaDeEscrituras(dueno)).toEqual(antes);
  });
});
