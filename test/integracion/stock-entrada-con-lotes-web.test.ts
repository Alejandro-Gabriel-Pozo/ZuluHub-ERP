import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  registrarLaCargaInicial,
  type DependenciasDeCargaInicialWeb,
} from "../../src/composicion/carga-inicial-web";
import { lotesDelArticulo, type DependenciasDeLotesWeb } from "../../src/composicion/lotes-web";
import {
  opcionesParaMover,
  registrarElMovimiento,
  type DependenciasDeMovimientosWeb,
} from "../../src/composicion/movimientos-web";
import {
  aLaVez,
  montarStock,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * La entrada con lote y la carga inicial con lote de la web (STK-E2b) contra la base real y los roles reales, TODAS a través de la composición: las opciones dicen cómo se controla cada artículo (solo de la empresa de quien mira),
 * la entrada crea el lote con su vencimiento, el mismo clic dos veces es un solo movimiento, dos entradas a la vez del mismo lote nuevo no lo duplican (con otra fecha, una gana y la otra no pisa), y lo que no corresponde
 * (lote en una salida, en un artículo sin control, vencimiento sin código o pasado, falta de vencimiento) se rechaza sin escribir nada.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";
const RONDAS = 2;

describe.skipIf(base === null)("entrada con lote de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeMovimientosWeb;
  let carga: DependenciasDeCargaInicialWeb;
  let lectura: DependenciasDeLotesWeb;
  let deposito: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    c.encenderPerilla("lotes");
    deposito = await c.deposito(e);
    const comun = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
    d = comun;
    carga = comun;
    lectura = { consultas: () => c.consultas, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const controlado = async (modo: "LOTE_Y_VENCIMIENTO" | "LOTE" = "LOTE_Y_VENCIMIENTO") => {
    const a = await c.articulo(e);
    valorDe(
      await c.casos.controlarLote(e.gerente, { productoId: a.producto, modo, conCalidad: false }),
    );
    return a;
  };
  const lotesDe = async (articulo: string) => {
    const r = await lotesDelArticulo(lectura, e.gerente, { articuloId: articulo });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.dato.lotes;
  };
  const resumen = async (articulo: string) =>
    (await lotesDe(articulo))
      .filter((l) => !l.sinAsignar)
      .map((l) => [l.codigo, l.vence, l.existencia]);
  const losLotesSuman = async (articulo: string) => {
    const suma = (await lotesDe(articulo)).reduce(
      (s, l) => s + BigInt(l.existencia.replace(".", "")),
      0n,
    );
    expect(suma).toBe(BigInt((await c.existencia(deposito, articulo)).replace(".", "")));
  };
  const entrar = (
    articulo: string,
    extra: Record<string, unknown> = {},
    quien = e.gerente,
    entrada = true,
  ) =>
    registrarElMovimiento(d, quien, e.sucursal, entrada, {
      clave: randomUUID(),
      depositoId: deposito,
      articuloId: articulo,
      cantidad: "5",
      motivo: entrada ? "COMPRA" : "MERMA",
      ...extra,
    });

  it("las opciones dicen cómo se controla cada artículo por lote: modo si está activo, null si no se controla o se dejó de controlar; el operador las ve; otra empresa no ve las ajenas", async () => {
    const con = await controlado();
    const sin = await c.articulo(e);
    const solo = await controlado("LOTE");
    const modoDe = async (quien = e.gerente, articulo = con.articulo) => {
      const r = await opcionesParaMover(d, quien, e.sucursal);
      return r.ok ? r.dato.articulos.find((a) => a.id === articulo)?.controlDeLote : "SIN_OPCIONES";
    };
    expect(await modoDe()).toBe("LOTE_Y_VENCIMIENTO");
    expect(await modoDe(e.gerente, solo.articulo)).toBe("LOTE");
    expect(await modoDe(e.gerente, sin.articulo)).toBeNull();
    expect(await modoDe(e.operador)).toBe("LOTE_Y_VENCIMIENTO");
    expect(await modoDe(otra.gerente)).toBeUndefined();
    valorDe(await c.casos.dejarDeControlarLote(e.gerente, { productoId: con.producto }));
    expect(await modoDe()).toBeNull();
  });

  it("la entrada con lote crea el lote con su vencimiento y suma el saldo; el «Sin asignar» no recibe nada", async () => {
    const a = await controlado();
    expect(await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "2099-06-01" })).toMatchObject({
      ok: true,
      dato: { yaExistia: false },
    });
    expect(await resumen(a.articulo)).toEqual([["L-1", "2099-06-01", "5.0000"]]);
    expect((await lotesDe(a.articulo)).find((l) => l.sinAsignar)?.existencia ?? "0.0000").toBe(
      "0.0000",
    );
    await losLotesSuman(a.articulo);
  });

  it("el MISMO clic dos veces (misma clave) es un solo movimiento y un solo lote, a la vez también; con otro lote o fecha, la misma clave se rechaza", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await controlado();
      const clave = randomUUID();
      const pedido = { clave, loteCodigo: "L-1", loteVence: "2099-06-01" };
      const rs = await aLaVez(
        c,
        [() => entrar(a.articulo, pedido), () => entrar(a.articulo, pedido, e.administrador)],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(new Set(rs.flatMap((r) => (r.ok ? [r.dato.movimientoId] : []))).size).toBe(1);
      expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
      expect(await resumen(a.articulo)).toEqual([["L-1", "2099-06-01", "5.0000"]]);
      for (const otro of [
        { loteCodigo: "L-2", loteVence: "2099-06-01" },
        { loteCodigo: "L-1", loteVence: "2099-06-02" },
      ]) {
        expect(codigoDe(await entrar(a.articulo, { clave, ...otro }))).toBe(GENERICO);
      }
      expect(await c.existencia(deposito, a.articulo)).toBe("5.0000");
    }
  });

  it("DOS entradas a la vez del MISMO lote nuevo: con la misma fecha suman las dos; con fechas distintas una gana y la otra no pisa (con su texto propio)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const igual = await controlado();
      const rs = await aLaVez(
        c,
        [
          () => entrar(igual.articulo, { loteCodigo: "L-A", loteVence: "2099-01-01" }),
          () =>
            entrar(igual.articulo, { loteCodigo: "L-A", loteVence: "2099-01-01" }, e.administrador),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(await resumen(igual.articulo)).toEqual([["L-A", "2099-01-01", "10.0000"]]);
      await losLotesSuman(igual.articulo);

      const distinta = await controlado();
      const rd = await aLaVez(
        c,
        [
          () => entrar(distinta.articulo, { loteCodigo: "L-A", loteVence: "2099-01-01" }),
          () =>
            entrar(
              distinta.articulo,
              { loteCodigo: "L-A", loteVence: "2099-05-05" },
              e.administrador,
            ),
        ],
        ronda,
      );
      expect(rd.filter((r) => r.ok)).toHaveLength(1);
      expect(rd.filter((r) => !r.ok).map(codigoDe)).toEqual(["STOCK_LOTE_CON_OTRA_FECHA"]);
      expect((await lotesDe(distinta.articulo)).filter((l) => !l.sinAsignar)).toHaveLength(1);
      await losLotesSuman(distinta.articulo);
    }
  });

  it("vencimiento pasado y vencimiento que falta salen con su texto; lote existente con otra fecha con su texto propio; lote en artículo sin control, en una salida o un vencimiento sin código: genérico; nada se escribe", async () => {
    const a = await controlado();
    const sinControl = await c.articulo(e);
    expect(codigoDe(await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "2000-01-01" }))).toBe(
      "STOCK_VENCIMIENTO_PASADO",
    );
    expect(codigoDe(await entrar(a.articulo, { loteCodigo: "L-1" }))).toBe(
      "LOTE_VENCIMIENTO_REQUERIDO",
    );
    expect(codigoDe(await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "mañana" }))).toBe(
      "LOTE_VENCIMIENTO_REQUERIDO",
    );
    expect(codigoDe(await entrar(a.articulo, { loteCodigo: "L 1", loteVence: "2099-06-01" }))).toBe(
      GENERICO,
    );
    expect(codigoDe(await entrar(a.articulo, { loteVence: "2099-06-01" }))).toBe(GENERICO);
    expect(
      codigoDe(await entrar(sinControl.articulo, { loteCodigo: "L-1", loteVence: "2099-06-01" })),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "2099-06-01" }, e.gerente, false),
      ),
    ).toBe(GENERICO);
    expect(await c.existencia(deposito, a.articulo)).toBe("0");
    expect(await c.existencia(deposito, sinControl.articulo)).toBe("0");
    expect(await resumen(a.articulo)).toEqual([]);
    valorDe((await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "2099-06-01" })) as never);
    expect(codigoDe(await entrar(a.articulo, { loteCodigo: "L-1", loteVence: "2099-07-07" }))).toBe(
      "STOCK_LOTE_CON_OTRA_FECHA",
    );
    expect(await resumen(a.articulo)).toEqual([["L-1", "2099-06-01", "5.0000"]]);
  });

  it("con control de lote SIN vencimiento no hace falta fecha; el operador puede entrar con lote y una empresa ajena no puede usar el artículo", async () => {
    const solo = await controlado("LOTE");
    expect((await entrar(solo.articulo, { loteCodigo: "S-1" }, e.operador)).ok).toBe(true);
    expect(await resumen(solo.articulo)).toEqual([["S-1", null, "5.0000"]]);
    expect(codigoDe(await entrar(solo.articulo, { loteCodigo: "S-2" }, otra.gerente))).toBe(
      GENERICO,
    );
  });

  it("la CARGA INICIAL con lote: una tanda con lote en una fila y sin lote en otra queda en una sola entrada; repetir la clave no duplica; el vencimiento sin código frena toda la tanda", async () => {
    const con = await controlado();
    const sin = await c.articulo(e);
    const clave = randomUUID();
    const pedido = (renglones: unknown, claveDelPedido = clave) => ({
      clave: claveDelPedido,
      depositoId: deposito,
      confirmar: "1",
      renglones,
    });
    const renglones = [
      {
        articuloId: con.articulo,
        cantidad: "4",
        costoUnitario: "",
        loteCodigo: "C-1",
        loteVence: "2099-06-01",
      },
      { articuloId: sin.articulo, cantidad: "2", costoUnitario: "", loteCodigo: "", loteVence: "" },
    ];
    const primera = await registrarLaCargaInicial(carga, e.gerente, e.sucursal, pedido(renglones));
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const repetida = await registrarLaCargaInicial(carga, e.gerente, e.sucursal, pedido(renglones));
    expect(repetida).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await resumen(con.articulo)).toEqual([["C-1", "2099-06-01", "4.0000"]]);
    expect(await c.existencia(deposito, sin.articulo)).toBe("2.0000");
    const mala = await registrarLaCargaInicial(
      carga,
      e.gerente,
      e.sucursal,
      pedido(
        [{ articuloId: con.articulo, cantidad: "1", costoUnitario: "", loteVence: "2099-06-01" }],
        randomUUID(),
      ),
    );
    expect(codigoDe(mala)).toBe(GENERICO);
    expect(await resumen(con.articulo)).toEqual([["C-1", "2099-06-01", "4.0000"]]);
    await losLotesSuman(con.articulo);
  });
});
