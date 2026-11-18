import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { montarVentas, valorDe, type MundoDeVentas } from "./ventas-apoyo";

/**
 * Ventas (mostrador, K1): `opcionesParaCobrar` con el puerto real de caja y una base real. Es una consulta (no escribe): autorización
 * (`ventas.ver` y persona), alcance por sucursal (la caja de otra sucursal no se ve), aislamiento entre empresas (la caja de otra empresa
 * no existe), caja inexistente o desactivada, y que solo se ofrecen las cuentas de la sucursal de LA CAJA. La repetición da lo mismo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: opcionesParaCobrar", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  it("ofrece los medios activos y SOLO las cuentas de la sucursal de la caja; repetir da lo mismo", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const propia = (
      await m.dueno.query<{ id: string }>(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Posnet', $2) returning id",
        [e.empresa, e.sucursal],
      )
    ).rows[0]?.id as string;
    const ajena = (
      await m.dueno.query<{ id: string }>(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Posnet Norte', $2) returning id",
        [e.empresa, e.otraSucursal],
      )
    ).rows[0]?.id as string;

    const una = valorDe(await m.consultas.opcionesParaCobrar(e.gerente, { cajaId: caja.cajaId }));
    const tipos = una.medios.map((x) => x.tipo);
    expect(tipos).toEqual(
      expect.arrayContaining(["EFECTIVO", "TARJETA_DEBITO", "TRANSFERENCIA", "QR"]),
    );
    const ids = una.medios.flatMap((x) => x.cuentas.map((c) => c.id));
    expect(ids).toContain(propia);
    expect(ids).not.toContain(ajena);
    expect(
      valorDe(await m.consultas.opcionesParaCobrar(e.gerente, { cajaId: caja.cajaId })),
    ).toEqual(una);
  });

  it("autorización y alcance: el operador ve la caja de su sucursal y no la de otra; sin persona no ve nada", async () => {
    const e = await m.escenario();
    const propia = await m.cajaAbierta(e);
    const otra = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    expect(
      valorDe(await m.consultas.opcionesParaCobrar(e.operador, { cajaId: propia.cajaId })).medios
        .length,
    ).toBeGreaterThan(0);
    expect(falla(await m.consultas.opcionesParaCobrar(e.operador, { cajaId: otra.cajaId }))).toBe(
      "SUCURSAL_FUERA_DE_ALCANCE",
    );
    const anonimo: ContextoOperativo = { ...e.gerente, personaId: null };
    expect((await m.consultas.opcionesParaCobrar(anonimo, { cajaId: propia.cajaId })).ok).toBe(
      false,
    );
  });

  it("aislamiento entre empresas: la caja de otra empresa no existe para quien pide", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    const cajaDeB = await m.cajaAbierta(b);
    expect(falla(await m.consultas.opcionesParaCobrar(a.gerente, { cajaId: cajaDeB.cajaId }))).toBe(
      "CAJA_NO_ENCONTRADA",
    );
  });

  it("caja inexistente, mal escrita o desactivada: no ofrece nada", async () => {
    const e = await m.escenario();
    const caja = (
      await m.dueno.query<{ id: string }>(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin sesión') returning id",
        [e.empresa, e.sucursal],
      )
    ).rows[0]?.id as string;
    expect(
      falla(
        await m.consultas.opcionesParaCobrar(e.gerente, {
          cajaId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("CAJA_NO_ENCONTRADA");
    expect(falla(await m.consultas.opcionesParaCobrar(e.gerente, { cajaId: "no-es-un-id" }))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    await m.dueno.query("update caja set activa = false where id = $1", [caja]);
    expect(falla(await m.consultas.opcionesParaCobrar(e.gerente, { cajaId: caja }))).toBe(
      "CAJA_INACTIVA",
    );
  });
});
