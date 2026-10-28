import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { exigirAccion } from "../../src/capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  empresaId,
  marcaComercialId,
  personaId,
  tenantId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearMarca, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Q2: la carga de autorización lee los módulos REALES de la empresa (marcas y planes, §B.6) contra una base
 * real y con los roles limitados: los ACTIVADOS (`modulo_de_empresa` activo de la empresa) y los HABILITADOS
 * (módulos de la versión de plan vigente de su tenant: el techo). Cada lectura es de la transacción en
 * curso y sin caché. `estadoDeModulos` y el guard consumen esas dos listas: acá se prueba también cómo
 * quedan el módulo activo, en solo lectura y no activo con la base de verdad.
 *
 * El catálogo real tiene `administracion` (obligatorio) y `facturacion` (en desarrollo). Estas pruebas
 * usan `facturacion` como el módulo activable y `REGLAS_CON_FACTURACION` (el mismo catálogo con
 * `facturacion` disponible) para ejercitar el guard.
 */

const base = inject("baseDePruebas");

type Lista = readonly string[];
type Modulos = Readonly<{ activados: Lista; habilitados: Lista }>;

describe.skipIf(base === null)("autorización: los módulos reales de la empresa", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 6);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** El reloj real: las asignaciones de plan nacen «vigentes desde hace 30 s» según el reloj de la base. */
  const contexto = (
    empresa: EmpresaId,
    persona: PersonaId | null,
    ahora: Date = new Date(),
  ): ContextoOperativo => ({ ...comoEmpresa(empresa, persona), ahora });

  const delActor = async (ctx: ContextoOperativo) => {
    const r = await entorno.ejecutar({ contexto: ctx }, async (tx) =>
      ok(await tx.autorizacion.delActor(ctx)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const modulosDe = async (ctx: ContextoOperativo): Promise<Modulos> => {
    const datos = await delActor(ctx);
    return { activados: datos.modulosActivados, habilitados: datos.modulosHabilitados };
  };

  /** Una empresa activa con un GERENTE; opcionalmente con el plan (módulos) asignado a su tenant. */
  const mundo = async (
    opciones: { plan?: readonly string[]; rol?: RolDePrueba; tenant?: string } = {},
  ) => {
    const e = await crearEmpresaActiva(
      entorno,
      opciones.tenant === undefined ? {} : { tenant: tenantId(opciones.tenant) },
    );
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, opciones.rol ?? "GERENTE");
    if (opciones.plan !== undefined) await asignar(e.tenant, opciones.plan);
    return { ...e, persona: personaId(p.id), ctx: () => contexto(e.empresa, personaId(p.id)) };
  };
  /** Un plan nuevo con esos módulos, asignado al tenant con el número siguiente. Devuelve la versión. */
  const asignar = async (tenant: string, modulos: readonly string[], desdeSegundos = -30) => {
    const { version } = await crearPlanPublicado(dueno, { modulos: [...modulos] });
    await asignarPlan(dueno, tenant, version, { desdeSegundos });
    return version;
  };
  const activar = (empresa: string, modulo: string) =>
    dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
      empresa,
      modulo,
    ]);
  const poner = (empresa: string, modulo: string, activo: boolean) =>
    dueno.query("update modulo_de_empresa set activo = $3 where empresa_id = $1 and modulo = $2", [
      empresa,
      modulo,
      activo,
    ]);

  /** Lo que el guard decide para una acción de facturación con esos módulos de verdad. */
  const guard = async (
    ctx: ContextoOperativo,
    accion: "comprobantes.ver" | "comprobantes.emitir" | "comprobantes.emitir_manual",
  ) => {
    const r = await entorno.ejecutar({ contexto: ctx }, async (tx) =>
      ok(await exigirAccion(REGLAS_CON_FACTURACION, accion, () => tx.autorizacion.delActor(ctx))),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor.ok ? "OK" : r.valor.error;
  };

  // ===============================================================================================
  describe("qué es activado, qué es habilitado y cómo queda el módulo", () => {
    it("activado por la empresa e incluido en el plan: habilitado y operativo", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      expect(await modulosDe(m.ctx())).toEqual({
        activados: ["facturacion"],
        habilitados: ["facturacion"],
      });
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("OK");
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("OK");
    });

    it("activado pero NO incluido en el plan: queda activado y no habilitado (solo lectura)", async () => {
      const m = await mundo({ plan: [] });
      await activar(m.empresa, "facturacion");
      expect(await modulosDe(m.ctx())).toEqual({ activados: ["facturacion"], habilitados: [] });
      // Corrección 16: mirar y cerrar lo ya iniciado pasa; crear o ampliar se rechaza.
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("OK");
      expect(await guard(m.ctx(), "comprobantes.emitir")).toBe("OK");
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("MODULO_EN_SOLO_LECTURA");
    });

    it("incluido en el plan pero NO activado: habilitado y no activado (no activo)", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: ["facturacion"] });
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("MODULO_NO_ACTIVO");
    });

    it("un módulo activado y apagado (activo = false) no cuenta como activado", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      await poner(m.empresa, "facturacion", false);
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: ["facturacion"] });
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("MODULO_NO_ACTIVO");
    });

    it("un tenant sin plan asignado: sin techo (nada habilitado), no es una falla; lo activado queda en solo lectura", async () => {
      const m = await mundo();
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: [] });
      await activar(m.empresa, "facturacion");
      expect(await modulosDe(m.ctx())).toEqual({ activados: ["facturacion"], habilitados: [] });
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("MODULO_EN_SOLO_LECTURA");
    });

    it("los módulos salen ordenados y sin que el plan obligatorio estorbe", async () => {
      const m = await mundo({ plan: ["facturacion", "administracion"] });
      await activar(m.empresa, "facturacion");
      await activar(m.empresa, "administracion");
      expect(await modulosDe(m.ctx())).toEqual({
        activados: ["administracion", "facturacion"],
        habilitados: ["administracion", "facturacion"],
      });
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("OK");
    });
  });

  // ===============================================================================================
  describe("sin caché: cada operación lee de nuevo", () => {
    it("desactivar el módulo entre dos operaciones: la segunda lo ve; reactivarlo, también", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("OK");

      await poner(m.empresa, "facturacion", false);
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: ["facturacion"] });
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("MODULO_NO_ACTIVO");

      await poner(m.empresa, "facturacion", true);
      expect(await guard(m.ctx(), "comprobantes.ver")).toBe("OK");
    });

    it("un cambio de plan entre dos operaciones: la segunda lo ve (queda en solo lectura y vuelve)", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("OK");

      await asignar(m.tenant, []);
      expect(await modulosDe(m.ctx())).toEqual({ activados: ["facturacion"], habilitados: [] });
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("MODULO_EN_SOLO_LECTURA");

      await asignar(m.tenant, ["facturacion"]);
      expect(await guard(m.ctx(), "comprobantes.emitir_manual")).toBe("OK");
    });

    it("una asignación programada (futura) todavía no rige; con el reloj ya pasado, sí", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      await asignar(m.tenant, [], 3_600);
      // Ahora: manda la vigente (la de la hora pasada).
      expect((await modulosDe(m.ctx())).habilitados).toEqual(["facturacion"]);
      // Dos horas después: manda la de mayor número que ya empezó («la última decisión manda»).
      const luego = new Date(Date.now() + 2 * 3_600_000);
      expect((await modulosDe(contexto(m.empresa, m.persona, luego))).habilitados).toEqual([]);
      // Antes de toda asignación: ninguna rige, sin techo.
      const antes = new Date(Date.now() - 3_600_000);
      expect(await modulosDe(contexto(m.empresa, m.persona, antes))).toEqual({
        activados: ["facturacion"],
        habilitados: [],
      });
    });

    it("la asignación de mayor número manda aunque haya otras anteriores, y las versiones viejas no se mezclan", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await asignar(m.tenant, []);
      await asignar(m.tenant, ["facturacion", "administracion"]);
      expect((await modulosDe(m.ctx())).habilitados).toEqual(["administracion", "facturacion"]);
      await asignar(m.tenant, ["administracion"]);
      expect((await modulosDe(m.ctx())).habilitados).toEqual(["administracion"]);
    });

    it("dentro de una transacción serializable la lectura es una sola foto: un cambio de otra conexión no la parte", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "facturacion");
      const ctx = m.ctx();
      const r = await entorno.ejecutar({ contexto: ctx }, async (tx) => {
        const antes = await tx.autorizacion.delActor(ctx);
        // Otra conexión (la plataforma) apaga el módulo y quita el techo, ya confirmado.
        await poner(m.empresa, "facturacion", false);
        await asignar(m.tenant, []);
        const despues = await tx.autorizacion.delActor(ctx);
        return ok({ antes, despues });
      });
      expect(r).toEqual({
        ok: true,
        valor: {
          antes: {
            rol: "GERENTE",
            modulosActivados: ["facturacion"],
            modulosHabilitados: ["facturacion"],
          },
          despues: {
            rol: "GERENTE",
            modulosActivados: ["facturacion"],
            modulosHabilitados: ["facturacion"],
          },
        },
      });
      // La operación siguiente ya ve todo lo nuevo.
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: [] });
    });
  });

  // ===============================================================================================
  describe("aislamiento por empresa y por tenant", () => {
    it("otro tenant no ve los módulos ni el plan del primero (y no los recibe prestados)", async () => {
      const a = await mundo({ plan: ["facturacion"] });
      await activar(a.empresa, "facturacion");
      const b = await mundo({ plan: [] });
      expect(await modulosDe(a.ctx())).toEqual({
        activados: ["facturacion"],
        habilitados: ["facturacion"],
      });
      expect(await modulosDe(b.ctx())).toEqual({ activados: [], habilitados: [] });
      expect(await guard(b.ctx(), "comprobantes.ver")).toBe("MODULO_NO_ACTIVO");
    });

    it("un tenant sin plan no hereda el plan de otro aunque el de otro sea de mayor número", async () => {
      const a = await mundo({ plan: ["facturacion"] });
      await asignar(a.tenant, ["facturacion"]);
      await asignar(a.tenant, ["facturacion"]);
      const b = await mundo();
      await activar(b.empresa, "facturacion");
      expect(await modulosDe(b.ctx())).toEqual({ activados: ["facturacion"], habilitados: [] });
    });

    it("la RLS lo impone en la base: desde la transacción de B no se ven las filas de A, ni siquiera preguntando por A", async () => {
      const a = await mundo({ plan: ["facturacion"] });
      await activar(a.empresa, "facturacion");
      const b = await mundo({ plan: [] });
      const ctxB = b.ctx();
      const r = await entorno.ejecutar({ contexto: ctxB }, async (tx) => {
        const filas = async (
          tabla: "modulo_de_empresa" | "plan_de_tenant",
          columna: string,
          valor: string,
        ) =>
          (
            await sql<{ n: number }>`select count(*)::int as n from ${sql.table(tabla)}
              where ${sql.ref(columna)} = ${valor}`.execute(tx.db)
          ).rows[0]?.n;
        return ok({
          modulosDeA: await filas("modulo_de_empresa", "empresa_id", a.empresa),
          planDeA: await filas("plan_de_tenant", "tenant_id", a.tenant),
          // El actor de A, preguntado desde la transacción de B: no hay rol que ver (la RLS lo esconde).
          deA: await tx.autorizacion.delActor(contexto(a.empresa, a.persona)),
        });
      });
      expect(r).toEqual({
        ok: true,
        valor: {
          modulosDeA: 0,
          planDeA: 0,
          deA: { rol: null, modulosActivados: [], modulosHabilitados: [] },
        },
      });
    });

    it("dos empresas del MISMO tenant: la activación es de cada empresa y el techo (el plan) es del tenant", async () => {
      const a = await mundo({ plan: ["facturacion"] });
      const a2 = await mundo({ tenant: a.tenant });
      await activar(a.empresa, "facturacion");
      expect(await modulosDe(a.ctx())).toEqual({
        activados: ["facturacion"],
        habilitados: ["facturacion"],
      });
      // La segunda no activó nada, pero comparte el techo del tenant.
      expect(await modulosDe(a2.ctx())).toEqual({ activados: [], habilitados: ["facturacion"] });
      expect(await guard(a2.ctx(), "comprobantes.ver")).toBe("MODULO_NO_ACTIVO");
    });
  });

  // ===============================================================================================
  describe("sin rol no hay módulos (falla cerrado, como hasta ahora)", () => {
    const SIN_ROL = { rol: null, modulosActivados: [], modulosHabilitados: [] };

    const conModulos = async (rol: RolDePrueba = "GERENTE") => {
      const m = await mundo({ plan: ["facturacion"], rol });
      await activar(m.empresa, "facturacion");
      return m;
    };

    it("con rol, los trae; el sistema (sin persona) no", async () => {
      const m = await conModulos();
      expect((await delActor(m.ctx())).modulosActivados).toEqual(["facturacion"]);
      expect(await delActor(contexto(m.empresa, null))).toEqual(SIN_ROL);
    });

    it("una membresía apagada", async () => {
      // Un administrador: la base no deja apagar al gerente (se traspasa).
      const m = await conModulos("ADMINISTRADOR");
      await dueno.query("update membresia set activo = false where empresa_id = $1", [m.empresa]);
      expect(await delActor(m.ctx())).toEqual(SIN_ROL);
    });

    it("una persona suspendida globalmente", async () => {
      const m = await conModulos();
      await dueno.query("update persona set activo_global = false where id = $1", [m.persona]);
      expect(await delActor(m.ctx())).toEqual(SIN_ROL);
    });

    it("una persona que no es miembro de esa empresa", async () => {
      const m = await conModulos();
      const ajena = personaId((await crearPersonaDeBase(dueno)).id);
      expect(await delActor(contexto(m.empresa, ajena))).toEqual(SIN_ROL);
    });

    it("una puerta de otra marca (o sin puerta, con persona)", async () => {
      const m = await conModulos();
      const otraMarca = marcaComercialId(await crearMarca(dueno));
      expect(await delActor({ ...m.ctx(), marcaDeEntrada: otraMarca })).toEqual(SIN_ROL);
      expect(await delActor({ ...m.ctx(), marcaDeEntrada: null })).toEqual(SIN_ROL);
      // Y por la puerta correcta sí.
      expect((await delActor({ ...m.ctx(), marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA })).rol).toBe(
        "GERENTE",
      );
    });

    it("la empresa del contexto es la que cuenta: el actor de otra empresa no trae los módulos de esta", async () => {
      const m = await conModulos();
      const otra = await mundo({ plan: [] });
      // Persona de `m` con el contexto de la empresa `otra`: no es miembro allí.
      expect(await delActor(contexto(otra.empresa, m.persona))).toEqual(SIN_ROL);
    });
  });

  // ===============================================================================================
  describe("falla cerrada ante datos que el código no sabe leer", () => {
    it("un módulo bien formado que el catálogo no conoce, activado en la empresa, es una falla (no se ignora)", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await activar(m.empresa, "reservas");
      await expect(delActor(m.ctx())).rejects.toThrow(
        "módulo desconocido en la base (activados): reservas",
      );
    });

    it("un módulo desconocido en el plan vigente es una falla", async () => {
      const m = await mundo({ plan: ["facturacion", "reservas"] });
      await expect(delActor(m.ctx())).rejects.toThrow(
        "módulo desconocido en la base (plan): reservas",
      );
    });

    it("un nombre que es una propiedad de los objetos (constructor) no se toma por un módulo del catálogo", async () => {
      const m = await mundo({ plan: [] });
      await activar(m.empresa, "constructor");
      await expect(delActor(m.ctx())).rejects.toThrow(
        "módulo desconocido en la base (activados): constructor",
      );
    });

    it("el módulo desconocido de un plan que NO rige (programado o viejo) no estorba", async () => {
      const m = await mundo({ plan: ["facturacion"] });
      await asignar(m.tenant, ["reservas"], 3_600);
      expect((await modulosDe(m.ctx())).habilitados).toEqual(["facturacion"]);
    });

    it("un módulo desconocido ya apagado no cuenta (no se lee como activado)", async () => {
      const m = await mundo({ plan: [] });
      await activar(m.empresa, "reservas");
      await poner(m.empresa, "reservas", false);
      expect(await modulosDe(m.ctx())).toEqual({ activados: [], habilitados: [] });
    });

    it("una falla de módulos no se traga ni siquiera cuando el rol existe: el error llega al llamador", async () => {
      const m = await mundo({ plan: [] });
      await activar(m.empresa, "reservas");
      await expect(guard(m.ctx(), "comprobantes.ver")).rejects.toThrow("módulo desconocido");
    });

    describe("con restricciones quitadas a propósito en una base descartable", () => {
      let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
      let entornoAparte: ReturnType<typeof crearEntornoDePrueba>;
      let cliente: pg.Client;

      beforeAll(async () => {
        aparte = await crearBaseAparte(base!);
        entornoAparte = crearEntornoDePrueba(aparte.base, 2);
        cliente = new pg.Client({ connectionString: aparte.base.dueno });
        await cliente.connect();
      });
      afterAll(async () => {
        await cliente.end();
        await entornoAparte.cerrar();
        await aparte.destruir();
      });

      const miembroDe = async (empresa: string): Promise<ContextoOperativo> => {
        const p = await crearPersonaDeBase(cliente);
        await crearMembresiaDeBase(cliente, empresa, p.id, "GERENTE");
        return contexto(empresaId(empresa), personaId(p.id));
      };
      const leer = (ctx: ContextoOperativo) =>
        entornoAparte.ejecutar({ contexto: ctx }, async (tx) =>
          ok(await tx.autorizacion.delActor(ctx)),
        );

      it("un nombre MAL FORMADO activado en la base (la forma que el CHECK no deja pasar) es una falla", async () => {
        await cliente.query(
          "alter table modulo_de_empresa drop constraint modulo_de_empresa_modulo_ck",
        );
        const e = await crearEmpresaActiva(entornoAparte);
        const ctx = await miembroDe(e.empresa);
        await cliente.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
          e.empresa,
          "Facturación!",
        ]);
        await expect(leer(ctx)).rejects.toThrow("módulo desconocido en la base (activados)");
      });

      it("un nombre MAL FORMADO en el plan vigente es una falla", async () => {
        await cliente.query(
          "alter table version_de_plan drop constraint version_de_plan_modulos_ck",
        );
        const e = await crearEmpresaActiva(entornoAparte);
        const ctx = await miembroDe(e.empresa);
        const { version } = await crearPlanPublicado(cliente, {
          modulos: ["facturacion", "Mal Formado"],
        });
        await asignarPlan(cliente, e.tenant, version);
        await expect(leer(ctx)).rejects.toThrow(
          "módulo desconocido en la base (plan): Mal Formado",
        );
      });

      it("una asignación vigente cuya versión de plan no existe es una falla (no «sin plan»)", async () => {
        const e = await crearEmpresaActiva(entornoAparte);
        const ctx = await miembroDe(e.empresa);
        const { version } = await crearPlanPublicado(cliente, { modulos: ["facturacion"] });
        await asignarPlan(cliente, e.tenant, version);
        // Se rompe la integridad a propósito: sin la clave foránea y sin el disparador que impide borrar.
        await cliente.query(
          "alter table plan_de_tenant drop constraint plan_de_tenant_version_de_plan_id_fkey",
        );
        await cliente.query(
          "alter table version_de_plan disable trigger version_de_plan_sin_borrado",
        );
        await cliente.query("delete from version_de_plan where id = $1", [version]);
        await expect(leer(ctx)).rejects.toThrow(
          "la versión de plan vigente del tenant no existe en la base",
        );
      });
    });
  });
});
