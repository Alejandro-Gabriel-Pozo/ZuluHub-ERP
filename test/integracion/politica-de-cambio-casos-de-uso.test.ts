import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import { asignarPlan as asignarPlanSql } from "./marcas-apoyo";
import {
  arrepentir,
  definirPolitica,
  diaArgentina,
  pedirCambio,
  planConDosVersiones,
  tenantConEmpresas,
} from "./politica-de-cambio-apoyo";
import {
  auditoriaDeEmpresaDe,
  clave,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Política de cambio de plan (H-14a) contra Postgres real, con la política que nace en la migración (1, 1, 0) y las que se definen después:
 * anticipación de suba y de baja, condiciones con las que nace cada cambio (congeladas), arrepentimiento de una baja y de una suba, idempotencia,
 * permisos y los rechazos. Base propia. La concurrencia está en `politica-de-cambio-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("política de cambio de plan: casos de uso contra Postgres", () => {
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

  /** Siempre la política vigente: lee la última versión. */
  const versionVigenteDeLaPolitica = async (): Promise<number> =>
    cuenta(dueno, "select max(version) as n from politica_de_cambio_de_plan");
  const definir = async (dias: readonly [number, number, number]) =>
    exito(await definirPolitica(casos, await versionVigenteDeLaPolitica(), dias));
  const condiciones = async (tenant: string, numero: number) =>
    (
      await dueno.query<{
        sentido: string;
        politica_version: number;
        hasta: string | null;
      }>(
        "select sentido, politica_version, to_char(arrepentimiento_hasta, 'YYYY-MM-DD') as hasta from condiciones_de_cambio_de_plan where tenant_id = $1 and numero = $2",
        [tenant, numero],
      )
    ).rows[0];
  const vigenteAhora = async (tenant: string): Promise<string> =>
    (
      await dueno.query<{ v: string }>(
        "select version_de_plan_id as v from plan_de_tenant where tenant_id = $1 and vigente_desde <= now() order by numero desc limit 1",
        [tenant],
      )
    ).rows[0]?.v ?? "";

  it("la migración carga la política 1 con 1, 1 y 0 días, definida por el sistema", async () => {
    const filas = (
      await dueno.query<Record<string, unknown>>(
        "select version, dias_de_anticipacion_de_suba as suba, dias_de_anticipacion_de_baja as baja, dias_de_arrepentimiento as arrepentimiento, definida_por from politica_de_cambio_de_plan where version = 1",
      )
    ).rows;
    expect(filas).toEqual([
      { version: 1, suba: 1, baja: 1, arrepentimiento: 0, definida_por: "sistema" },
    ]);
  });

  describe("con la política inicial (1, 1, 0): «desde mañana»", () => {
    it("una suba con vigencia de hoy se rechaza con la primera fecha válida y sin escribir nada", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1 } = await planConDosVersiones(dueno);
      const antes = await huellaDeEscrituras(dueno);
      const r = await pedirCambio(casos, tenant, v1, null, 0);
      expect(falla(r)).toEqual({
        codigo: "ANTICIPACION_INSUFICIENTE",
        primeraFechaValida: diaArgentina(1),
      });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("mañana pasa y guarda sus condiciones: suba, con la política 1 y sin arrepentimiento", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1 } = await planConDosVersiones(dueno);
      const r = exito(await pedirCambio(casos, tenant, v1, null, 1));
      expect(r.numero).toBe(1);
      expect(await condiciones(tenant, 1)).toEqual({
        sentido: "SUBA",
        politica_version: 1,
        hasta: null,
      });
    });

    it("una baja pide lo mismo: hoy se rechaza y mañana pasa como BAJA", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v2, { origen: "ALTA" });
      expect(falla(await pedirCambio(casos, tenant, v1, 1, 0))).toEqual({
        codigo: "ANTICIPACION_INSUFICIENTE",
        primeraFechaValida: diaArgentina(1),
      });
      exito(await pedirCambio(casos, tenant, v1, 1, 1));
      expect((await condiciones(tenant, 2))?.sentido).toBe("BAJA");
    });

    it("el «ya estaba» no escribe condiciones y el alta (origen ALTA) no las tiene", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
      const r = exito(await pedirCambio(casos, tenant, v1, 1, 0));
      expect(r).toEqual({ numero: 1, yaExistia: true });
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from condiciones_de_cambio_de_plan where tenant_id = $1",
          [tenant],
        ),
      ).toBe(0);
    });
  });

  describe("definirPoliticaDeCambioDePlan", () => {
    it("inserta la versión siguiente, audita antes y después, y repetir con la misma clave no inserta otra", async () => {
      const versionAntes = await versionVigenteDeLaPolitica();
      const claveFija = clave();
      const pedido = {
        claveDeIdempotencia: claveFija,
        versionEsperada: versionAntes,
        diasDeAnticipacionDeSuba: 2,
        diasDeAnticipacionDeBaja: 3,
        diasDeArrepentimiento: 5,
        motivo: "  política nueva ",
      };
      const primera = exito(await casos.definirPoliticaDeCambioDePlan(comoAdminAhora(), pedido));
      expect(primera).toEqual({ version: versionAntes + 1, repetida: false });
      const otra = exito(await casos.definirPoliticaDeCambioDePlan(comoAdminAhora(), pedido));
      expect(otra).toEqual({ version: versionAntes + 1, repetida: true });
      expect(await versionVigenteDeLaPolitica()).toBe(versionAntes + 1);
      const auditoria = (
        await dueno.query<{ antes: unknown; despues: unknown; actor: string }>(
          "select antes, despues, actor from auditoria_plataforma where accion = 'POLITICA_DE_PLAN_DEFINIDA' and entidad_id = $1",
          [String(versionAntes + 1)],
        )
      ).rows;
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.despues).toMatchObject({
        version: versionAntes + 1,
        diasDeAnticipacionDeSuba: 2,
        diasDeAnticipacionDeBaja: 3,
        diasDeArrepentimiento: 5,
        motivo: "política nueva",
      });
      expect(auditoria[0]?.antes).toMatchObject({ version: versionAntes });
      await definir([1, 1, 0]);
    });

    it("con una versión esperada que ya no es la vigente: VERSION_DESACTUALIZADA, sin insertar", async () => {
      const vigente = await versionVigenteDeLaPolitica();
      expect(falla(await definirPolitica(casos, vigente - 1 || 99, [1, 1, 0]))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(await versionVigenteDeLaPolitica()).toBe(vigente);
    });

    it("rechaza días fuera del tope, no enteros y un motivo vacío, sin escribir", async () => {
      const vigente = await versionVigenteDeLaPolitica();
      expect(falla(await definirPolitica(casos, vigente, [366, 1, 0]))).toBe(
        "DIAS_DE_POLITICA_INVALIDOS",
      );
      expect(falla(await definirPolitica(casos, vigente, [1, -1, 0]))).toBe(
        "DIAS_DE_POLITICA_INVALIDOS",
      );
      expect(falla(await definirPolitica(casos, vigente, [1, 1, 0.5]))).toBe(
        "DIAS_DE_POLITICA_INVALIDOS",
      );
      expect(falla(await definirPolitica(casos, vigente, [1, 1, 0], { motivo: "   " }))).toBe(
        "MOTIVO_OBLIGATORIO",
      );
      expect(await versionVigenteDeLaPolitica()).toBe(vigente);
    });

    it("365 días, el tope, entra", async () => {
      await definir([365, 365, 365]);
      await definir([1, 1, 0]);
    });

    it("un soporte no la define y no escribe nada; un cambio de política no toca la anterior (solo inserción)", async () => {
      const vigente = await versionVigenteDeLaPolitica();
      const r = await casos.definirPoliticaDeCambioDePlan(comoSoporteAhora(), {
        claveDeIdempotencia: clave(),
        versionEsperada: vigente,
        diasDeAnticipacionDeSuba: 1,
        diasDeAnticipacionDeBaja: 1,
        diasDeArrepentimiento: 0,
        motivo: "x",
      });
      expect(falla(r)).toBe("SIN_PERMISO");
      expect(await versionVigenteDeLaPolitica()).toBe(vigente);
      await expect(
        dueno.query("update politica_de_cambio_de_plan set dias_de_arrepentimiento = 9"),
      ).rejects.toThrow();
      await expect(dueno.query("delete from politica_de_cambio_de_plan")).rejects.toThrow();
    });

    it("verPoliticaDeCambioDePlan devuelve la vigente y el historial; un administrador sin permiso no la ve", async () => {
      const vigente = await versionVigenteDeLaPolitica();
      const vista = exito(
        await crearConsultasDePrueba().verPoliticaDeCambioDePlan(comoSoporteAhora()),
      );
      expect(vista.vigente.version).toBe(vigente);
      expect(vista.historial[0]?.version).toBe(vigente);
      expect(vista.historial.at(-1)?.version).toBe(1);
    });
  });

  describe("condiciones congeladas", () => {
    it("registrar un cambio, cambiar la política y comprobar que la fecha límite de ese cambio no se movió", async () => {
      await definir([1, 1, 3]);
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1 } = await planConDosVersiones(dueno);
      const versionDeLaPolitica = await versionVigenteDeLaPolitica();
      exito(await pedirCambio(casos, tenant, v1, null, 1));
      const antes = await condiciones(tenant, 1);
      expect(antes).toEqual({
        sentido: "SUBA",
        politica_version: versionDeLaPolitica,
        hasta: diaArgentina(3),
      });
      await definir([1, 1, 30]);
      expect(await condiciones(tenant, 1)).toEqual(antes);
      await definir([1, 1, 0]);
    });
  });

  describe("arrepentirCambioDePlan", () => {
    it("de una BAJA: el cliente sigue con el plan anterior mientras dura el plazo y arrepentirse la deja sin efecto, con una constancia en la plataforma y en cada empresa", async () => {
      await definir([1, 1, 3]);
      const { tenant, empresas } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v2, { origen: "ALTA" });
      // La baja de v2 a v1 no puede regir antes de hoy + 3: mientras tanto rige v2.
      expect(falla(await pedirCambio(casos, tenant, v1, 1, 2))).toMatchObject({
        codigo: "ANTICIPACION_INSUFICIENTE",
        primeraFechaValida: diaArgentina(3),
      });
      exito(await pedirCambio(casos, tenant, v1, 1, 3));
      expect(await vigenteAhora(tenant)).toBe(v2);
      expect(await condiciones(tenant, 2)).toMatchObject({
        sentido: "BAJA",
        hasta: diaArgentina(3),
      });

      const r = exito(await arrepentir(casos, tenant, 2, 2));
      expect(r).toEqual({ numero: 3, repetida: false });
      expect(await vigenteAhora(tenant)).toBe(v2);
      const filas = (
        await dueno.query<{
          numero: number;
          version_de_plan_id: string;
          origen: string;
          reemplaza_programada: boolean;
        }>(
          "select numero, version_de_plan_id, origen, reemplaza_programada from plan_de_tenant where tenant_id = $1 order by numero",
          [tenant],
        )
      ).rows;
      expect(filas.map((f) => [f.numero, f.version_de_plan_id, f.origen])).toEqual([
        [1, v2, "ALTA"],
        [2, v1, "CAMBIO"],
        [3, v2, "CAMBIO"],
      ]);
      expect(filas[2]?.reemplaza_programada).toBe(true);
      // El cambio nuevo no tiene condiciones: no se arrepiente ni tiene anticipación.
      expect(await condiciones(tenant, 3)).toBeUndefined();
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from arrepentimiento_de_plan where tenant_id = $1 and numero_arrepentido = 2 and numero_nuevo = 3",
          [tenant],
        ),
      ).toBe(1);
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from auditoria_plataforma where accion = 'PLAN_ARREPENTIDO' and despues ->> 'tenantId' = $1",
          [tenant],
        ),
      ).toBe(1);
      for (const empresa of empresas) {
        expect(await auditoriaDeEmpresaDe(dueno, empresa, "PLAN_ARREPENTIDO")).toHaveLength(1);
      }
      await definir([1, 1, 0]);
    });

    it("de una SUBA que ya rige: vuelve al plan anterior y lo cargado en el módulo que la suba habilitó se conserva", async () => {
      await definir([0, 1, 3]);
      const { tenant, empresas } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
      exito(await pedirCambio(casos, tenant, v2, 1, 0));
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
        [empresas[0]],
      );
      expect(await vigenteAhora(tenant)).toBe(v2);

      exito(await arrepentir(casos, tenant, 2, 2));
      expect(await vigenteAhora(tenant)).toBe(v1);
      // Nada se borra: el módulo activado sigue guardado (queda en solo lectura por la regla de la baja).
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from modulo_de_empresa where empresa_id = $1 and modulo = 'ventas' and activo",
          [empresas[0]],
        ),
      ).toBe(1);
      expect(
        await cuenta(dueno, "select count(*) as n from plan_de_tenant where tenant_id = $1", [
          tenant,
        ]),
      ).toBe(3);
      await definir([1, 1, 0]);
    });

    it("idempotencia: la misma clave dos veces deja una sola asignación, un solo arrepentimiento y una sola constancia", async () => {
      await definir([0, 1, 3]);
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
      exito(await pedirCambio(casos, tenant, v2, 1, 0));
      const claveFija = clave();
      const primera = exito(
        await arrepentir(casos, tenant, 2, 2, { claveDeIdempotencia: claveFija }),
      );
      const segunda = exito(
        await arrepentir(casos, tenant, 2, 2, { claveDeIdempotencia: claveFija }),
      );
      expect(primera).toEqual({ numero: 3, repetida: false });
      expect(segunda).toEqual({ numero: 3, repetida: true });
      expect(
        await cuenta(dueno, "select count(*) as n from plan_de_tenant where tenant_id = $1", [
          tenant,
        ]),
      ).toBe(3);
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from arrepentimiento_de_plan where tenant_id = $1",
          [tenant],
        ),
      ).toBe(1);
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from auditoria_plataforma where accion = 'PLAN_ARREPENTIDO' and despues ->> 'tenantId' = $1",
          [tenant],
        ),
      ).toBe(1);
      // Otra clave sobre el mismo cambio: ya está arrepentido.
      expect(falla(await arrepentir(casos, tenant, 2, 3))).toBe("YA_ARREPENTIDO");
      await definir([1, 1, 0]);
    });

    it("idempotencia de las otras dos: asignarPlan y definirPolitica con la misma clave no duplican filas ni constancias", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1 } = await planConDosVersiones(dueno);
      const claveFija = clave();
      const a = exito(
        await pedirCambio(casos, tenant, v1, null, 1, { claveDeIdempotencia: claveFija }),
      );
      const b = exito(
        await pedirCambio(casos, tenant, v1, null, 1, { claveDeIdempotencia: claveFija }),
      );
      expect(a.numero).toBe(b.numero);
      expect(
        await cuenta(dueno, "select count(*) as n from plan_de_tenant where tenant_id = $1", [
          tenant,
        ]),
      ).toBe(1);
      expect(
        await cuenta(
          dueno,
          "select count(*) as n from condiciones_de_cambio_de_plan where tenant_id = $1",
          [tenant],
        ),
      ).toBe(1);
    });

    it("rechazos: plazo vencido, cambio que no es el último, alta, migración de versión, sin condiciones y un número que no existe", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      const hoy = diaArgentina(0);
      // Un cambio con su plazo ya vencido (ayer): se arma por SQL porque el reloj no se mueve.
      await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
      const vencido = await asignarPlanSql(dueno, tenant, v2, { origen: "CAMBIO" });
      await dueno.query(
        "insert into condiciones_de_cambio_de_plan (tenant_id, numero, sentido, politica_version, arrepentimiento_hasta) values ($1, $2, 'SUBA', 1, $3::date - 1)",
        [tenant, vencido, hoy],
      );
      expect(falla(await arrepentir(casos, tenant, vencido, vencido))).toBe("PLAZO_VENCIDO");
      // El que todavía está en plazo, pero ya hay otro cambio después: no es el último.
      const enPlazo = await asignarPlanSql(dueno, tenant, v1, { origen: "CAMBIO" });
      await dueno.query(
        "insert into condiciones_de_cambio_de_plan (tenant_id, numero, sentido, politica_version, arrepentimiento_hasta) values ($1, $2, 'BAJA', 1, $3::date + 5)",
        [tenant, enPlazo, hoy],
      );
      const posterior = await asignarPlanSql(dueno, tenant, v2, { origen: "MIGRACION_DE_VERSION" });
      expect(falla(await arrepentir(casos, tenant, enPlazo, posterior))).toBe(
        "NO_ES_EL_ULTIMO_CAMBIO",
      );
      // La migración de versión (y el alta) no admiten arrepentimiento.
      expect(falla(await arrepentir(casos, tenant, posterior, posterior))).toBe(
        "CAMBIO_SIN_ARREPENTIMIENTO",
      );
      expect(falla(await arrepentir(casos, tenant, 1, posterior))).toBe("NO_ES_EL_ULTIMO_CAMBIO");
      expect(falla(await arrepentir(casos, tenant, 99, posterior))).toBe("CAMBIO_NO_ENCONTRADO");
      // Un cambio de origen CAMBIO anterior a la migración (sin fila de condiciones) no admite arrepentimiento.
      const { tenant: otro } = await tenantConEmpresas(dueno);
      const sinCondiciones = await asignarPlanSql(dueno, otro, v1, { origen: "CAMBIO" });
      expect(falla(await arrepentir(casos, otro, sinCondiciones, sinCondiciones))).toBe(
        "CAMBIO_SIN_ARREPENTIMIENTO",
      );
      expect(falla(await arrepentir(casos, "00000000-0000-4000-8000-00000000dead", 1, 1))).toBe(
        "TENANT_NO_ENCONTRADO",
      );
    });

    it("un cambio mixto (sube unas cosas y baja otras) es BAJA: la perilla baja aunque entre un módulo", async () => {
      await definir([1, 4, 0]);
      const { tenant } = await tenantConEmpresas(dueno);
      const alta = await planConDosVersiones(dueno);
      const mixta = await (async () => {
        const { crearPlanPublicado } = await import("./marcas-apoyo");
        return crearPlanPublicado(dueno, {
          modulos: ["caja", "ventas", "stock"],
          perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 1 } },
        });
      })();
      await asignarPlanSql(dueno, tenant, alta.v2, { origen: "ALTA" });
      expect(falla(await pedirCambio(casos, tenant, mixta.version, 1, 1))).toMatchObject({
        codigo: "ANTICIPACION_INSUFICIENTE",
        primeraFechaValida: diaArgentina(4),
      });
      exito(await pedirCambio(casos, tenant, mixta.version, 1, 4));
      expect((await condiciones(tenant, 2))?.sentido).toBe("BAJA");
      await definir([1, 1, 0]);
    });

    it("un soporte no arrepiente nada, y no escribe", async () => {
      const { tenant } = await tenantConEmpresas(dueno);
      const antes = await huellaDeEscrituras(dueno);
      const r = await casos.arrepentirCambioDePlan(comoSoporteAhora(), {
        claveDeIdempotencia: clave(),
        tenantId: tenant,
        numero: 1,
        numeroEsperado: 1,
        motivo: "x",
      });
      expect(falla(r)).toBe("SIN_PERMISO");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  });

  /** Las consultas de la misma base. */
  function crearConsultasDePrueba() {
    return crearConsultasDeMarcasYPlanesDePrueba(entorno);
  }
});
