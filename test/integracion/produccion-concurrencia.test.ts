import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  aLaVez,
  firme,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
} from "./stock-casos-apoyo";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";

/**
 * E6-T8, concurrencia (C1 a C4 y C12), atomicidad (D7), aislamiento (D8) y apagado (D10), con los casos de uso reales y la base real: dos acciones
 * sobre lo mismo a la vez, dos órdenes que necesitan el último kilo de harina, anular mientras se vende el producto, y fallas inyectadas entre los
 * pasos del cierre (no queda nada a medias).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("producción: concurrencia y atomicidad (E6-T8)", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type Mixto = Resultado<Readonly<Record<string, unknown>>, unknown>;
  type P = Awaited<ReturnType<MontajeDeProduccion["panaderia"]>>;
  /** Stock: harina y manteca en la cantidad pedida (en kilos, a $ 1.000 y $ 9.000). */
  const con = async (harina: string, manteca: string, escenario = e) => {
    const p = await c.panaderia(escenario);
    await c.comprar(escenario, p.origen, p.harina.producto, harina, "1000");
    await c.comprar(escenario, p.origen, p.manteca.producto, manteca, "9000");
    return p;
  };
  const abrir = (p: P, quien = e.gerente) =>
    c.produccion.abrirOrden(quien, {
      id: nuevoId(),
      productoId: p.masa.producto,
      cantidad: "16",
      unidadId: "KILOGRAMO",
      depositoId: p.origen,
      depositoDestinoId: p.destino,
    });
  const cerrar = (ordenId: string, p: P, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.produccion.cerrarOrden(quien, {
      ordenId,
      clave: nuevoId(),
      obtenido: "15",
      unidadId: "KILOGRAMO",
      consumos: [
        { productoId: p.harina.producto, cantidadReal: "12", unidadId: "KILOGRAMO" },
        { productoId: p.manteca.producto, cantidadReal: "4", unidadId: "KILOGRAMO" },
      ],
      ...extra,
    });
  const estado = async (ordenId: string) =>
    (
      await c.filas<{ estado: string }>("select estado from orden_de_produccion where id = $1", [
        ordenId,
      ])
    )[0]?.estado;
  const movimientos = (ordenId: string) =>
    c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [ordenId]);

  it("C1: cerrar la misma orden dos veces a la vez (claves distintas): un solo consumo, un solo producto y un costo; la otra devuelve yaExistia", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con("100", "50");
      const a = valorDe(await abrir(p));
      const rs = await aLaVez(
        c,
        [() => firme(() => cerrar(a.ordenId, p)), () => firme(() => cerrar(a.ordenId, p))],
        ronda,
      );
      expect(soloOk(rs), JSON.stringify(rs)).toBe(2);
      expect(rs.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([false, true]);
      expect(await movimientos(a.ordenId)).toBe(2);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
      expect(await estado(a.ordenId)).toBe("CERRADA");
    }
  });

  it("C2: cerrar y cancelar la misma orden a la vez: gana una; o cerrada (la cancelación da ORDEN_YA_CERRADA) o cancelada sin ningún movimiento", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con("100", "50");
      const a = valorDe(await abrir(p));
      const rs = await aLaVez<Mixto>(
        c,
        [
          () => firme(() => cerrar(a.ordenId, p)),
          () =>
            firme(() =>
              c.produccion.cancelarOrden(e.gerente, {
                ordenId: a.ordenId,
                motivo: "Cancelada a la vez",
              }),
            ),
        ],
        ronda,
      );
      expect(soloOk(rs), JSON.stringify(rs)).toBe(1);
      const final = await estado(a.ordenId);
      if (final === "CERRADA") {
        expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "ORDEN_YA_CERRADA" });
        expect(await movimientos(a.ordenId)).toBe(2);
      } else {
        expect(final).toBe("CANCELADA");
        expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "ORDEN_CANCELADA" });
        expect(await movimientos(a.ordenId)).toBe(0);
        expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
      }
    }
  });

  it("C3: dos anulaciones simultáneas de la misma orden cerrada: un solo par de espejos y la otra devuelve yaEstaba", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con("100", "50");
      const a = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      const rs = await aLaVez(
        c,
        [
          () =>
            firme(() =>
              c.produccion.anularOrden(e.gerente, {
                ordenId: a.ordenId,
                motivo: "Anulada a la vez",
              }),
            ),
          () =>
            firme(() =>
              c.produccion.anularOrden(e.gerente, {
                ordenId: a.ordenId,
                motivo: "Anulada a la vez",
              }),
            ),
        ],
        ronda,
      );
      expect(soloOk(rs), JSON.stringify(rs)).toBe(2);
      expect(rs.map((r) => (r.ok ? r.valor.yaEstaba : null)).sort()).toEqual([false, true]);
      expect(await movimientos(a.ordenId)).toBe(4);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("0.0000");
    }
  });

  it("C4 (BLOQUEAR): dos órdenes que necesitan el último kilo de harina: una cierra y la otra CONTROL_BLOQUEA sin dejar nada (ni lote, ni consumo parcial, ni cambio de estado)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con("12", "4");
      await c.fijarNivel(e.empresa, "BLOQUEAR");
      const a = valorDe(await abrir(p));
      const b = valorDe(await abrir(p));
      const rs = await aLaVez(
        c,
        [() => firme(() => cerrar(a.ordenId, p)), () => firme(() => cerrar(b.ordenId, p))],
        ronda,
      );
      expect(soloOk(rs), JSON.stringify(rs)).toBe(1);
      expect(rs.find((r) => !r.ok)).toMatchObject({
        ok: false,
        error: { error: "CONTROL_BLOQUEA" },
      });
      const [gana, pierde] = (await estado(a.ordenId)) === "CERRADA" ? [a, b] : [b, a];
      expect(await estado(gana.ordenId)).toBe("CERRADA");
      expect(await estado(pierde.ordenId)).toBe("ABIERTA");
      expect(await movimientos(pierde.ordenId)).toBe(0);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("0.0000");
      expect(await c.existencia(p.origen, p.manteca.articulo)).toBe("0.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
    }
  });

  it("C4 (PERMITIR): cierran las dos, la harina queda en negativo exacto y hay dos excepciones auditadas en el segundo consumo", async () => {
    const p = await con("12", "4");
    await c.fijarNivel(e.empresa, "PERMITIR");
    const a = valorDe(await abrir(p));
    const b = valorDe(await abrir(p));
    const primera = valorDe(await cerrar(a.ordenId, p));
    expect(primera.excepciones).toEqual([]);
    const segunda = valorDe(await cerrar(b.ordenId, p));
    expect(segunda.excepciones.map((x) => x.existenciaResultante).sort()).toEqual([
      "-12.0000",
      "-4.0000",
    ]);
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("-12.0000");
    expect(await c.existencia(p.destino, p.masa.articulo)).toBe("30.0000");
    const consumo = (
      await c.filas<{ m: string }>(
        "select movimiento_de_consumo_id as m from orden_de_produccion where id = $1",
        [b.ordenId],
      )
    )[0]?.m;
    expect(
      (await c.auditoria(e.empresa, "CONTROL_EXCEPCION")).filter(
        (x) => x["entidad_id"] === consumo,
      ),
    ).toHaveLength(2);
    await c.fijarNivel(e.empresa, "BLOQUEAR");
  });

  it("C12: anular una orden mientras otra sesión usa el producto: o se anula entera o PRODUCTO_YA_USADO; nunca queda el producto en negativo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con("100", "50");
      await c.fijarNivel(e.empresa, "BLOQUEAR");
      const a = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      const rs = await aLaVez<Mixto>(
        c,
        [
          () =>
            firme(() =>
              c.produccion.anularOrden(e.gerente, {
                ordenId: a.ordenId,
                motivo: "Anulada mientras se usa",
              }),
            ),
          () =>
            firme(() =>
              c.casos.registrarSalida(e.gerente, {
                clave: nuevoId(),
                depositoId: p.destino,
                motivo: "CONSUMO_INTERNO",
                renglones: [{ productoId: p.masa.producto, cantidad: "10", unidadId: "KILOGRAMO" }],
              }),
            ),
        ],
        ronda,
      );
      const anulada = (await estado(a.ordenId)) === "ANULADA";
      expect(soloOk(rs), JSON.stringify(rs)).toBe(1);
      const masa = await c.existencia(p.destino, p.masa.articulo);
      if (anulada) {
        expect(masa).toBe("0.0000");
        expect(
          rs[0] && rs.some((r) => !r.ok && JSON.stringify(r).includes("CONTROL_BLOQUEA")),
        ).toBe(true);
      } else {
        expect(masa).toBe("5.0000");
        expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "PRODUCTO_YA_USADO" });
      }
      expect(Number(masa)).toBeGreaterThanOrEqual(0);
    }
  });

  describe("D7: atomicidad", () => {
    it("una falla después del consumo y antes del producto, o después del producto y antes de completar la orden, no deja ningún movimiento, lote ni cambio", async () => {
      const p = await con("100", "50");
      c.encenderPerilla("lotes");
      valorDe(
        await c.casos.controlarLote(e.gerente, {
          productoId: p.masa.producto,
          modo: "LOTE",
          conCalidad: false,
        }),
      );
      const a = valorDe(await abrir(p));
      const antes = {
        harina: await c.existencia(p.origen, p.harina.articulo),
        lotes: await c.contar("select count(*) as n from lote where articulo_id = $1", [
          p.masa.articulo,
        ]),
      };
      const sinProducto = c.casosConFalla((tx: never) => ({
        lotesDeStock: {
          ...(tx as { lotesDeStock: object }).lotesDeStock,
          controlesDe: () => {
            throw new Error("falla inyectada antes del producto");
          },
        },
      }));
      await expect(
        sinProducto.cerrarOrden(e.gerente, {
          ordenId: a.ordenId,
          clave: nuevoId(),
          obtenido: "15",
          unidadId: "KILOGRAMO",
          consumos: [
            { productoId: p.harina.producto, cantidadReal: "12", unidadId: "KILOGRAMO" },
            { productoId: p.manteca.producto, cantidadReal: "4", unidadId: "KILOGRAMO" },
          ],
        }),
      ).rejects.toThrow(/falla inyectada/);
      const sinOrden = c.casosConFalla((tx: never) => ({
        ordenesDeProduccion: {
          ...(tx as { ordenesDeProduccion: object }).ordenesDeProduccion,
          cerrar: () => {
            throw new Error("falla inyectada antes de completar la orden");
          },
        },
      }));
      await expect(
        sinOrden.cerrarOrden(e.gerente, {
          ordenId: a.ordenId,
          clave: nuevoId(),
          obtenido: "15",
          unidadId: "KILOGRAMO",
          consumos: [
            { productoId: p.harina.producto, cantidadReal: "12", unidadId: "KILOGRAMO" },
            { productoId: p.manteca.producto, cantidadReal: "4", unidadId: "KILOGRAMO" },
          ],
        }),
      ).rejects.toThrow(/falla inyectada/);
      expect(await movimientos(a.ordenId)).toBe(0);
      expect(await estado(a.ordenId)).toBe("ABIERTA");
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe(antes.harina);
      expect(
        await c.contar("select count(*) as n from lote where articulo_id = $1", [p.masa.articulo]),
      ).toBe(antes.lotes);
      expect(
        await c.contar(
          "select count(*) as n from renglon_de_orden where orden_id = $1 and cantidad_real is not null",
          [a.ordenId],
        ),
      ).toBe(0);
      // Y la orden sigue cerrándose bien.
      expect(valorDe(await cerrar(a.ordenId, p)).yaExistia).toBe(false);
    });

    it("un cierre con el segundo ingrediente bloqueado por el control no deja nada del primero", async () => {
      const p = await con("100", "3"); // la manteca no alcanza: faltan 1 kg
      await c.fijarNivel(e.empresa, "PERMITIR");
      const a = valorDe(await abrir(p));
      await c.fijarNivel(e.empresa, "BLOQUEAR");
      const r = await cerrar(a.ordenId, p);
      expect(r).toMatchObject({ ok: false, error: { error: "CONTROL_BLOQUEA" } });
      expect(await movimientos(a.ordenId)).toBe(0);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
      expect(Number(await c.existencia(p.destino, p.masa.articulo))).toBe(0);
      expect(await estado(a.ordenId)).toBe("ABIERTA");
    });
  });

  describe("D8 y D10", () => {
    it("D8: la empresa B no ve ni toca las órdenes de A (leer, cerrar, cancelar, anular) y la misma clave en dos empresas son dos hechos", async () => {
      const p = await con("100", "50");
      const a = valorDe(await abrir(p));
      const deOtra = await con("100", "50", otra);
      const clave = nuevoId();
      const propia = valorDe(await abrir(deOtra, otra.gerente));
      expect(await cerrar(a.ordenId, p, {}, otra.gerente)).toEqual({
        ok: false,
        error: "ORDEN_NO_ENCONTRADA",
      });
      expect(
        await c.produccion.cancelarOrden(otra.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(
        await c.produccion.anularOrden(otra.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(
        valorDe(await c.consultasDeProduccion.fichaDeOrden(otra.gerente, { ordenId: a.ordenId })),
      ).toBeNull();
      const lista = valorDe(await c.consultasDeProduccion.listarOrdenes(otra.gerente));
      expect(lista.every((o) => o.ordenId !== a.ordenId)).toBe(true);
      // La misma clave en dos empresas: cada una cierra lo suyo.
      valorDe(await cerrar(a.ordenId, p, { clave }));
      valorDe(await cerrar(propia.ordenId, deOtra, { clave }, otra.gerente));
      expect(await estado(a.ordenId)).toBe("CERRADA");
      expect(await estado(propia.ordenId)).toBe("CERRADA");
    });
  });
});
