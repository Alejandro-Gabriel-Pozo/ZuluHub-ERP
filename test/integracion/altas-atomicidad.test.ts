import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import {
  DELTA_DE_UN_ALTA_CON_TENANT_NUEVO,
  FallaInyectada,
  PASOS_DEL_ALTA,
  SIN_CAMBIOS,
  altaEnTenant,
  altaNueva,
  comoAdminAhora,
  crearCasosDeAlta,
  crearEntornoConFallaDespuesDe,
  crearEntornoDeAlta,
  crearMarcaLista,
  crearTenantConPlan,
  diferencia,
  huellaDelAlta,
  type PasoDelAlta,
} from "./altas-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * Atomicidad del alta de empresa (H5 P5 y M6, T7): se provoca una falla DESPUÉS de cada paso y no queda
 * nada de nada: ni el tenant, ni el plan, ni la empresa, ni la sucursal, ni los módulos, ni la
 * invitación, ni el trabajo del mail, ni las auditorías, ni la clave de idempotencia. Y repetir el pedido
 * después de la falla, con la MISMA clave, crea exactamente un alta. Base propia.
 */

const base = inject("baseDePruebas");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)("alta de empresa: atomicidad con fallas en cada paso", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /** Una marca con un módulo inicial, para que también haya módulos que deshacer. */
  const marcaConModulos = () =>
    crearMarcaLista(dueno, { modulosIniciales: ["caja"], modulosDelPlan: ["caja"] });

  describe.each(PASOS_DEL_ALTA)("tenant nuevo: falla después de «%s»", (paso: PasoDelAlta) => {
    it("no queda nada y repetir con la misma clave crea un solo alta", async () => {
      const m = await marcaConModulos();
      const entrada = altaNueva(m.marca);
      const antes = await huellaDelAlta(dueno);

      const roto = crearEntornoConFallaDespuesDe(propia.base, paso);
      try {
        await expect(
          crearCasosDeAlta(roto).altaDeEmpresa(comoAdminAhora(), entrada),
        ).rejects.toThrow(FallaInyectada);
      } finally {
        await roto.cerrar();
      }
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);

      // Con el entorno sano, la MISMA clave y los mismos datos crean exactamente un alta completa.
      const sano = crearEntornoDeAlta(propia.base, 3);
      try {
        const alta = exito(await crearCasosDeAlta(sano).altaDeEmpresa(comoAdminAhora(), entrada));
        expect(alta.yaExistia).toBe(false);
        expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual({
          ...DELTA_DE_UN_ALTA_CON_TENANT_NUEVO,
          modulos: 1,
          // EMPRESA_ALTA + PLAN_ASIGNADO + MODULO_ACTIVADO.
          auditoriaDeEmpresa: 3,
        });
      } finally {
        await sano.cerrar();
      }
    });
  });

  describe.each(PASOS_DEL_ALTA.filter((p) => p !== "tenant" && p !== "plan"))(
    "tenant existente: falla después de «%s»",
    (paso: PasoDelAlta) => {
      it("no queda nada de la empresa nueva y el tenant sigue como estaba", async () => {
        const m = await marcaConModulos();
        const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "3" });
        const entrada = altaEnTenant(mundo.tenant);
        const antes = await huellaDelAlta(dueno);

        const roto = crearEntornoConFallaDespuesDe(propia.base, paso);
        try {
          await expect(
            crearCasosDeAlta(roto).altaDeEmpresa(comoAdminAhora(), entrada),
          ).rejects.toThrow(FallaInyectada);
        } finally {
          await roto.cerrar();
        }
        expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
        expect(
          (
            await dueno.query("select count(*)::int as n from empresa where tenant_id = $1", [
              mundo.tenant,
            ])
          ).rows[0],
        ).toEqual({ n: 1 });
      });
    },
  );

  it("un rechazo de negocio ya con el tenant y el plan escritos (el tope de empresas) deshace también esas escrituras", async () => {
    // Un tenant NUEVO cuyo plan fija el tope en 0: el tenant y su plan se escriben antes de poder contar.
    const m = await crearMarcaLista(dueno, {
      perillasDelPlan: { empresas_por_tenant: { tipo: "LIMITE", limite: 0 } },
    });
    const sano = crearEntornoDeAlta(propia.base, 3);
    const antes = await huellaDelAlta(dueno);
    try {
      const r = await crearCasosDeAlta(sano).altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca));
      expect(r.ok).toBe(false);
    } finally {
      await sano.cerrar();
    }
    expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
  });
});
