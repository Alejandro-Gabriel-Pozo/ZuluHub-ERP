import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  ajustarElStock,
  anularElMovimiento,
  opcionesParaMover,
  registrarElMovimiento,
  transferirElStock,
  type DependenciasDeMovimientosWeb,
} from "./movimientos-web";

/** Los movimientos a mano con el módulo simulado: qué resuelve la composición (depósitos de la sucursal, artículo y unidad del servidor) y qué pide al caso de uso. Contra la base real, `test/integracion/stock-movimientos-web.test.ts`. */
const SUC = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";
const AJENO = "44444444-4444-4444-8444-444444444444";
const ART = "55555555-5555-4555-8555-555555555555";
const PROD = "66666666-6666-4666-8666-666666666666";
const CLAVE = "77777777-7777-4777-8777-777777777777";
const MOV = "88888888-8888-4888-8888-888888888888";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const montar = (cambios: { caso?: () => unknown; depositos?: unknown[] } = {}) => {
  const llamadas: { que: string; entrada: unknown }[] = [];
  const registrados: string[] = [];
  const caso = (que: string) => (_c: unknown, entrada: unknown) => {
    llamadas.push({ que, entrada });
    return Promise.resolve(
      cambios.caso?.() ?? ok({ movimientoId: MOV, yaExistia: false, anulacionId: MOV }),
    );
  };
  const d = {
    casosDeUso: () => ({
      registrarEntrada: caso("entrada"),
      registrarSalida: caso("salida"),
      transferir: caso("transferir"),
      ajustar: caso("ajustar"),
      anularMovimiento: caso("anular"),
    }),
    consultas: () => ({
      listarDepositos: () =>
        Promise.resolve(
          ok(
            cambios.depositos ?? [
              { id: D1, nombre: "Salón", uso: "NORMAL", activo: true },
              { id: D2, nombre: "Cuarentena", uso: "CUARENTENA", activo: true },
              { id: AJENO, nombre: "Viejo", uso: "NORMAL", activo: false },
            ],
          ),
        ),
      articulosControlados: () =>
        Promise.resolve(
          ok([{ articuloId: ART, productoId: PROD, nombre: "Harina", unidadId: "KILOGRAMO" }]),
        ),
    }),
    respuesta: { registrar: (x: string) => registrados.push(x) },
  } as unknown as DependenciasDeMovimientosWeb;
  return { d, llamadas, registrados };
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");
const pedido = { clave: CLAVE, depositoId: D1, articuloId: ART, cantidad: "2.5", motivo: "COMPRA" };

describe("opcionesParaMover", () => {
  it("ofrece los depósitos activos, los artículos y los motivos manuales (sin «Carga inicial»)", async () => {
    const { d } = montar();
    const r = await opcionesParaMover(d, contexto, SUC);
    expect(r.ok && r.dato.depositos.map((x) => x.id)).toEqual([D1, D2]);
    expect(r.ok && r.dato.articulos).toEqual([
      { id: ART, nombre: "Harina", unidadId: "KILOGRAMO" },
    ]);
    expect(r.ok && r.dato.motivosDeEntrada).toEqual([
      "COMPRA",
      "DEVOLUCION_DE_CLIENTE",
      "OTRA_ENTRADA",
    ]);
    expect(r.ok && r.dato.motivosDeSalida).toEqual([
      "CONSUMO_INTERNO",
      "MERMA",
      "ROTURA",
      "VENCIMIENTO",
      "OTRA_SALIDA",
    ]);
  });
});

describe("registrarElMovimiento", () => {
  it("la entrada lleva el producto y la unidad del servidor, la clave de la página y el costo; un costo en blanco es «sin costo»", async () => {
    const { d, llamadas } = montar();
    const r = await registrarElMovimiento(d, contexto, SUC, true, {
      ...pedido,
      costoUnitario: "10.5",
      detalle: "  ",
    });
    expect(r).toEqual({ ok: true, dato: { movimientoId: MOV, yaExistia: false } });
    expect(llamadas).toEqual([
      {
        que: "entrada",
        entrada: {
          clave: CLAVE,
          depositoId: D1,
          motivo: "COMPRA",
          detalle: undefined,
          renglones: [
            { productoId: PROD, cantidad: "2.5", unidadId: "KILOGRAMO", costoUnitario: "10.5" },
          ],
        },
      },
    ]);
    const b = montar();
    await registrarElMovimiento(b.d, contexto, SUC, true, { ...pedido, costoUnitario: "" });
    expect(
      (b.llamadas[0]?.entrada as { renglones: { costoUnitario?: string }[] }).renglones[0]
        ?.costoUnitario,
    ).toBeUndefined();
  });

  it("la salida usa el caso de salida y no inventa costo; si la persona manda uno, se lo pasa al servidor para que lo rechace", async () => {
    const a = montar();
    await registrarElMovimiento(a.d, contexto, SUC, false, { ...pedido, motivo: "MERMA" });
    expect(a.llamadas.map((l) => l.que)).toEqual(["salida"]);
    expect(JSON.stringify(a.llamadas[0]?.entrada)).not.toContain("costoUnitario");
    const b = montar();
    await registrarElMovimiento(b.d, contexto, SUC, false, {
      ...pedido,
      motivo: "MERMA",
      costoUnitario: "1",
    });
    expect(JSON.stringify(b.llamadas[0]?.entrada)).toContain('"costoUnitario":"1"');
  });

  it("un depósito que no es de la sucursal o está desactivado, o un artículo que no se puede mover, es el genérico y no llama al caso de uso", async () => {
    const { d, llamadas } = montar();
    for (const malo of [
      { depositoId: "99999999-9999-4999-8999-999999999999" },
      { depositoId: AJENO },
      { articuloId: "99999999-9999-4999-8999-999999999999" },
    ]) {
      expect(
        codigoDe(await registrarElMovimiento(d, contexto, SUC, true, { ...pedido, ...malo })),
      ).toBe(GENERICO);
    }
    expect(llamadas).toEqual([]);
  });

  it("un pedido mal formado es el genérico; un error del caso de uso sale traducido; una excepción sale con referencia", async () => {
    const a = montar();
    for (const malo of [
      {},
      { ...pedido, clave: "x" },
      { ...pedido, cantidad: 3 },
      { ...pedido, articuloId: undefined },
    ]) {
      expect(codigoDe(await registrarElMovimiento(a.d, contexto, SUC, true, malo))).toBe(GENERICO);
    }
    expect(a.llamadas).toEqual([]);
    const b = montar({ caso: () => err("CANTIDAD_INVALIDA") });
    expect(codigoDe(await registrarElMovimiento(b.d, contexto, SUC, true, pedido))).toBe(
      "STOCK_CANTIDAD_INVALIDA",
    );
    const c = montar({
      caso: () => {
        throw new Error("la base no responde");
      },
    });
    expect(codigoDe(await registrarElMovimiento(c.d, contexto, SUC, true, pedido))).not.toBe(
      GENERICO,
    );
    expect(c.registrados).toHaveLength(1);
  });

  it("repetir con la misma clave devuelve lo ya hecho (yaExistia)", async () => {
    const { d } = montar({ caso: () => ok({ movimientoId: MOV, yaExistia: true }) });
    expect(await registrarElMovimiento(d, contexto, SUC, true, pedido)).toEqual({
      ok: true,
      dato: { movimientoId: MOV, yaExistia: true },
    });
  });
});

describe("transferirElStock", () => {
  it("pide origen, destino y un renglón con el producto y la unidad del servidor; ambos depósitos tienen que ser de la sucursal", async () => {
    const { d, llamadas } = montar();
    await transferirElStock(d, contexto, SUC, {
      clave: CLAVE,
      origenId: D1,
      destinoId: D2,
      articuloId: ART,
      cantidad: "1",
    });
    expect(llamadas).toEqual([
      {
        que: "transferir",
        entrada: {
          clave: CLAVE,
          origenId: D1,
          destinoId: D2,
          renglones: [{ productoId: PROD, cantidad: "1", unidadId: "KILOGRAMO" }],
        },
      },
    ]);
    const b = montar();
    expect(
      codigoDe(
        await transferirElStock(b.d, contexto, SUC, {
          clave: CLAVE,
          origenId: D1,
          destinoId: AJENO,
          articuloId: ART,
          cantidad: "1",
        }),
      ),
    ).toBe(GENERICO);
    expect(b.llamadas).toEqual([]);
  });
});

describe("ajustarElStock", () => {
  it("lleva el sentido y el detalle; sin detalle manda vacío para que el servidor diga que falta; un sentido raro es el genérico", async () => {
    const { d, llamadas } = montar();
    await ajustarElStock(d, contexto, SUC, {
      clave: CLAVE,
      depositoId: D1,
      articuloId: ART,
      sentido: "RESTA",
      cantidad: "1",
      detalle: "Se rompió",
    });
    expect(llamadas[0]).toEqual({
      que: "ajustar",
      entrada: {
        clave: CLAVE,
        depositoId: D1,
        detalle: "Se rompió",
        renglones: [{ productoId: PROD, cantidad: "1", unidadId: "KILOGRAMO", sentido: "RESTA" }],
      },
    });
    await ajustarElStock(d, contexto, SUC, {
      clave: CLAVE,
      depositoId: D1,
      articuloId: ART,
      sentido: "SUMA",
      cantidad: "1",
    });
    expect((llamadas[1]?.entrada as { detalle: string }).detalle).toBe("");
    expect(
      codigoDe(
        await ajustarElStock(d, contexto, SUC, {
          clave: CLAVE,
          depositoId: D1,
          articuloId: ART,
          sentido: "OTRO",
          cantidad: "1",
        }),
      ),
    ).toBe(GENERICO);
    expect(llamadas).toHaveLength(2);
  });
});

describe("anularElMovimiento", () => {
  it("anula con la clave de la página y el detalle; repetir devuelve yaExistia; un pedido mal formado es el genérico", async () => {
    const { d, llamadas } = montar({ caso: () => ok({ anulacionId: MOV, yaExistia: true }) });
    expect(
      await anularElMovimiento(d, contexto, {
        clave: CLAVE,
        movimientoId: MOV,
        detalle: "Error de carga",
      }),
    ).toEqual({
      ok: true,
      dato: { yaExistia: true },
    });
    expect(llamadas[0]).toEqual({
      que: "anular",
      entrada: { clave: CLAVE, movimientoId: MOV, detalle: "Error de carga" },
    });
    expect(
      codigoDe(await anularElMovimiento(d, contexto, { clave: CLAVE, movimientoId: "x" })),
    ).toBe(GENERICO);
    expect(llamadas).toHaveLength(1);
  });
});
