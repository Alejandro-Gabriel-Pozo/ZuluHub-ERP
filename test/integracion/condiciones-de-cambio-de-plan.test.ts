import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
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
  clave,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  enLaHora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * La lectura `condicionesDeCambioDePlan` (H-14b) contra Postgres real: lo que la consola muestra del cambio de plan de un cliente sale del servidor y coincide con lo que el servidor decide al registrar el cambio
 * (primera fecha válida y sentido de cada opción, hasta cuándo se puede deshacer, si se puede hoy). Previene: una pantalla que ofrece una fecha o un botón que el servidor después rechaza, y datos de un cliente en la
 * pantalla de otro. Solo lectura: no escribe nada. Base propia.
 */

const base = inject("baseDePruebas");
const AHORA_ARGENTINA_A_LAS = (dia: string, hora: string): Date => new Date(`${dia}T${hora}-03:00`);

describe.skipIf(base === null)("condicionesDeCambioDePlan contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;
  let consultas: ConsultasDeMarcasYPlanes;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
    consultas = crearConsultasDeMarcasYPlanesDePrueba(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const versionDeLaPolitica = async (): Promise<number> =>
    cuenta(dueno, "select max(version) as n from politica_de_cambio_de_plan");
  const definir = async (dias: readonly [number, number, number]) =>
    exito(await definirPolitica(casos, await versionDeLaPolitica(), dias));
  const leer = (tenantId: string, versionesDePlanIds: string[] = [], ahora = comoAdminAhora()) =>
    consultas.condicionesDeCambioDePlan(ahora, { tenantId, versionesDePlanIds });

  it("con la política inicial (1, 1, 0): cada opción trae su sentido y «mañana» como primera fecha, igual que el rechazo del servidor", async () => {
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, tenant, v2, { origen: "ALTA" });
    const vista = exito(await leer(tenant, [v1, v2]));
    expect(vista.politica).toMatchObject({
      diasDeAnticipacionDeSuba: 1,
      diasDeAnticipacionDeBaja: 1,
      diasDeArrepentimiento: 0,
    });
    expect(vista.hoy).toBe(diaArgentina(0));
    // v2 → v1 quita un módulo (BAJA); v2 → v2 no cambia nada (SUBA, la que no sale).
    expect(vista.opciones).toEqual([
      {
        versionDePlanId: v1,
        sentido: "BAJA",
        primeraFechaValida: diaArgentina(1),
        diasDeAnticipacion: 1,
      },
      {
        versionDePlanId: v2,
        sentido: "SUBA",
        primeraFechaValida: diaArgentina(1),
        diasDeAnticipacion: 1,
      },
    ]);
    // El servidor rechaza hoy con esa misma fecha.
    expect(falla(await pedirCambio(casos, tenant, v1, 1, 0))).toEqual({
      codigo: "ANTICIPACION_INSUFICIENTE",
      primeraFechaValida: vista.opciones[0]?.primeraFechaValida,
    });
  });

  it("con (3, 10, 15): una suba pide hoy+3 y una baja hoy+15 (el mayor entre la anticipación de baja y el arrepentimiento); y el servidor las acepta ese día y no el anterior", async () => {
    await definir([3, 10, 15]);
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
    const vista = exito(await leer(tenant, [v1, v2]));
    // v1 → v2 suma un módulo (SUBA, hoy+3).
    expect(vista.opciones.find((o) => o.versionDePlanId === v2)).toEqual({
      versionDePlanId: v2,
      sentido: "SUBA",
      primeraFechaValida: diaArgentina(3),
      diasDeAnticipacion: 3,
    });
    expect(falla(await pedirCambio(casos, tenant, v2, 1, 2))).toMatchObject({
      codigo: "ANTICIPACION_INSUFICIENTE",
      primeraFechaValida: diaArgentina(3),
    });
    exito(await pedirCambio(casos, tenant, v2, 1, 3));

    const otro = (await tenantConEmpresas(dueno)).tenant;
    await asignarPlanSql(dueno, otro, v2, { origen: "ALTA" });
    const deBaja = exito(await leer(otro, [v1]));
    expect(deBaja.opciones[0]).toEqual({
      versionDePlanId: v1,
      sentido: "BAJA",
      primeraFechaValida: diaArgentina(15),
      diasDeAnticipacion: 15,
    });
    expect(falla(await pedirCambio(casos, otro, v1, 1, 14))).toMatchObject({
      primeraFechaValida: diaArgentina(15),
    });
    await definir([1, 1, 0]);
  });

  it("el último cambio: sentido, día límite, vuelve a qué plan y se puede hoy; después de deshacer ya no, y el historial dice qué cambio nació de cuál", async () => {
    await definir([1, 1, 3]);
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, tenant, v2, { origen: "ALTA" });
    const sinCambios = exito(await leer(tenant));
    expect(sinCambios.ultimoCambio).toMatchObject({
      numero: 1,
      origen: "ALTA",
      sentido: null,
      arrepentimientoHasta: null,
      puedeDeshacerHoy: false,
      motivoDeNoPoder: "CAMBIO_SIN_ARREPENTIMIENTO",
    });
    // Una baja a v1 con plazo de 3 días: hasta hoy+3 todavía rige v2 y se puede deshacer.
    exito(await pedirCambio(casos, tenant, v1, 1, 3));
    const conBaja = exito(await leer(tenant));
    expect(conBaja.ultimoCambio).toMatchObject({
      numero: 2,
      origen: "CAMBIO",
      sentido: "BAJA",
      arrepentimientoHasta: diaArgentina(3),
      yaArrepentido: false,
      puedeDeshacerHoy: true,
      motivoDeNoPoder: null,
    });
    // Mientras dura el plazo sigue con v2: a ese plan «vuelve» (no se mueve).
    expect(conBaja.ultimoCambio?.vuelveA?.versionNumero).toBe(2);
    expect(conBaja.arrepentimientos).toEqual([]);

    exito(await arrepentir(casos, tenant, 2, 2));
    const despues = exito(await leer(tenant));
    expect(despues.arrepentimientos).toEqual([{ numeroArrepentido: 2, numeroNuevo: 3 }]);
    // El último ahora es el cambio nuevo (sin condiciones): el arrepentimiento no se arrepiente.
    expect(despues.ultimoCambio).toMatchObject({
      numero: 3,
      sentido: null,
      puedeDeshacerHoy: false,
      motivoDeNoPoder: "CAMBIO_SIN_ARREPENTIMIENTO",
    });
    await definir([1, 1, 0]);
  });

  it("el día límite es inclusive: se puede hasta las 23:59 del día D y no desde las 00:01 del D+1 (hora de Argentina), y lo mostrado coincide con lo que acepta el servidor", async () => {
    await definir([0, 1, 2]);
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
    exito(await pedirCambio(casos, tenant, v2, 1, 0));
    const limite = diaArgentina(2);
    const ultimoMinuto = enLaHora(AHORA_ARGENTINA_A_LAS(limite, "23:59:00"));
    const primerMinuto = enLaHora(AHORA_ARGENTINA_A_LAS(diaArgentina(3), "00:01:00"));
    const dentro = exito(await leer(tenant, [], ultimoMinuto));
    expect(dentro.hoy).toBe(limite);
    expect(dentro.ultimoCambio).toMatchObject({ puedeDeshacerHoy: true, motivoDeNoPoder: null });
    const fuera = exito(await leer(tenant, [], primerMinuto));
    expect(fuera.hoy).toBe(diaArgentina(3));
    expect(fuera.ultimoCambio).toMatchObject({
      puedeDeshacerHoy: false,
      motivoDeNoPoder: "PLAZO_VENCIDO",
    });
    // El caso de uso responde igual que lo que mostró la lectura.
    const fueraDePlazo = await casos.arrepentirCambioDePlan(primerMinuto, {
      claveDeIdempotencia: clave(),
      tenantId: tenant,
      numero: 2,
      numeroEsperado: 2,
      motivo: "tarde",
    });
    expect(falla(fueraDePlazo)).toBe("PLAZO_VENCIDO");
    await definir([1, 1, 0]);
  });

  it("aislamiento: cada cliente ve solo sus cambios; un cliente que no existe, un id mal formado y una versión que no existe se rechazan", async () => {
    await definir([1, 1, 3]);
    const a = await tenantConEmpresas(dueno);
    const b = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, a.tenant, v2, { origen: "ALTA" });
    await asignarPlanSql(dueno, b.tenant, v2, { origen: "ALTA" });
    exito(await pedirCambio(casos, a.tenant, v1, 1, 3));
    exito(await arrepentir(casos, a.tenant, 2, 2));
    const deB = exito(await leer(b.tenant));
    expect(deB.arrepentimientos).toEqual([]);
    expect(deB.ultimoCambio).toMatchObject({ numero: 1, origen: "ALTA" });
    expect(exito(await leer(a.tenant)).arrepentimientos).toHaveLength(1);

    expect(falla(await leer("0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a"))).toBe("TENANT_NO_ENCONTRADO");
    expect(falla(await leer("no-es-un-uuid"))).toBe("ID_INVALIDO");
    expect(falla(await leer(a.tenant, ["no-es-un-uuid"]))).toBe("ID_INVALIDO");
    expect(falla(await leer(a.tenant, ["0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a"]))).toBe(
      "VERSION_DE_PLAN_NO_ENCONTRADA",
    );
    expect(
      falla(
        await leer(
          a.tenant,
          Array.from({ length: 101 }, () => v1),
        ),
      ),
    ).toBe("DEMASIADAS_OPCIONES");
    await definir([1, 1, 0]);
  });

  it("un cliente sin ningún cambio tiene último cambio nulo; SOPORTE puede leer (planes.ver) y la lectura no escribe nada", async () => {
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1 } = await planConDosVersiones(dueno);
    const antes = await huellaDeEscrituras(dueno);
    const vista = exito(await leer(tenant, [v1], comoSoporteAhora()));
    expect(vista.ultimoCambio).toBeNull();
    // Sin plan que rija no hay nada que quitar: SUBA.
    expect(vista.opciones[0]?.sentido).toBe("SUBA");
    expect(await huellaDeEscrituras(dueno)).toEqual(antes);
  });
});
