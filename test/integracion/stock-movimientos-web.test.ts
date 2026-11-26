import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  ajustarElStock,
  anularElMovimiento,
  registrarElMovimiento,
  transferirElStock,
  type DependenciasDeMovimientosWeb,
} from "../../src/composicion/movimientos-web";
import {
  movimientosDelDeposito,
  type DependenciasDeExistenciasYLibroWeb,
} from "../../src/composicion/existencias-y-libro-web";
import {
  aLaVez,
  montarStock,
  nuevoId,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Los movimientos a mano de la web contra una base real y los roles reales: repetir el gesto no duplica, dos personas a la vez no rompen la cuenta, el operador no ajusta ni anula ni da de baja por
 * vencimiento, una sucursal o empresa ajena sale como el genérico, y anular crea un espejo una sola vez. Las reglas del dominio (costos, negativos, lotes) tienen sus pruebas en `stock-movimientos.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("movimientos de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let d: DependenciasDeMovimientosWeb;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const nuevo = async () => ({ dep: await c.deposito(e), ...(await c.articulo(e)) });
  const mover =
    (entrada: boolean, quien?: ContextoOperativo, sucursal?: string) =>
    (dep: string, art: string, cantidad: string, extra: Record<string, unknown> = {}) =>
      registrarElMovimiento(d, quien ?? e.gerente, sucursal ?? e.sucursal, entrada, {
        clave: nuevoId(),
        depositoId: dep,
        articuloId: art,
        cantidad,
        motivo: entrada ? "COMPRA" : "MERMA",
        ...extra,
      });
  const entrar = mover(true);
  const salir = mover(false);
  const movimientos = async (dep: string) => {
    const r = await movimientosDelDeposito(
      {
        consultas: () => c.consultas,
        consultasDeIdentidad: () => ({
          personasParaMostrar: () => Promise.resolve({ ok: true, valor: new Map() }),
        }),
        respuesta: { registrar: () => undefined },
      } as unknown as DependenciasDeExistenciasYLibroWeb,
      e.gerente,
      e.sucursal,
      { depositoId: dep },
    );
    if (!r.ok) throw new Error(r.error.codigo);
    return r.dato.movimientos;
  };

  it("una entrada suma a la existencia; repetirla con la misma clave devuelve lo ya hecho y no suma de nuevo", async () => {
    const { dep, articulo, producto } = await nuevo();
    void producto;
    const clave = nuevoId();
    const hacer = () => entrar(dep, articulo, "5", { clave });
    const a = await hacer();
    const b = await hacer();
    expect(a.ok && b.ok && [a.dato.yaExistia, b.dato.yaExistia]).toEqual([false, true]);
    expect(a.ok && b.ok && a.dato.movimientoId === b.dato.movimientoId).toBe(true);
    expect(await c.existencia(dep, articulo)).toBe("5.0000");
    expect(await movimientos(dep)).toHaveLength(1);
  });

  it("dos clics a la vez con la misma clave dejan un solo movimiento", async () => {
    const { dep, articulo } = await nuevo();
    const clave = nuevoId();
    const rs = await aLaVez(
      c,
      [() => entrar(dep, articulo, "2", { clave }), () => entrar(dep, articulo, "2", { clave })],
      0,
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await c.existencia(dep, articulo)).toBe("2.0000");
    expect(await movimientos(dep)).toHaveLength(1);
  });

  it("dos personas sacan lo último a la vez: la existencia refleja las dos salidas, sin pérdidas", async () => {
    const { dep, articulo } = await nuevo();
    expect((await entrar(dep, articulo, "1")).ok).toBe(true);
    const rs = await aLaVez(
      c,
      [() => salir(dep, articulo, "1"), () => mover(false, e.operador)(dep, articulo, "1")],
      0,
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(await c.existencia(dep, articulo)).toBe("-1.0000");
    expect(await movimientos(dep)).toHaveLength(3);
  });

  it("transferir mueve de un depósito a otro y juntos suman lo mismo; al mismo depósito sale con su texto propio", async () => {
    const { dep, articulo } = await nuevo();
    const otro = await c.deposito(e);
    await entrar(dep, articulo, "4");
    const hacer = (origenId: string, destinoId: string) =>
      transferirElStock(d, e.gerente, e.sucursal, {
        clave: nuevoId(),
        origenId,
        destinoId,
        articuloId: articulo,
        cantidad: "1.5",
      });
    expect((await hacer(dep, otro)).ok).toBe(true);
    expect([await c.existencia(dep, articulo), await c.existencia(otro, articulo)]).toEqual([
      "2.5000",
      "1.5000",
    ]);
    expect(codigoDe(await hacer(dep, dep))).toBe("STOCK_TRANSFERENCIA_AL_MISMO_DEPOSITO");
  });

  it("el operador no ajusta, no anula y no da de baja por vencimiento; el gerente sí ajusta", async () => {
    const { dep, articulo } = await nuevo();
    const hecho = await entrar(dep, articulo, "3");
    const ajuste = (quien?: ContextoOperativo, extra: Record<string, unknown> = {}) =>
      ajustarElStock(d, quien ?? e.gerente, e.sucursal, {
        clave: nuevoId(),
        depositoId: dep,
        articuloId: articulo,
        sentido: "RESTA",
        cantidad: "1",
        detalle: "Se rompió",
        ...extra,
      });
    expect(codigoDe(await ajuste(e.operador))).not.toBe("OK");
    expect((await ajuste(e.gerente)).ok).toBe(true);
    expect(await c.existencia(dep, articulo)).toBe("2.0000");
    expect(
      codigoDe(await mover(false, e.operador)(dep, articulo, "1", { motivo: "VENCIMIENTO" })),
    ).not.toBe("OK");
    const movimientoId = hecho.ok ? hecho.dato.movimientoId : "";
    expect(
      codigoDe(
        await anularElMovimiento(d, e.operador, {
          clave: nuevoId(),
          movimientoId,
          detalle: "Error",
        }),
      ),
    ).not.toBe("OK");
    expect(await c.existencia(dep, articulo)).toBe("2.0000");
  });

  it("validaciones del servidor: cantidad cero o con demasiados decimales, ajuste sin detalle y costo en una salida salen sin mover nada", async () => {
    const { dep, articulo } = await nuevo();
    expect(codigoDe(await entrar(dep, articulo, "0"))).toBe("STOCK_CANTIDAD_INVALIDA");
    expect(codigoDe(await entrar(dep, articulo, "1.23456"))).toBe("STOCK_CANTIDAD_INVALIDA");
    expect(
      codigoDe(
        await ajustarElStock(d, e.gerente, e.sucursal, {
          clave: nuevoId(),
          depositoId: dep,
          articuloId: articulo,
          sentido: "SUMA",
          cantidad: "1",
        }),
      ),
    ).toBe("STOCK_DETALLE_REQUERIDO");
    expect(codigoDe(await salir(dep, articulo, "1", { costoUnitario: "5" }))).toBe(GENERICO);
    expect(await c.existencia(dep, articulo)).toBe("0");
  });

  it("un depósito de otra sucursal o un artículo de otra empresa sale como el genérico y no mueve nada", async () => {
    const { dep, articulo } = await nuevo();
    const ajeno = await c.deposito({ ...e, sucursal: e.otraSucursal });
    expect(codigoDe(await entrar(ajeno, articulo, "1"))).toBe(GENERICO);
    const otra = await c.escenario();
    const deOtra = await c.articulo(otra);
    expect(codigoDe(await entrar(dep, deOtra.articulo, "1"))).toBe(GENERICO);
    expect(codigoDe(await mover(true, otra.gerente, otra.sucursal)(dep, articulo, "1"))).toBe(
      GENERICO,
    );
    expect(await c.existencia(ajeno, articulo)).toBe("0");
  });

  it("anular crea un espejo una sola vez: repetir con la misma clave es lo mismo; con otra clave, rechazo; la anulación no se anula; la lista marca lo anulado", async () => {
    const { dep, articulo } = await nuevo();
    const hecho = await entrar(dep, articulo, "3");
    const movimientoId = hecho.ok ? hecho.dato.movimientoId : "";
    const clave = nuevoId();
    const anular = (k: string, id = movimientoId) =>
      anularElMovimiento(d, e.gerente, { clave: k, movimientoId: id, detalle: "Error de carga" });
    const a = await anular(clave);
    const b = await anular(clave);
    expect(a.ok && b.ok && [a.dato.yaExistia, b.dato.yaExistia]).toEqual([false, true]);
    expect(await c.existencia(dep, articulo)).toBe("0.0000");
    expect(codigoDe(await anular(nuevoId()))).not.toBe("OK");
    const lista = await movimientos(dep);
    expect(lista).toHaveLength(2);
    expect(lista.find((m) => m.clase === "ENTRADA")).toMatchObject({
      anulado: true,
      anulable: false,
    });
    const espejo = lista.find((m) => m.clase === "ANULACION");
    expect(espejo).toMatchObject({ anulable: false, cantidad: "-3.0000" });
    expect(codigoDe(await anular(nuevoId(), espejo?.movimientoId))).not.toBe("OK");
    expect(await c.existencia(dep, articulo)).toBe("0.0000");
  });

  it("dos anulaciones del mismo movimiento a la vez dejan un solo espejo", async () => {
    const { dep, articulo } = await nuevo();
    const hecho = await entrar(dep, articulo, "2");
    const movimientoId = hecho.ok ? hecho.dato.movimientoId : "";
    const rs = await aLaVez(
      c,
      [1, 2].map(
        () => () =>
          anularElMovimiento(d, e.gerente, { clave: nuevoId(), movimientoId, detalle: "Error" }),
      ),
      0,
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await c.existencia(dep, articulo)).toBe("0.0000");
    expect((await movimientos(dep)).filter((m) => m.clase === "ANULACION")).toHaveLength(1);
  });

  describe("el aviso de negativo (control stock.existencia_negativa)", () => {
    const AVISA = "STOCK_CONTROL_AVISA";
    const transferir = (
      origenId: string,
      destinoId: string,
      articuloId: string,
      extra: Record<string, unknown> = {},
    ) =>
      transferirElStock(d, e.gerente, e.sucursal, {
        clave: nuevoId(),
        origenId,
        destinoId,
        articuloId,
        cantidad: "2",
        ...extra,
      });

    it("con AVISAR, una salida que deja negativo avisa y no mueve nada; confirmada con la misma clave se registra una sola vez", async () => {
      await c.fijarNivel(e.empresa, "AVISAR");
      try {
        const { dep, articulo } = await nuevo();
        await entrar(dep, articulo, "1");
        const clave = nuevoId();
        expect(codigoDe(await salir(dep, articulo, "3", { clave }))).toBe(AVISA);
        expect(await c.existencia(dep, articulo)).toBe("1.0000");
        const a = await salir(dep, articulo, "3", { clave, confirmar: "1" });
        const b = await salir(dep, articulo, "3", { clave, confirmar: "1" });
        expect(a.ok && b.ok && [a.dato.yaExistia, b.dato.yaExistia]).toEqual([false, true]);
        expect(await c.existencia(dep, articulo)).toBe("-2.0000");
        expect((await movimientos(dep)).filter((m) => m.clase === "SALIDA")).toHaveLength(1);
      } finally {
        await c.fijarNivel(e.empresa, "PERMITIR");
      }
    });

    it("con AVISAR, una confirmación sobre una salida que NO deja negativo no cambia nada, y una transferencia que deja negativo también avisa", async () => {
      await c.fijarNivel(e.empresa, "AVISAR");
      try {
        const { dep, articulo } = await nuevo();
        const otro = await c.deposito(e);
        await entrar(dep, articulo, "5");
        expect((await salir(dep, articulo, "1", { confirmar: "1" })).ok).toBe(true);
        expect(await c.existencia(dep, articulo)).toBe("4.0000");
        expect(codigoDe(await transferir(dep, otro, articulo, { cantidad: "9" }))).toBe(AVISA);
        expect(await c.existencia(otro, articulo)).toBe("0");
        expect((await transferir(dep, otro, articulo, { cantidad: "9", confirmar: "1" })).ok).toBe(
          true,
        );
        expect([await c.existencia(dep, articulo), await c.existencia(otro, articulo)]).toEqual([
          "-5.0000",
          "9.0000",
        ]);
      } finally {
        await c.fijarNivel(e.empresa, "PERMITIR");
      }
    });

    it("con AVISAR, dos personas sacan lo último a la vez sin confirmar: solo una pasa y la otra recibe el aviso", async () => {
      await c.fijarNivel(e.empresa, "AVISAR");
      try {
        const { dep, articulo } = await nuevo();
        await entrar(dep, articulo, "1");
        const rs = await aLaVez(
          c,
          [() => salir(dep, articulo, "1"), () => mover(false, e.operador)(dep, articulo, "1")],
          0,
        );
        expect(rs.filter((r) => r.ok)).toHaveLength(1);
        expect(rs.map(codigoDe).sort()).toEqual(["OK", AVISA]);
        expect(await c.existencia(dep, articulo)).toBe("0.0000");
      } finally {
        await c.fijarNivel(e.empresa, "PERMITIR");
      }
    });

    it("con PERMITIR, confirmar o no da lo mismo: la salida se registra, deja negativo y no avisa", async () => {
      const { dep, articulo } = await nuevo();
      expect((await salir(dep, articulo, "1")).ok).toBe(true);
      expect((await salir(dep, articulo, "1", { confirmar: "1" })).ok).toBe(true);
      expect(await c.existencia(dep, articulo)).toBe("-2.0000");
    });

    it("el ajuste y la anulación nunca avisan, ni con AVISAR", async () => {
      await c.fijarNivel(e.empresa, "AVISAR");
      try {
        const { dep, articulo } = await nuevo();
        const hecho = await entrar(dep, articulo, "1");
        const ajuste = await ajustarElStock(d, e.gerente, e.sucursal, {
          clave: nuevoId(),
          depositoId: dep,
          articuloId: articulo,
          sentido: "RESTA",
          cantidad: "4",
          detalle: "Se perdió",
        });
        expect(ajuste.ok).toBe(true);
        expect(await c.existencia(dep, articulo)).toBe("-3.0000");
        const movimientoId = hecho.ok ? hecho.dato.movimientoId : "";
        expect(
          (
            await anularElMovimiento(d, e.gerente, {
              clave: nuevoId(),
              movimientoId,
              detalle: "Error de carga",
            })
          ).ok,
        ).toBe(true);
        expect(await c.existencia(dep, articulo)).toBe("-4.0000");
      } finally {
        await c.fijarNivel(e.empresa, "PERMITIR");
      }
    });
  });
});
