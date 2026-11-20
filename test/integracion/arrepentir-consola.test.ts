import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import { asignarPlan as asignarPlanSql } from "./marcas-apoyo";
import {
  definirPolitica,
  diaArgentina,
  pedirCambio,
  planConDosVersiones,
  tenantConEmpresas,
} from "./politica-de-cambio-apoyo";
import {
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  enLaHora,
  exito,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

vi.mock("server-only", () => ({}));

/** Quién pide y cuándo: los casos REALES (contra Postgres) ligados al actor y a la hora que fije cada prueba. */
const sesion = vi.hoisted<{ casos: unknown; rol: "ADMIN" | "SOPORTE"; ahora: Date | null }>(() => ({
  casos: null,
  rol: "ADMIN",
  ahora: null,
}));
vi.mock("../../apps/plataforma/servidor/acceso", () => ({
  exigirAcceso: () => Promise.resolve({ admin: { rol: sesion.rol }, casos: sesion.casos }),
}));

import {
  arrepentirCambioDeConsola,
  cambiarPlanDeConsola,
} from "../../apps/plataforma/servidor/acciones-plan";

/**
 * La acción «deshacer por arrepentimiento» de la consola contra Postgres real: es OTRA puerta (la del navegador) sobre los casos de H-14a, que ya se prueban a nivel del caso en
 * `politica-de-cambio-casos-de-uso.test.ts` y `politica-de-cambio-concurrencia.test.ts`. Acá: el mismo pedido llegando dos veces (clic doble, reintento), dos personas deshaciendo a la vez, deshacer a la vez que otro
 * cambia el plan, un rol sin permiso, el número de cambio de otro cliente y el corte de día, siempre sin dejar asignaciones, arrepentimientos ni constancias de más. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "deshacer por arrepentimiento: la acción de la consola, contra Postgres",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
    let casos: CasosDeUsoDeMarcasYPlanes;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoDeMarcasYPlanes(propia.base, 10);
      casos = crearCasosDeMarcasYPlanes(entorno);
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const contexto = (): ContextoDePlataforma => {
      if (sesion.ahora !== null) return enLaHora(sesion.ahora);
      return sesion.rol === "ADMIN" ? comoAdminAhora() : comoSoporteAhora();
    };
    beforeEach(() => {
      sesion.rol = "ADMIN";
      sesion.ahora = null;
      sesion.casos = new Proxy(casos, {
        get: (objetivo, nombre: string) => (entrada: never) =>
          (objetivo as never as Record<string, (c: ContextoDePlataforma, e: never) => unknown>)[
            nombre
          ]?.(contexto(), entrada),
      });
    });

    const versionDeLaPolitica = async (): Promise<number> =>
      cuenta(dueno, "select max(version) as n from politica_de_cambio_de_plan");
    const definir = async (dias: readonly [number, number, number]) =>
      exito(await definirPolitica(casos, await versionDeLaPolitica(), dias));
    const filas = (tabla: string, tenant: string) =>
      cuenta(dueno, `select count(*) as n from ${tabla} where tenant_id = $1`, [tenant]);
    const constancias = (tenant: string) =>
      cuenta(
        dueno,
        "select count(*) as n from auditoria_plataforma where accion = 'PLAN_ARREPENTIDO' and despues ->> 'tenantId' = $1",
        [tenant],
      );
    const pedido = (tenantId: string, numero: number, numeroEsperado: number, extra = {}) => ({
      claveDeIdempotencia: crypto.randomUUID(),
      tenantId,
      numero,
      numeroEsperado,
      motivo: "El cliente se arrepintió",
      ...extra,
    });

    /** Un cliente con v1 de alta y una suba a v2 con plazo de arrepentimiento (cambio número 2, vigente mañana). */
    async function clienteConUnCambio() {
      await definir([1, 1, 3]);
      const { tenant } = await tenantConEmpresas(dueno);
      const { v1, v2 } = await planConDosVersiones(dueno);
      await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
      exito(await pedirCambio(casos, tenant, v2, 1, 1));
      return { tenant, v1, v2 };
    }

    it("idempotencia: el mismo pedido dos veces (reintento) deja UN arrepentimiento, UNA asignación nueva y UNA constancia, y devuelve lo mismo", async () => {
      const { tenant } = await clienteConUnCambio();
      const unico = pedido(tenant, 2, 2);
      const primera = await arrepentirCambioDeConsola(unico);
      const segunda = await arrepentirCambioDeConsola(unico);
      expect(primera).toEqual({ ok: true, dato: { numero: 3 } });
      expect(segunda).toEqual(primera);
      expect(await filas("plan_de_tenant", tenant)).toBe(3);
      expect(await filas("arrepentimiento_de_plan", tenant)).toBe(1);
      expect(await constancias(tenant)).toBe(1);
      await definir([1, 1, 0]);
    });

    it("idempotencia: el mismo pedido llegando a la vez (clic doble) deja UN arrepentimiento y UNA constancia", async () => {
      const { tenant } = await clienteConUnCambio();
      const unico = pedido(tenant, 2, 2);
      const [a, b, c] = await Promise.all([
        arrepentirCambioDeConsola(unico),
        arrepentirCambioDeConsola(unico),
        arrepentirCambioDeConsola(unico),
      ]);
      expect(a).toEqual({ ok: true, dato: { numero: 3 } });
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      expect(await filas("arrepentimiento_de_plan", tenant)).toBe(1);
      expect(await filas("plan_de_tenant", tenant)).toBe(3);
      expect(await constancias(tenant)).toBe(1);
      await definir([1, 1, 0]);
    });

    it("concurrencia: dos personas deshacen a la vez el mismo cambio (claves distintas): una gana y la otra ve que ya no se puede", async () => {
      const { tenant } = await clienteConUnCambio();
      const resultados = await Promise.all([
        arrepentirCambioDeConsola(pedido(tenant, 2, 2)),
        arrepentirCambioDeConsola(pedido(tenant, 2, 2)),
      ]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      // Ya se deshizo (o el último ya cambió): se dice con su texto, nunca un código crudo.
      expect(perdedora).toMatchObject({ ok: false });
      expect(JSON.stringify(perdedora)).toMatch(
        /ya se deshizo|pantalla quedó vieja|Alguien más cambió/,
      );
      expect(await filas("arrepentimiento_de_plan", tenant)).toBe(1);
      expect(await filas("plan_de_tenant", tenant)).toBe(3);
      expect(await constancias(tenant)).toBe(1);
      await definir([1, 1, 0]);
    });

    it("concurrencia: deshacer a la vez que otra persona cambia el plan del mismo cliente: gana uno solo y el historial queda consecutivo, sin huecos", async () => {
      const { tenant, v2 } = await clienteConUnCambio();
      const [deshacer, cambiar] = await Promise.all([
        arrepentirCambioDeConsola(pedido(tenant, 2, 2)),
        cambiarPlanDeConsola({
          claveDeIdempotencia: crypto.randomUUID(),
          tenantId: tenant,
          versionDePlanId: v2,
          vigenteDesde: diaArgentina(1),
          motivo: "Otro cambio",
          numeroEsperado: 2,
          reemplazaProgramada: true,
        }),
      ]);
      expect([deshacer.ok, cambiar.ok].filter(Boolean)).toHaveLength(1);
      const numeros = (
        await dueno.query<{ numero: number }>(
          "select numero from plan_de_tenant where tenant_id = $1 order by numero",
          [tenant],
        )
      ).rows.map((f) => f.numero);
      expect(numeros).toEqual([1, 2, 3]);
      await definir([1, 1, 0]);
    });

    it("autorización: un SOPORTE no deshace (se oculta la acción) y no se escribe nada", async () => {
      const { tenant } = await clienteConUnCambio();
      sesion.rol = "SOPORTE";
      const antes = await huellaDeEscrituras(dueno);
      const r = await arrepentirCambioDeConsola(pedido(tenant, 2, 2));
      expect(r).toEqual({ ok: false, error: { tipo: "OCULTAR_ACCION" } });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(await filas("arrepentimiento_de_plan", tenant)).toBe(0);
      await definir([1, 1, 0]);
    });

    it("aislamiento: con el cliente A en el pedido y el número de un cambio del cliente B no se deshace nada de ninguno", async () => {
      const a = await clienteConUnCambio();
      const b = await clienteConUnCambio();
      // A tiene los cambios 1 y 2; un número que solo existe en B (3, tras un cambio más) no se puede pedir con A.
      exito(await pedirCambio(casos, b.tenant, b.v1, 2, 1, { reemplazaProgramada: true }));
      const antes = await huellaDeEscrituras(dueno);
      const r = await arrepentirCambioDeConsola(pedido(a.tenant, 3, 2));
      expect(r).toMatchObject({ ok: false, error: { tipo: "PANTALLA_VIEJA" } });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(await filas("arrepentimiento_de_plan", a.tenant)).toBe(0);
      expect(await filas("arrepentimiento_de_plan", b.tenant)).toBe(0);
      await definir([1, 1, 0]);
    });

    it("corte de día: el día siguiente al límite (00:01 de Argentina) el servidor dice que venció el plazo y no escribe nada", async () => {
      const { tenant } = await clienteConUnCambio();
      sesion.ahora = new Date(`${diaArgentina(4)}T00:01:00-03:00`);
      const antes = await huellaDeEscrituras(dueno);
      const r = await arrepentirCambioDeConsola(pedido(tenant, 2, 2));
      expect(r).toEqual({
        ok: false,
        error: { tipo: "GENERAL", texto: "Venció el plazo para deshacer este cambio." },
      });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      await definir([1, 1, 0]);
    });

    it("validación: una entrada con forma inválida ni llega a los casos", async () => {
      const { tenant } = await clienteConUnCambio();
      const antes = await huellaDeEscrituras(dueno);
      for (const mala of [{ claveDeIdempotencia: "x" }, { numero: 0 }, { tenantId: "no" }]) {
        expect(await arrepentirCambioDeConsola(pedido(tenant, 2, 2, mala))).toMatchObject({
          ok: false,
          error: { tipo: "GENERAL" },
        });
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      await definir([1, 1, 0]);
    });
  },
);
