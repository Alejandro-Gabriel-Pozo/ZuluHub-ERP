import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import { asignarPlan as asignarPlanSql } from "./marcas-apoyo";
import {
  arrepentir,
  definirPolitica,
  pedirCambio,
  planConDosVersiones,
  tenantConEmpresas,
} from "./politica-de-cambio-apoyo";
import {
  clave,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  exito,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Política de cambio de plan (H-14a): dos pedidos a la vez sobre lo mismo, contra Postgres real. Dos administradores definiendo la misma
 * versión, N arrepentimientos del mismo cambio, un arrepentimiento contra un cambio nuevo, y el mismo pedido repetido a la vez. Base propia.
 */

const base = inject("baseDePruebas");
const CORREDORES = 6;

describe.skipIf(base === null)("política de cambio de plan: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base, CORREDORES + 2);
    casos = crearCasosDeMarcasYPlanes(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const versionVigente = async (): Promise<number> =>
    cuenta(dueno, "select max(version) as n from politica_de_cambio_de_plan");

  /** Un cliente con una suba YA vigente (de v1 a v2, con arrepentimiento de 3 días): el escenario de todos los arrepentimientos. */
  async function clienteConUnaSuba() {
    exito(await definirPolitica(casos, await versionVigente(), [0, 1, 3]));
    const { tenant } = await tenantConEmpresas(dueno);
    const { v1, v2 } = await planConDosVersiones(dueno);
    await asignarPlanSql(dueno, tenant, v1, { origen: "ALTA" });
    exito(await pedirCambio(casos, tenant, v2, 1, 0));
    return { tenant, v1, v2 };
  }

  it("N definirPolitica desde la misma versión esperada: una entra y las demás son VERSION_DESACTUALIZADA", async () => {
    const vigente = await versionVigente();
    const resultados = await Promise.all(
      Array.from({ length: CORREDORES }, (_, i) => definirPolitica(casos, vigente, [1, 1, i])),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    for (const r of resultados.filter((x) => !x.ok)) {
      expect(r).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    }
    expect(await versionVigente()).toBe(vigente + 1);
    expect(
      await cuenta(
        dueno,
        "select count(*) as n from auditoria_plataforma where accion = 'POLITICA_DE_PLAN_DEFINIDA' and entidad_id = $1",
        [String(vigente + 1)],
      ),
    ).toBe(1);
  });

  it("dos definirPolitica con la MISMA clave a la vez: las dos devuelven la misma versión y entra una sola", async () => {
    const vigente = await versionVigente();
    const claveFija = clave();
    const pedido = (): Promise<unknown> =>
      definirPolitica(casos, vigente, [1, 1, 0], { claveDeIdempotencia: claveFija });
    const [a, b] = (await Promise.all([pedido(), pedido()])) as [
      { ok: boolean; valor?: { version: number } },
      { ok: boolean; valor?: { version: number } },
    ];
    expect(a.ok && b.ok).toBe(true);
    expect(a.valor?.version).toBe(vigente + 1);
    expect(b.valor?.version).toBe(vigente + 1);
    expect(await versionVigente()).toBe(vigente + 1);
  });

  it("N arrepentimientos del mismo cambio con claves distintas: queda uno solo y hay una sola asignación de vuelta", async () => {
    const { tenant, v1 } = await clienteConUnaSuba();
    const resultados = await Promise.all(
      Array.from({ length: CORREDORES }, () => arrepentir(casos, tenant, 2, 2)),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    for (const r of resultados.filter((x) => !x.ok)) {
      expect(["YA_ARREPENTIDO", "VERSION_DESACTUALIZADA", "NO_ES_EL_ULTIMO_CAMBIO"]).toContain(
        (r as { error: string }).error,
      );
    }
    expect(
      await cuenta(
        dueno,
        "select count(*) as n from arrepentimiento_de_plan where tenant_id = $1",
        [tenant],
      ),
    ).toBe(1);
    expect(
      await cuenta(dueno, "select count(*) as n from plan_de_tenant where tenant_id = $1", [
        tenant,
      ]),
    ).toBe(3);
    expect(
      await cuenta(
        dueno,
        "select count(*) as n from plan_de_tenant where tenant_id = $1 and numero = 3 and version_de_plan_id = $2",
        [tenant, v1],
      ),
    ).toBe(1);
    expect(
      await cuenta(
        dueno,
        "select count(*) as n from auditoria_plataforma where accion = 'PLAN_ARREPENTIDO' and despues ->> 'tenantId' = $1",
        [tenant],
      ),
    ).toBe(1);
  });

  it("dos arrepentimientos con la MISMA clave a la vez: los dos devuelven la misma asignación, una fila, una constancia", async () => {
    const { tenant } = await clienteConUnaSuba();
    const claveFija = clave();
    const pedido = () => arrepentir(casos, tenant, 2, 2, { claveDeIdempotencia: claveFija });
    const [a, b] = await Promise.all([pedido(), pedido()]);
    expect(exito(a).numero).toBe(3);
    expect(exito(b).numero).toBe(3);
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
  });

  it("un arrepentimiento y un cambio de plan nuevo a la vez: uno de los dos se rechaza, nunca los dos", async () => {
    const { tenant, v1 } = await clienteConUnaSuba();
    const [deshacer, cambiar] = await Promise.all([
      arrepentir(casos, tenant, 2, 2),
      pedirCambio(casos, tenant, v1, 2, 3),
    ]);
    expect(deshacer.ok && cambiar.ok).toBe(false);
    expect(deshacer.ok || cambiar.ok).toBe(true);
    // Sin huecos ni números repetidos.
    const numeros = (
      await dueno.query<{ numero: number }>(
        "select numero from plan_de_tenant where tenant_id = $1 order by numero",
        [tenant],
      )
    ).rows.map((f) => f.numero);
    expect(numeros).toEqual([1, 2, 3]);
    if (!deshacer.ok) {
      expect(["VERSION_DESACTUALIZADA", "NO_ES_EL_ULTIMO_CAMBIO"]).toContain(deshacer.error);
    } else {
      expect(cambiar).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    }
  });
});
