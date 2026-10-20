import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte } from "./entorno";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import {
  auditoriaDeEmpresaDe,
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Activar y desactivar módulos de una empresa contra Postgres real (M5): el techo del plan y los `requiere`
 * leídos en la misma transacción, que repetir no escribe ni audita, que nada se borra, y la auditoría de
 * plataforma y de la empresa (actor nulo). Base propia.
 */

const base = inject("baseDePruebas");
const INEXISTENTE = "00000000-0000-4000-8000-00000000dead";

describe.skipIf(base === null)("módulos de empresa: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Un tenant con dos empresas y un plan que incluye caja, ventas y cuentas (no reservas). */
  async function escenario(modulos = ["caja", "ventas", "cuentas"]) {
    const primera = await crearMundoDeMarca(dueno);
    const segunda = await crearMundoDeMarca(dueno, { tenant: primera.tenant });
    const plan = await crearPlanPublicado(dueno, { modulos });
    await asignarPlan(dueno, primera.tenant, plan.version);
    return {
      tenant: primera.tenant,
      empresa: primera.empresa,
      otraEmpresa: segunda.empresa,
      version: plan.version,
    };
  }
  const activar = (empresaId: string, modulo: string, claveDeIdempotencia = clave()) =>
    casos.activarModuloDeEmpresa(comoAdminAhora(), { claveDeIdempotencia, empresaId, modulo });
  const desactivar = (empresaId: string, modulo: string, claveDeIdempotencia = clave()) =>
    casos.desactivarModuloDeEmpresa(comoAdminAhora(), { claveDeIdempotencia, empresaId, modulo });
  const filas = async (empresa: string) =>
    (
      await dueno.query<{ modulo: string; activo: boolean; version: number }>(
        "select modulo, activo, version from modulo_de_empresa where empresa_id = $1 order by modulo",
        [empresa],
      )
    ).rows;

  describe("activarModuloDeEmpresa", () => {
    it("activa el módulo dentro del techo: su fila, la constancia de plataforma y la de la empresa (actor nulo)", async () => {
      const { tenant, empresa, otraEmpresa } = await escenario();
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await activar(empresa, "caja"))).toEqual({ yaEstabaActivo: false });
      expect(await filas(empresa)).toEqual([{ modulo: "caja", activo: true, version: 1 }]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        modulos: antes.modulos + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 1,
        claves: antes.claves + 1,
      });
      const [constancia] = await auditoriaDePlataformaDe(
        dueno,
        "modulo_de_empresa",
        `${empresa}:caja`,
      );
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "MODULO_ACTIVADO",
        antes: null,
        despues: { empresaId: empresa, tenantId: tenant, modulo: "caja", activo: true },
      });
      const [deLaEmpresa] = await auditoriaDeEmpresaDe(dueno, empresa, "MODULO_ACTIVADO");
      expect(deLaEmpresa).toMatchObject({
        actor_persona_id: null,
        entidad: "modulo_de_empresa",
        entidad_id: `${empresa}:caja`,
        despues: { modulo: "caja", activo: true },
      });
      // La otra empresa del mismo tenant no se entera.
      expect(await filas(otraEmpresa)).toEqual([]);
      expect(await auditoriaDeEmpresaDe(dueno, otraEmpresa, "MODULO_ACTIVADO")).toEqual([]);
    });

    it("activar lo activado, con otra clave o con la misma, es éxito sin escribir ni auditar", async () => {
      const { empresa } = await escenario();
      const claveDeIdempotencia = clave();
      exito(await activar(empresa, "caja", claveDeIdempotencia));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await activar(empresa, "caja", claveDeIdempotencia))).toEqual({
        yaEstabaActivo: true,
      });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(exito(await activar(empresa, "caja"))).toEqual({ yaEstabaActivo: true });
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
      expect(await filas(empresa)).toHaveLength(1);
    });

    it("la misma clave con otro módulo es CLAVE_REUTILIZADA", async () => {
      const { empresa } = await escenario();
      const claveDeIdempotencia = clave();
      exito(await activar(empresa, "caja", claveDeIdempotencia));
      expect(falla(await activar(empresa, "ventas", claveDeIdempotencia))).toBe(
        "CLAVE_REUTILIZADA",
      );
    });

    it("un módulo exige que estén activos los que requiere, y se activan en orden", async () => {
      const { empresa } = await escenario();
      expect(falla(await activar(empresa, "ventas"))).toEqual({
        codigo: "REQUIERE_INACTIVO",
        modulo: "caja",
      });
      exito(await activar(empresa, "caja"));
      exito(await activar(empresa, "ventas"));
      exito(await activar(empresa, "cuentas"));
      expect((await filas(empresa)).map((f) => f.modulo)).toEqual(["caja", "cuentas", "ventas"]);
    });

    it("rechaza lo que no se puede activar, con su motivo y sin escribir nada", async () => {
      const { empresa } = await escenario(["caja", "ventas"]);
      const sinPlan = await crearMundoDeMarca(dueno);
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await activar(empresa, "nada"))).toBe("MODULO_DESCONOCIDO");
      expect(falla(await activar(empresa, "constructor"))).toBe("MODULO_DESCONOCIDO");
      expect(falla(await activar(empresa, "nucleo"))).toBe("MODULO_OBLIGATORIO");
      expect(falla(await activar(empresa, "comandas"))).toBe("MODULO_EN_DESARROLLO");
      // `reservas` está en el catálogo pero no en el techo del plan; `caja` tampoco para quien no tiene plan.
      expect(falla(await activar(empresa, "reservas"))).toBe("MODULO_FUERA_DEL_PLAN");
      expect(falla(await activar(sinPlan.empresa, "caja"))).toBe("MODULO_FUERA_DEL_PLAN");
      expect(falla(await activar(INEXISTENTE, "caja"))).toBe("EMPRESA_NO_ENCONTRADA");
      expect(falla(await activar("no-es-un-uuid", "caja"))).toBe("ID_INVALIDO");
      expect(falla(await activar(empresa, "caja", "corta"))).toBe("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  });

  describe("desactivarModuloDeEmpresa", () => {
    it("desactiva sin borrar nada: la fila queda inactiva, con la constancia de plataforma y la de la empresa", async () => {
      const { tenant, empresa } = await escenario();
      exito(await activar(empresa, "caja"));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await desactivar(empresa, "caja"))).toEqual({ yaEstabaInactivo: false });
      expect(await filas(empresa)).toEqual([{ modulo: "caja", activo: false, version: 2 }]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 1,
        claves: antes.claves + 1,
      });
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "modulo_de_empresa",
        `${empresa}:caja`,
      );
      expect(constancias.at(-1)).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "MODULO_DESACTIVADO",
        antes: { activo: true },
        despues: { empresaId: empresa, tenantId: tenant, modulo: "caja", activo: false },
      });
      expect(await auditoriaDeEmpresaDe(dueno, empresa, "MODULO_DESACTIVADO")).toHaveLength(1);
    });

    it("desactivar lo inactivo (o lo que nunca se activó), con otra clave o con la misma, es éxito sin escribir ni auditar", async () => {
      const { empresa } = await escenario();
      const antes = await huellaDeEscrituras(dueno);
      const claveDeIdempotencia = clave();
      expect(exito(await desactivar(empresa, "caja", claveDeIdempotencia))).toEqual({
        yaEstabaInactivo: true,
      });
      expect(exito(await desactivar(empresa, "caja", claveDeIdempotencia))).toEqual({
        yaEstabaInactivo: true,
      });
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
      expect(await filas(empresa)).toEqual([]);
    });

    it("no se desactiva un módulo que otro activado requiere, ni el obligatorio, ni el que no existe", async () => {
      const { empresa } = await escenario();
      exito(await activar(empresa, "caja"));
      exito(await activar(empresa, "ventas"));
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await desactivar(empresa, "caja"))).toEqual({
        codigo: "ES_REQUERIDO_POR",
        modulo: "ventas",
      });
      expect(falla(await desactivar(empresa, "nucleo"))).toBe("MODULO_OBLIGATORIO");
      expect(falla(await desactivar(empresa, "nada"))).toBe("MODULO_DESCONOCIDO");
      expect(falla(await desactivar(INEXISTENTE, "caja"))).toBe("EMPRESA_NO_ENCONTRADA");
      expect(falla(await desactivar("no-es-un-uuid", "caja"))).toBe("ID_INVALIDO");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      // En el orden inverso sí: primero el que lo usa.
      exito(await desactivar(empresa, "ventas"));
      exito(await desactivar(empresa, "caja"));
      expect((await filas(empresa)).map((f) => f.activo)).toEqual([false, false]);
    });

    it("reactivar vuelve a prender la misma fila (nada se borra) y audita el antes", async () => {
      const { empresa } = await escenario();
      exito(await activar(empresa, "caja"));
      exito(await desactivar(empresa, "caja"));
      expect(exito(await activar(empresa, "caja"))).toEqual({ yaEstabaActivo: false });
      expect(await filas(empresa)).toEqual([{ modulo: "caja", activo: true, version: 3 }]);
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "modulo_de_empresa",
        `${empresa}:caja`,
      );
      expect(constancias.map((c) => c.accion)).toEqual([
        "MODULO_ACTIVADO",
        "MODULO_DESACTIVADO",
        "MODULO_ACTIVADO",
      ]);
      expect(constancias[2]?.antes).toEqual({ activo: false });
    });
  });

  describe("el techo del plan se mira solo al activar", () => {
    it("una baja de plan deja el módulo activado (en solo lectura): desactivarlo se puede, y «activar» lo activado sigue siendo éxito", async () => {
      const { tenant, empresa } = await escenario(["caja", "ventas"]);
      exito(await activar(empresa, "caja"));
      exito(await activar(empresa, "ventas"));
      // El plan baja: ya no incluye `ventas`.
      const chico = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      await asignarPlan(dueno, tenant, chico.version);
      expect(await filas(empresa)).toHaveLength(2);
      expect(exito(await activar(empresa, "ventas"))).toEqual({ yaEstabaActivo: true });
      exito(await desactivar(empresa, "ventas"));
      // Ahora sí queda fuera: para volver a activarlo el plan tiene que incluirlo.
      expect(falla(await activar(empresa, "ventas"))).toBe("MODULO_FUERA_DEL_PLAN");
    });

    it("cada empresa tiene sus módulos: lo activado en una no cuenta en la otra", async () => {
      const { empresa, otraEmpresa } = await escenario(["caja"]);
      exito(await activar(empresa, "caja"));
      expect(falla(await activar(otraEmpresa, "ventas"))).toBe("MODULO_FUERA_DEL_PLAN");
      exito(await activar(otraEmpresa, "caja"));
      expect((await filas(otraEmpresa)).map((f) => f.modulo)).toEqual(["caja"]);
    });
  });
});
