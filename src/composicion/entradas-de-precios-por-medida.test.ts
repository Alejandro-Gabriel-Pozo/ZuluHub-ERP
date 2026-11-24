import { describe, expect, it } from "vitest";
import {
  leerElPedidoDePreciosPorMedida,
  leerLosPreciosDelFormulario,
  nombreDeCampoDePrecio,
} from "./entradas-de-precios-por-medida";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OPCION = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const PEDIDO = {
  productoId: ID,
  claveDelCambio: CLAVE,
  filas: [
    { opcionId: OPCION, precioIdEsperado: null, precio: "3200.00" },
    { opcionId: ID, precioIdEsperado: CLAVE, precio: "" },
  ],
};

describe("leerElPedidoDePreciosPorMedida", () => {
  it("lee todo lo que declara y el precio sigue siendo texto", () => {
    expect(leerElPedidoDePreciosPorMedida(PEDIDO)).toEqual({ ok: true, valor: PEDIDO });
  });

  it("un precio que no vale igual pasa: lo rechaza la primitiva dentro del caso de uso", () => {
    const filas = [{ opcionId: OPCION, precioIdEsperado: null, precio: "abc" }];
    expect(leerElPedidoDePreciosPorMedida({ ...PEDIDO, filas })).toMatchObject({ ok: true });
  });

  it("descarta lo que no declara: la empresa, la sucursal y la persona no se pueden mandar", () => {
    const r = leerElPedidoDePreciosPorMedida({
      ...PEDIDO,
      empresaId: "otra",
      sucursalId: ID,
      filas: [{ ...PEDIDO.filas[0], sucursalId: ID, personaId: "x" }],
    });
    expect(r).toEqual({ ok: true, valor: { ...PEDIDO, filas: [PEDIDO.filas[0]] } });
  });

  it.each([
    ["sin producto", { ...PEDIDO, productoId: undefined }],
    ["producto que no es un id", { ...PEDIDO, productoId: "x" }],
    ["sin clave", { ...PEDIDO, claveDelCambio: undefined }],
    ["clave que no es un id", { ...PEDIDO, claveDelCambio: "1" }],
    ["filas que no es una lista", { ...PEDIDO, filas: {} }],
    ["fila sin medida", { ...PEDIDO, filas: [{ precioIdEsperado: null, precio: "1" }] }],
    ["medida que no es un id", { ...PEDIDO, filas: [{ ...PEDIDO.filas[0], opcionId: "x" }] }],
    [
      "fila vista que no es un id",
      { ...PEDIDO, filas: [{ ...PEDIDO.filas[0], precioIdEsperado: "x" }] },
    ],
    ["fila vista ausente", { ...PEDIDO, filas: [{ opcionId: OPCION, precio: "1" }] }],
    ["precio que no es texto", { ...PEDIDO, filas: [{ ...PEDIDO.filas[0], precio: 5 }] }],
    ["precio sin fin", { ...PEDIDO, filas: [{ ...PEDIDO.filas[0], precio: "1".repeat(41) }] }],
    ["nada", null],
  ])("%s: PEDIDO_INVALIDO", (_caso, pedido) => {
    expect(leerElPedidoDePreciosPorMedida(pedido)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("100 medidas todavía es la forma pedida y 101 no; 40 caracteres de precio también", () => {
    const filas = (n: number) =>
      Array.from({ length: n }, () => ({ opcionId: OPCION, precioIdEsperado: null, precio: "1" }));
    expect(leerElPedidoDePreciosPorMedida({ ...PEDIDO, filas: filas(100) })).toMatchObject({
      ok: true,
    });
    expect(leerElPedidoDePreciosPorMedida({ ...PEDIDO, filas: filas(101) })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(
      leerElPedidoDePreciosPorMedida({
        ...PEDIDO,
        filas: [{ opcionId: OPCION, precioIdEsperado: null, precio: "1".repeat(40) }],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("leerLosPreciosDelFormulario", () => {
  it("arma un precio por posición, con vacío para lo que no vino", () => {
    expect(
      leerLosPreciosDelFormulario(
        [
          ["precio_2", "30.00"],
          ["precio_0", "10.00"],
        ],
        3,
      ),
    ).toEqual(["10.00", "", "30.00"]);
  });

  it("lo que no es un campo de precio, no es texto, o apunta más allá de lo ligado no se lee; la primera aparición manda", () => {
    expect(
      leerLosPreciosDelFormulario(
        [
          ["precio", "1"],
          ["xprecio_0", "2"],
          ["precio_0x", "3"],
          ["precio_1234", "4"],
          ["precio_2", "justo la cantidad"],
          ["precio_5", "5"],
          ["precio_1", new Blob(["x"])],
          ["precio_0", "primero"],
          ["precio_0", "segundo"],
        ],
        2,
      ),
    ).toEqual(["primero", ""]);
  });

  it("acepta posiciones de hasta tres dígitos y cero medidas", () => {
    const campos: [string, string][] = [["precio_123", "9.00"]];
    expect(leerLosPreciosDelFormulario(campos, 124)[123]).toBe("9.00");
    expect(leerLosPreciosDelFormulario(campos, 0)).toEqual([]);
  });
});

describe("nombreDeCampoDePrecio", () => {
  it("es precio_<posición>", () => {
    expect(nombreDeCampoDePrecio(0)).toBe("precio_0");
    expect(nombreDeCampoDePrecio(12)).toBe("precio_12");
  });
});
