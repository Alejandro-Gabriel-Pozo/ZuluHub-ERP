import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  lotesDelArticulo,
  type DependenciasDeLotesWeb,
  type LotesParaLaPantalla,
} from "../../src/composicion/lotes-web";
import {
  aLaVez,
  montarStock,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * `registrarEntrada` con lotes por renglón (STK-E2a, DEC-STK-006) contra la base real y los roles reales: los lotes se crean con su vencimiento y suman el renglón; repetir la clave no duplica (ni lote ni movimiento) y la misma
 * clave con otros lotes es CLAVE_REUTILIZADA; el reintento de un pedido VIEJO sin lotes sigue siendo una repetición; lotes en un artículo sin control, que no suman, repetidos, sin vencimiento o con vencimiento pasado se rechazan sin escribir nada;
 * dos entradas a la vez del mismo lote nuevo no lo duplican (una gana, la otra con otra fecha se rechaza); y los lotes siempre suman el saldo del artículo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const RONDAS = 2;

describe.skipIf(base === null)("entrada con lotes", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let lectura: DependenciasDeLotesWeb;
  let deposito: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    c.encenderPerilla("lotes");
    deposito = await c.deposito(e, { deVenta: true });
    lectura = { consultas: () => c.consultas, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const leerLotes = async (articulo: string): Promise<LotesParaLaPantalla> => {
    const r = await lotesDelArticulo(lectura, e.gerente, { articuloId: articulo });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.dato;
  };
  const losLotesSuman = async (articulo: string) => {
    const lotes = (await leerLotes(articulo)).lotes;
    const suma = lotes.reduce((s, l) => s + BigInt(l.existencia.replace(".", "")), 0n);
    const saldo = BigInt((await c.existencia(deposito, articulo)).replace(".", ""));
    expect(suma).toBe(saldo);
  };
  const resumen = async (articulo: string) =>
    (await leerLotes(articulo)).lotes.map((l) => [l.codigo, l.vence, l.existencia]);
  const controlado = async (modo: "LOTE_Y_VENCIMIENTO" | "LOTE" = "LOTE_Y_VENCIMIENTO") => {
    const a = await c.articulo(e);
    valorDe(
      await c.casos.controlarLote(e.gerente, { productoId: a.producto, modo, conCalidad: false }),
    );
    return a;
  };
  const entrar = (
    producto: string,
    lotes: unknown,
    cantidad: string,
    extra: Record<string, unknown> = {},
    quien = e.gerente,
  ) =>
    c.casos.registrarEntrada(quien, {
      clave: randomUUID(),
      depositoId: deposito,
      motivo: "COMPRA",
      renglones: [{ productoId: producto, cantidad, unidadId: "UNIDAD", lotes } as never],
      ...extra,
    });
  const lote = (codigo: string, cantidad: string, vence = "2099-06-01") => ({
    codigo,
    fechaDeVencimiento: vence,
    cantidad,
  });

  it("crea los lotes con su vencimiento, suman el renglón y el saldo del artículo; el «Sin asignar» no recibe nada", async () => {
    const a = await controlado();
    const r = valorDe(
      await entrar(
        a.producto,
        [lote("L-A", "3", "2099-01-01"), lote("L-B", "2.5", "2099-02-01")],
        "5.5",
      ),
    );
    expect(r.yaExistia).toBe(false);
    expect(await resumen(a.articulo)).toEqual(
      expect.arrayContaining([
        ["L-A", "2099-01-01", "3.0000"],
        ["L-B", "2099-02-01", "2.5000"],
      ]),
    );
    expect(
      (await leerLotes(a.articulo)).lotes.find((l) => l.sinAsignar)?.existencia ?? "0.0000",
    ).toBe("0.0000");
    expect(await c.existencia(deposito, a.articulo)).toBe("5.5000");
    await losLotesSuman(a.articulo);
  });

  it("repetir la MISMA clave con los mismos lotes devuelve lo hecho (un lote, un movimiento); en otro orden, también; con otros lotes o fechas, CLAVE_REUTILIZADA", async () => {
    const a = await controlado();
    const clave = randomUUID();
    const lotes = [lote("L-A", "3", "2099-01-01"), lote("L-B", "2", "2099-02-01")];
    const primera = valorDe(await entrar(a.producto, lotes, "5", { clave }));
    const repetida = valorDe(await entrar(a.producto, [...lotes].reverse(), "5", { clave }));
    expect(repetida).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
    expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
    expect((await leerLotes(a.articulo)).lotes.filter((l) => !l.sinAsignar)).toHaveLength(2);
    for (const otros of [
      [lote("L-A", "4", "2099-01-01"), lote("L-B", "1", "2099-02-01")],
      [lote("L-A", "3", "2099-01-02"), lote("L-B", "2", "2099-02-01")],
      [lote("L-C", "3", "2099-01-01"), lote("L-B", "2", "2099-02-01")],
    ]) {
      expect(await entrar(a.producto, otros, "5", { clave })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    }
    expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
  });

  it("el MISMO clic dos veces a la vez (misma clave, mismos lotes) es un solo movimiento y los lotes quedan con lo de una sola entrada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await controlado();
      const clave = randomUUID();
      const lotes = [lote("L-A", "3", "2099-01-01"), lote("L-B", "2", "2099-02-01")];
      const rs = await aLaVez(
        c,
        [
          () => entrar(a.producto, lotes, "5", { clave }),
          () => entrar(a.producto, lotes, "5", { clave }, e.administrador),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(new Set(rs.flatMap((r) => (r.ok ? [r.valor.movimientoId] : []))).size).toBe(1);
      expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
      await losLotesSuman(a.articulo);
    }
  });

  it("un pedido VIEJO sin lotes (entra al «Sin asignar») repetido con la misma clave sigue siendo una repetición, con y sin costo", async () => {
    const a = await controlado();
    for (const costoUnitario of [undefined, "12.5"]) {
      const clave = randomUUID();
      const pedido = {
        clave,
        depositoId: deposito,
        motivo: "COMPRA",
        renglones: [
          {
            productoId: a.producto,
            cantidad: "2",
            unidadId: "UNIDAD",
            ...(costoUnitario === undefined ? {} : { costoUnitario }),
          },
        ],
      };
      const primera = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
      const otra = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
      expect(otra).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
    }
    expect(await c.existencia(deposito, a.articulo)).toBe("4.0000");
    await losLotesSuman(a.articulo);
  });

  it("todo o nada: lotes que no suman, repetidos, sin vencimiento, con vencimiento pasado o en un artículo SIN control se rechazan y no escriben nada", async () => {
    const a = await controlado();
    const sinControl = await c.articulo(e);
    const casos: [string, unknown, string, string][] = [
      ["no suman", [lote("L-A", "4")], "5", "RENGLONES_INVALIDOS"],
      ["repetido", [lote("L-A", "2"), lote("L-A", "3")], "5", "RENGLON_REPETIDO"],
      ["sin vencimiento", [{ codigo: "L-A", cantidad: "5" }], "5", "VENCIMIENTO_REQUERIDO"],
      ["vencimiento pasado", [lote("L-A", "5", "2000-01-01")], "5", "VENCIMIENTO_PASADO"],
      ["código inválido", [lote("L A", "5")], "5", "IDENTIFICADOR_INVALIDO"],
      ["cantidad cero", [lote("L-A", "0")], "5", "CANTIDAD_INVALIDA"],
    ];
    for (const [nombre, lotes, cantidad, error] of casos) {
      expect(await entrar(a.producto, lotes, cantidad), nombre).toEqual({ ok: false, error });
    }
    expect(await entrar(sinControl.producto, [lote("L-A", "5")], "5")).toEqual({
      ok: false,
      error: "LOTES_SIN_CONTROL",
    });
    expect(await c.existencia(deposito, a.articulo)).toBe("0");
    expect(await c.existencia(deposito, sinControl.articulo)).toBe("0");
    expect((await leerLotes(a.articulo)).lotes.filter((l) => !l.sinAsignar)).toHaveLength(0);
  });

  it("con control de lote SIN vencimiento los lotes no piden fecha; el mismo artículo dos veces en el pedido es ambiguo", async () => {
    const a = await controlado("LOTE");
    valorDe(await entrar(a.producto, [{ codigo: "S-1", cantidad: "5" }], "5"));
    expect(await resumen(a.articulo)).toEqual(expect.arrayContaining([["S-1", null, "5.0000"]]));
    const b = await controlado();
    const dos = await c.casos.registrarEntrada(e.gerente, {
      clave: randomUUID(),
      depositoId: deposito,
      motivo: "COMPRA",
      renglones: [
        { productoId: b.producto, cantidad: "2", unidadId: "UNIDAD", lotes: [lote("L-A", "2")] },
        { productoId: b.producto, cantidad: "1", unidadId: "UNIDAD" },
      ] as never,
    });
    expect(dos).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    expect(await c.existencia(deposito, b.articulo)).toBe("0");
  });

  it("un lote que ya existe: sumar con la MISMA fecha anda (suma al lote); con OTRA fecha se rechaza y no escribe", async () => {
    const a = await controlado();
    valorDe(await entrar(a.producto, [lote("L-A", "3", "2099-01-01")], "3"));
    valorDe(await entrar(a.producto, [lote("L-A", "2", "2099-01-01")], "2"));
    expect(await resumen(a.articulo)).toEqual(
      expect.arrayContaining([["L-A", "2099-01-01", "5.0000"]]),
    );
    expect(await entrar(a.producto, [lote("L-A", "1", "2099-03-03")], "1")).toEqual({
      ok: false,
      error: "LOTE_CON_OTRA_FECHA",
    });
    expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
    expect(await resumen(a.articulo)).toEqual(
      expect.arrayContaining([["L-A", "2099-01-01", "5.0000"]]),
    );
    await losLotesSuman(a.articulo);
  });

  it("DOS entradas a la vez del MISMO lote nuevo: un solo lote; con la misma fecha suman las dos, con fechas distintas una gana y la otra se rechaza", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const igual = await controlado();
      const rs = await aLaVez(
        c,
        [
          () => entrar(igual.producto, [lote("L-A", "3", "2099-01-01")], "3"),
          () => entrar(igual.producto, [lote("L-A", "2", "2099-01-01")], "2", {}, e.administrador),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect((await leerLotes(igual.articulo)).lotes.filter((l) => !l.sinAsignar)).toHaveLength(1);
      expect(await resumen(igual.articulo)).toEqual(
        expect.arrayContaining([["L-A", "2099-01-01", "5.0000"]]),
      );
      await losLotesSuman(igual.articulo);

      const distinta = await controlado();
      const rd = await aLaVez(
        c,
        [
          () => entrar(distinta.producto, [lote("L-A", "3", "2099-01-01")], "3"),
          () =>
            entrar(distinta.producto, [lote("L-A", "2", "2099-05-05")], "2", {}, e.administrador),
        ],
        ronda,
      );
      expect(rd.filter((r) => r.ok)).toHaveLength(1);
      expect(rd.filter((r) => !r.ok)).toEqual([{ ok: false, error: "LOTE_CON_OTRA_FECHA" }]);
      expect((await leerLotes(distinta.articulo)).lotes.filter((l) => !l.sinAsignar)).toHaveLength(
        1,
      );
      await losLotesSuman(distinta.articulo);
    }
  });

  it("permisos y aislamiento: el operador de la sucursal puede entrar (stock.registrar_entrada); la carga inicial con lotes exige además ajustar; una empresa ajena no ve el artículo", async () => {
    const a = await controlado();
    expect(
      valorDe(await entrar(a.producto, [lote("L-A", "5")], "5", {}, e.operador)).yaExistia,
    ).toBe(false);
    const carga = await entrar(
      a.producto,
      [lote("L-B", "5")],
      "5",
      { motivo: "CARGA_INICIAL", confirmaExistenciaPrevia: true },
      e.operador,
    );
    expect(carga).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(
      (
        await entrar(a.producto, [lote("L-B", "5")], "5", {
          motivo: "CARGA_INICIAL",
          confirmaExistenciaPrevia: true,
        })
      ).ok,
    ).toBe(true);
    const ajena = await c.casos.registrarEntrada(otra.gerente, {
      clave: randomUUID(),
      depositoId: deposito,
      motivo: "COMPRA",
      renglones: [
        { productoId: a.producto, cantidad: "5", unidadId: "UNIDAD", lotes: [lote("L-X", "5")] },
      ] as never,
    });
    expect(ajena.ok).toBe(false);
    await losLotesSuman(a.articulo);
  });

  it("los lotes no entran en otros movimientos: una salida, un ajuste o una transferencia con `lotes` es un pedido mal formado", async () => {
    const a = await controlado();
    valorDe(await entrar(a.producto, [lote("L-A", "5")], "5"));
    const renglon = [
      { productoId: a.producto, cantidad: "1", unidadId: "UNIDAD", lotes: [lote("L-A", "1")] },
    ] as never;
    const salida = await c.casos.registrarSalida(e.gerente, {
      clave: randomUUID(),
      depositoId: deposito,
      motivo: "MERMA",
      renglones: renglon,
    });
    expect(salida).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
  });
});
