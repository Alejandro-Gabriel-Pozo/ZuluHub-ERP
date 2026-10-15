import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import { adminPlataformaId, tenantId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import { MARCA_PRINCIPAL_DE_PRUEBA, OTRA_MARCA_DE_PRUEBA } from "../utilidades/marcas";
import { crearBaseAparte, crearBarrera } from "./entorno";
import {
  contextoDeEmpresa,
  contextoDePlataforma,
  crearEntornoDeDerechos,
  type TxDeDerechos,
} from "./derechos-apoyo";
import { plataformaEn } from "./soporte-datos";
import {
  ajustarPerilla,
  asignarPlan,
  crearMundoDeMarca,
  crearPlanPublicado,
  type MundoDeMarca,
} from "./marcas-apoyo";

/**
 * Derechos de uso contra Postgres real y los roles reales de la aplicación y de la plataforma (M4,
 * marcas y planes §B.5.3, §B.5.4 y §D «Derechos»): el plan vigente, los ajustes vigentes (el más
 * específico gana), el aislamiento entre tenants y empresas, que NADA se cachea entre transacciones y
 * que una acción ve un plan o el otro, nunca una mezcla. Los catálogos de prueba traen más módulos y
 * perillas que los reales; un caso usa los reales para probar el cableado. Base propia.
 */

const base = inject("baseDePruebas");

type M = keyof typeof MODULOS_DE_PRUEBA;
type P = keyof typeof PERILLAS_DE_PRUEBA;
const CATALOGOS = { catalogoDeModulos: MODULOS_DE_PRUEBA, catalogoDePerillas: PERILLAS_DE_PRUEBA };

const lim = (limite: number | "ILIMITADO") => ({ tipo: "LIMITE", limite }) as const;
const interruptor = (encendida: boolean) => ({ tipo: "INTERRUPTOR", encendida }) as const;

describe.skipIf(base === null)("derechos de uso: lectura del plan y de los ajustes", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeDerechos<M, P>>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeDerechos<M, P>(propia.base, CATALOGOS);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const ahora = () => new Date();
  const enUnaHora = () => new Date(Date.now() + 3_600_000);

  /** Los derechos de la empresa, leídos como un caso de uso: dentro de su transacción. */
  async function deLaEmpresa(mundo: MundoDeMarca, en: Date = ahora()) {
    const r = await entorno.ejecutar(
      { contexto: contextoDeEmpresa(mundo.empresa, en, mundo.marca) },
      async (tx) =>
        ok(await tx.derechos.deLaEmpresa(contextoDeEmpresa(mundo.empresa, en, mundo.marca))),
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  async function delTenant(tenant: string, en: Date = ahora()) {
    const r = await entorno.ejecutar({ contexto: contextoDePlataforma(en) }, async (tx) =>
      ok(await tx.derechos.delTenant(contextoDePlataforma(en), tenantId(tenant))),
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  }

  const valor = (d: Awaited<ReturnType<typeof deLaEmpresa>>, perilla: P) => d.perillas.get(perilla);

  // ===============================================================================================
  describe("de la empresa", () => {
    it("sin plan ni ajustes: solo los módulos obligatorios y el estándar de cada perilla", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const d = await deLaEmpresa(mundo);
      expect(d.tenantId).toBe(mundo.tenant);
      expect(d.empresaId).toBe(mundo.empresa);
      expect(d.versionDePlan).toBeNull();
      expect([...d.modulosHabilitados]).toEqual(["nucleo"]);
      expect(d.perillas.size).toBe(Object.keys(PERILLAS_DE_PRUEBA).length);
      expect(valor(d, "empresas_por_tenant")).toEqual({ ...lim(1), origen: "BASE" });
      expect(valor(d, "con_sello")).toEqual({ ...interruptor(true), origen: "BASE" });
      expect(valor(d, "carta_por_qr")).toEqual({ ...interruptor(false), origen: "BASE" });
    });

    it("con plan: el techo de módulos y los valores del plan, con su origen", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { plan, version, numero } = await crearPlanPublicado(dueno, {
        modulos: ["caja", "ventas"],
        perillas: { cajas_por_sucursal: lim(3), carta_por_qr: interruptor(true) },
      });
      await asignarPlan(dueno, mundo.tenant, version, { origen: "ALTA" });
      const d = await deLaEmpresa(mundo);
      expect(d.versionDePlan).toEqual({ planId: plan, versionDePlanId: version, numero });
      expect([...d.modulosHabilitados].sort()).toEqual(["caja", "nucleo", "ventas"]);
      expect(valor(d, "cajas_por_sucursal")).toEqual({ ...lim(3), origen: "PLAN" });
      expect(valor(d, "carta_por_qr")).toEqual({ ...interruptor(true), origen: "PLAN" });
      // lo que el plan no dice vale el estándar
      expect(valor(d, "empresas_por_tenant")).toEqual({ ...lim(1), origen: "BASE" });
    });

    it("el ajuste del tenant reemplaza al plan; DEL_PLAN lo devuelve; ILIMITADO y 0 se entienden", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, {
        perillas: { cajas_por_sucursal: lim(3) },
      });
      await asignarPlan(dueno, mundo.tenant, version);
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "7");
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")).toEqual({
        ...lim(7),
        origen: "AJUSTE",
      });
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "ILIMITADO");
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")).toEqual({
        ...lim("ILIMITADO"),
        origen: "AJUSTE",
      });
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "0");
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")).toEqual({
        ...lim(0),
        origen: "AJUSTE",
      });
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "DEL_PLAN");
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")).toEqual({
        ...lim(3),
        origen: "PLAN",
      });
    });

    it("un interruptor se ajusta con 1 (encendido) y 0 (apagado)", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "1");
      expect(valor(await deLaEmpresa(mundo), "carta_por_qr")).toEqual({
        ...interruptor(true),
        origen: "AJUSTE",
      });
      await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "0");
      expect(valor(await deLaEmpresa(mundo), "carta_por_qr")).toEqual({
        ...interruptor(false),
        origen: "AJUSTE",
      });
    });

    it("el ajuste de la EMPRESA es más específico que el del tenant, y el de otra empresa del tenant no la toca", async () => {
      const a = await crearMundoDeMarca(dueno);
      const b = await crearMundoDeMarca(dueno, { tenant: a.tenant });
      await ajustarPerilla(dueno, a.tenant, "carta_por_qr", "0"); // todo el tenant: apagada
      await ajustarPerilla(dueno, a.tenant, "carta_por_qr", "1", { empresa: a.empresa });
      expect(valor(await deLaEmpresa(a), "carta_por_qr")).toEqual({
        ...interruptor(true),
        origen: "AJUSTE",
      });
      // La empresa B sigue con el del tenant y NO ve que A tiene uno propio.
      expect(valor(await deLaEmpresa(b), "carta_por_qr")).toEqual({
        ...interruptor(false),
        origen: "AJUSTE",
      });
      // Un ajuste solo de B tampoco llega a A.
      await ajustarPerilla(dueno, a.tenant, "con_sello", "0", { empresa: b.empresa });
      expect(valor(await deLaEmpresa(a), "con_sello")).toEqual({
        ...interruptor(true),
        origen: "BASE",
      });
      expect(valor(await deLaEmpresa(b), "con_sello")).toEqual({
        ...interruptor(false),
        origen: "AJUSTE",
      });
    });

    it("una perilla de ámbito TENANT ignora el ajuste de una empresa", async () => {
      const a = await crearMundoDeMarca(dueno);
      await ajustarPerilla(dueno, a.tenant, "empresas_por_tenant", "5", { empresa: a.empresa });
      expect(valor(await deLaEmpresa(a), "empresas_por_tenant")).toEqual({
        ...lim(1),
        origen: "BASE",
      });
      await ajustarPerilla(dueno, a.tenant, "empresas_por_tenant", "5");
      expect(valor(await deLaEmpresa(a), "empresas_por_tenant")).toEqual({
        ...lim(5),
        origen: "AJUSTE",
      });
    });

    it("`requiere`: una perilla encendida cuya requerida está apagada vale apagada", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      await ajustarPerilla(dueno, mundo.tenant, "confirmacion_por_sena", "1");
      expect(valor(await deLaEmpresa(mundo), "confirmacion_por_sena")).toEqual({
        ...interruptor(false),
        origen: "AJUSTE",
      });
      await ajustarPerilla(dueno, mundo.tenant, "reserva_provisoria", "1");
      expect(valor(await deLaEmpresa(mundo), "confirmacion_por_sena")).toEqual({
        ...interruptor(true),
        origen: "AJUSTE",
      });
    });

    it("lo que la base guarda pero el catálogo no entiende no rompe: perilla desconocida se ignora y un valor de otro tipo vuelve al plan", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, {
        perillas: { carta_por_qr: interruptor(true) },
      });
      await asignarPlan(dueno, mundo.tenant, version);
      await ajustarPerilla(dueno, mundo.tenant, "perilla_que_ya_no_existe", "5");
      await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "2"); // un interruptor no vale 2
      const d = await deLaEmpresa(mundo);
      expect(d.perillas.size).toBe(Object.keys(PERILLAS_DE_PRUEBA).length);
      expect(valor(d, "carta_por_qr")).toEqual({ ...interruptor(true), origen: "PLAN" });
    });

    it("un módulo o una perilla del plan que el catálogo ya no tiene no habilita nada", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, {
        modulos: ["caja", "modulo_que_ya_no_existe"],
        perillas: { perilla_que_ya_no_existe: lim(9) },
      });
      await asignarPlan(dueno, mundo.tenant, version);
      const d = await deLaEmpresa(mundo);
      expect([...d.modulosHabilitados].sort()).toEqual(["caja", "nucleo"]);
      expect(d.perillas.has("perilla_que_ya_no_existe" as P)).toBe(false);
    });
  });

  // ===============================================================================================
  describe("vigencia: la última decisión manda, con el `ahora` del contexto", () => {
    it("una asignación programada no rige hasta que su fecha llega; la de mayor número entre las que empezaron manda", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const vieja = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(2) } });
      const nueva = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(9) } });
      await asignarPlan(dueno, mundo.tenant, vieja.version);
      await asignarPlan(dueno, mundo.tenant, nueva.version, { desdeSegundos: 1800 }); // en media hora

      const hoy = await deLaEmpresa(mundo);
      expect(hoy.versionDePlan?.versionDePlanId).toBe(vieja.version);
      expect(valor(hoy, "cajas_por_sucursal")).toEqual({ ...lim(2), origen: "PLAN" });

      const enUnaHoraMas = await deLaEmpresa(mundo, enUnaHora());
      expect(enUnaHoraMas.versionDePlan?.versionDePlanId).toBe(nueva.version);
      expect(valor(enUnaHoraMas, "cajas_por_sucursal")).toEqual({ ...lim(9), origen: "PLAN" });
    });

    it("un ajuste programado tampoco rige antes de tiempo, y vuelve a regir el anterior", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "4");
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "8", { desdeSegundos: 1800 });
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")).toEqual({
        ...lim(4),
        origen: "AJUSTE",
      });
      expect(valor(await deLaEmpresa(mundo, enUnaHora()), "cajas_por_sucursal")).toEqual({
        ...lim(8),
        origen: "AJUSTE",
      });
    });

    it("`leidoEn` es el `ahora` del contexto, no el de la base", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const en = new Date("2030-01-01T00:00:00Z");
      expect((await deLaEmpresa(mundo, en)).leidoEn).toEqual(en);
    });
  });

  // ===============================================================================================
  describe("aislamiento", () => {
    it("el plan y los ajustes de otro tenant no llegan a la empresa", async () => {
      const a = await crearMundoDeMarca(dueno);
      const b = await crearMundoDeMarca(dueno);
      const planB = await crearPlanPublicado(dueno, {
        modulos: ["caja"],
        perillas: { cajas_por_sucursal: lim(50) },
      });
      await asignarPlan(dueno, b.tenant, planB.version);
      await ajustarPerilla(dueno, b.tenant, "carta_por_qr", "1");
      const deA = await deLaEmpresa(a);
      expect(deA.versionDePlan).toBeNull();
      expect([...deA.modulosHabilitados]).toEqual(["nucleo"]);
      expect(valor(deA, "carta_por_qr")?.origen).toBe("BASE");
      expect(valor(deA, "cajas_por_sucursal")).toEqual({ ...lim(1), origen: "BASE" });
      // y a la inversa: B sí tiene lo suyo
      const deB = await deLaEmpresa(b);
      expect(deB.versionDePlan?.versionDePlanId).toBe(planB.version);
    });

    it("pedir los derechos de una empresa que no es la del contexto firmado lanza (no se ve), también del mismo tenant", async () => {
      const a = await crearMundoDeMarca(dueno);
      const b = await crearMundoDeMarca(dueno, { tenant: a.tenant });
      const ajena = await crearMundoDeMarca(dueno);
      for (const otra of [b, ajena]) {
        await expect(
          entorno.ejecutar(
            { contexto: contextoDeEmpresa(a.empresa, ahora(), a.marca) },
            async (tx) =>
              ok(await tx.derechos.deLaEmpresa(contextoDeEmpresa(otra.empresa, ahora(), a.marca))),
          ),
        ).rejects.toThrow(/no es visible/);
      }
    });

    it("la lectura corre en una transacción de solo lectura: no escribe nada", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, {});
      await asignarPlan(dueno, mundo.tenant, version);
      const r = await entorno.ejecutar(
        { contexto: contextoDeEmpresa(mundo.empresa, ahora(), mundo.marca), soloLectura: true },
        async (tx) =>
          ok(await tx.derechos.deLaEmpresa(contextoDeEmpresa(mundo.empresa, ahora(), mundo.marca))),
      );
      expect(r.ok).toBe(true);
    });
  });

  // ===============================================================================================
  describe("del tenant (plataforma)", () => {
    it("tiene el plan y los ajustes de TODO el tenant, y no los de una empresa", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, {
        modulos: ["caja"],
        perillas: { cajas_por_sucursal: lim(3) },
      });
      await asignarPlan(dueno, mundo.tenant, version);
      await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "1");
      await ajustarPerilla(dueno, mundo.tenant, "con_sello", "0", { empresa: mundo.empresa });
      const d = await delTenant(mundo.tenant);
      expect(d?.empresaId).toBeNull();
      expect(d?.tenantId).toBe(mundo.tenant);
      expect(d?.versionDePlan?.versionDePlanId).toBe(version);
      expect([...(d?.modulosHabilitados ?? [])].sort()).toEqual(["caja", "nucleo"]);
      expect(d?.perillas.get("carta_por_qr")).toEqual({ ...interruptor(true), origen: "AJUSTE" });
      expect(d?.perillas.get("con_sello")).toEqual({ ...interruptor(true), origen: "BASE" });
    });

    it("coincide con los de la empresa cuando no hay nada propio de ella", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
      await asignarPlan(dueno, mundo.tenant, version);
      await ajustarPerilla(dueno, mundo.tenant, "cajas_por_sucursal", "6");
      const delaEmpresa = await deLaEmpresa(mundo);
      const delTenantLeido = await delTenant(mundo.tenant);
      expect(delTenantLeido?.versionDePlan).toEqual(delaEmpresa.versionDePlan);
      expect([...(delTenantLeido?.modulosHabilitados ?? [])].sort()).toEqual(
        [...delaEmpresa.modulosHabilitados].sort(),
      );
      expect([...(delTenantLeido?.perillas ?? [])]).toEqual([...delaEmpresa.perillas]);
    });

    it("un tenant que no existe da null: no se inventan derechos", async () => {
      expect(await delTenant("00000000-0000-4000-8000-00000000dead")).toBeNull();
    });

    it("sin un actor de plataforma vigente no ve el tenant: null, no los derechos de un tenant sin plan", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const desconocido = plataformaEn(ahora(), {
        tipo: "ADMIN",
        id: adminPlataformaId("aaaaaaaa-0000-4000-8000-0000000000ff"),
      });
      const r = await entorno.ejecutar({ contexto: desconocido }, async (tx) =>
        ok(await tx.derechos.delTenant(desconocido, tenantId(mundo.tenant))),
      );
      expect(r).toEqual({ ok: true, valor: null });
    });
  });

  // ===============================================================================================
  describe("los catálogos reales", () => {
    it("con los catálogos del código: el módulo de administración siempre, y empresas_por_tenant vale 1 o lo que ajuste la plataforma", async () => {
      const real = crearEntornoDeDerechos(propia.base, {
        catalogoDeModulos: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      });
      try {
        const mundo = await crearMundoDeMarca(dueno);
        const leer = async () => {
          const c = contextoDeEmpresa(mundo.empresa, ahora(), mundo.marca);
          const r = await real.ejecutar({ contexto: c }, async (tx) =>
            ok(await tx.derechos.deLaEmpresa(c)),
          );
          if (!r.ok) throw new Error("falló");
          return r.valor;
        };
        const antes = await leer();
        expect(antes.modulosHabilitados.has("administracion")).toBe(true);
        expect(antes.perillas.get("empresas_por_tenant")).toEqual({ ...lim(1), origen: "BASE" });
        await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "2");
        expect((await leer()).perillas.get("empresas_por_tenant")).toEqual({
          ...lim(2),
          origen: "AJUSTE",
        });
      } finally {
        await real.cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("carta pública sin sesión: falla cerrado hasta que exista catálogo", () => {
    it("devuelve null para cualquier código, esté o no bien formado", async () => {
      const r = await entorno.ejecutar({ contexto: contextoDePlataforma(ahora()) }, async (tx) => {
        const codigos = ["", "x", "a".repeat(64), "0123456789abcdef".repeat(4)];
        const marcas = [MARCA_PRINCIPAL_DE_PRUEBA, OTRA_MARCA_DE_PRUEBA];
        const respuestas = await Promise.all(
          marcas.flatMap((m) => codigos.map((c) => tx.derechos.deLaCartaPublica(m, c))),
        );
        return ok(respuestas);
      });
      expect(r).toEqual({ ok: true, valor: Array.from({ length: 8 }, () => null) });
    });
  });

  // ===============================================================================================
  describe("sin caché y sin mezclas: una acción ve un plan o el otro", () => {
    it("cada transacción lee de nuevo: un cambio de plan rige en la acción siguiente", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const uno = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(1) } });
      const dos = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(2) } });
      await asignarPlan(dueno, mundo.tenant, uno.version);
      expect(valor(await deLaEmpresa(mundo), "cajas_por_sucursal")?.origen).toBe("PLAN");
      await asignarPlan(dueno, mundo.tenant, dos.version);
      expect((await deLaEmpresa(mundo)).versionDePlan?.versionDePlanId).toBe(dos.version);
    });

    /**
     * Un lector entre cuyas dos lecturas (la asignación y los ajustes) se confirma un cambio completo (otra
     * asignación y otro ajuste, juntos). Con la foto de SERIALIZABLE ve el estado viejo entero; con
     * READ COMMITTED vería el plan viejo con el ajuste nuevo: esta misma prueba lo muestra, para que el
     * «sin mezcla» no pase por casualidad.
     */
    async function lectorConCambioEnElMedio(aislamiento: "serializable" | "read committed") {
      const mundo = await crearMundoDeMarca(dueno);
      const uno = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(1) } });
      const dos = await crearPlanPublicado(dueno, { perillas: { cajas_por_sucursal: lim(2) } });
      await asignarPlan(dueno, mundo.tenant, uno.version);
      await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "0");

      const llegoALaMitad = crearBarrera(2);
      const seguir = crearBarrera(2);
      const conBarrera = crearEntornoDeDerechos<M, P>(propia.base, CATALOGOS, (planes) => ({
        ...planes,
        async asignacionesDelTenant(tenant) {
          const asignaciones = await planes.asignacionesDelTenant(tenant);
          await llegoALaMitad(); // el lector ya leyó la asignación...
          await seguir(); // ...y espera a que el escritor termine
          return asignaciones;
        },
      }));
      try {
        const lector = conBarrera.ejecutar(
          { contexto: contextoDeEmpresa(mundo.empresa, ahora(), mundo.marca), aislamiento },
          async (tx) =>
            ok(
              await tx.derechos.deLaEmpresa(contextoDeEmpresa(mundo.empresa, ahora(), mundo.marca)),
            ),
        );
        await llegoALaMitad();
        // El escritor cambia plan y ajuste en UNA transacción y confirma.
        await dueno.query("begin");
        await asignarPlan(dueno, mundo.tenant, dos.version);
        await ajustarPerilla(dueno, mundo.tenant, "carta_por_qr", "1");
        await dueno.query("commit");
        await seguir();
        const r = await lector;
        if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
        return { derechos: r.valor, uno: uno.version, dos: dos.version };
      } finally {
        await conBarrera.cerrar();
      }
    }

    it("SERIALIZABLE: el lector ve el plan viejo con el ajuste viejo (una foto, sin mezcla)", async () => {
      const { derechos, uno } = await lectorConCambioEnElMedio("serializable");
      expect(derechos.versionDePlan?.versionDePlanId).toBe(uno);
      expect(derechos.perillas.get("carta_por_qr")).toEqual({
        ...interruptor(false),
        origen: "AJUSTE",
      });
    });

    it("READ COMMITTED mezclaría (plan viejo con ajuste nuevo): por eso los derechos se leen en la transacción serializable", async () => {
      const { derechos, uno } = await lectorConCambioEnElMedio("read committed");
      expect(derechos.versionDePlan?.versionDePlanId).toBe(uno);
      expect(derechos.perillas.get("carta_por_qr")).toEqual({
        ...interruptor(true),
        origen: "AJUSTE",
      });
    });

    it("lectores y un escritor que cambia plan y ajuste juntos: cada lectura es de UN estado, nunca de dos", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      // Estado k: la versión k del plan (con cajas_por_sucursal = k) y el ajuste de `overbooking` = k.
      const plan = await (async () => {
        const { plan } = await crearPlanPublicado(dueno, {});
        return plan;
      })();
      const versiones: string[] = [];
      for (let k = 1; k <= 12; k++) {
        const { rows } = await dueno.query<{ id: string }>(
          `insert into version_de_plan (plan_id, nombre_comercial, modulos, perillas)
           values ($1, 'Plan', '{}', $2::jsonb) returning id`,
          [plan, JSON.stringify({ cajas_por_sucursal: lim(k) })],
        );
        const id = (rows[0] as { id: string }).id;
        await dueno.query(
          `update version_de_plan v set estado = 'PUBLICADA',
             numero = (select coalesce(max(o.numero), 0) + 1 from version_de_plan o where o.plan_id = v.plan_id),
             motivo = 'prueba', publicada_en = now(), publicada_por = 'prueba' where v.id = $1`,
          [id],
        );
        versiones.push(id);
      }
      // Estado inicial k=1
      await asignarPlan(dueno, mundo.tenant, versiones[0] as string);
      await ajustarPerilla(dueno, mundo.tenant, "overbooking", "1");
      await ajustarPerilla(dueno, mundo.tenant, "asignacion_diferida", "1");

      const lecturas: number[][] = [];
      let escribiendo = true;
      const lectores = Array.from({ length: 3 }, async () => {
        const vistas: number[] = [];
        while (escribiendo) {
          const d = await deLaEmpresa(mundo);
          const cajas = d.perillas.get("cajas_por_sucursal");
          const sobreventa = d.perillas.get("overbooking");
          if (cajas?.tipo !== "LIMITE" || sobreventa?.tipo !== "LIMITE") throw new Error("tipo");
          if (cajas.limite !== sobreventa.limite) {
            throw new Error(
              `mezcla: plan ${String(cajas.limite)} con ajuste ${String(sobreventa.limite)}`,
            );
          }
          vistas.push(cajas.limite as number);
        }
        lecturas.push(vistas);
      });
      for (let k = 2; k <= 12; k++) {
        await new Promise((r) => setTimeout(r, 15));
        await dueno.query("begin");
        await asignarPlan(dueno, mundo.tenant, versiones[k - 1] as string);
        await ajustarPerilla(dueno, mundo.tenant, "overbooking", String(k));
        await dueno.query("commit");
      }
      escribiendo = false;
      await Promise.all(lectores);
      expect(lecturas.flat().length).toBeGreaterThan(10);
      for (const vistas of lecturas) {
        // cada lector ve los estados en orden: nunca uno anterior después de uno posterior
        expect([...vistas].sort((x, y) => x - y)).toEqual(vistas);
      }
    });
  });
});
