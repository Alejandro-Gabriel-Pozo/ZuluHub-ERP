import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeConsumo,
  leerLasLineasDeConsumo,
  nombreDeCampoDeConsumo,
} from "./entradas-de-consumo";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const GRUPO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OPCION = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const INSUMO = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const PEDIDO = {
  productoId: ID,
  grupoId: GRUPO,
  versionDeOpciones: 4,
  opciones: [
    { opcionId: OPCION, lineas: [{ insumoId: INSUMO, cantidad: "150", escalaConTamano: true }] },
  ],
};

describe("leerElPedidoDeConsumo", () => {
  it("lee todo lo que declara y la cantidad sigue siendo texto", () => {
    expect(leerElPedidoDeConsumo(PEDIDO)).toEqual({ ok: true, valor: PEDIDO });
  });

  it("una opción sin líneas tiene la forma pedida (se queda sin consumo); una cantidad rara pasa: la rechaza el dominio", () => {
    expect(
      leerElPedidoDeConsumo({ ...PEDIDO, opciones: [{ opcionId: OPCION, lineas: [] }] }),
    ).toMatchObject({ ok: true });
    const lineas = [{ insumoId: INSUMO, cantidad: "abc", escalaConTamano: false }];
    expect(
      leerElPedidoDeConsumo({ ...PEDIDO, opciones: [{ opcionId: OPCION, lineas }] }),
    ).toMatchObject({ ok: true });
  });

  it("descarta lo que no declara: la empresa, la persona y el costo no se pueden mandar", () => {
    const r = leerElPedidoDeConsumo({
      ...PEDIDO,
      empresaId: "otra",
      opciones: [
        { opcionId: OPCION, orden: 3, lineas: [{ ...PEDIDO.opciones[0]?.lineas[0], costo: "1" }] },
      ],
    });
    expect(r).toEqual({ ok: true, valor: PEDIDO });
  });

  it.each([
    ["sin producto", { ...PEDIDO, productoId: undefined }],
    ["producto que no es un id", { ...PEDIDO, productoId: "x" }],
    ["sin grupo", { ...PEDIDO, grupoId: undefined }],
    ["grupo que no es un id", { ...PEDIDO, grupoId: "x" }],
    ["versión negativa", { ...PEDIDO, versionDeOpciones: -1 }],
    ["opciones que no es una lista", { ...PEDIDO, opciones: {} }],
    ["opción que no es un id", { ...PEDIDO, opciones: [{ opcionId: "x", lineas: [] }] }],
    ["opción sin líneas", { ...PEDIDO, opciones: [{ opcionId: OPCION }] }],
    [
      "insumo que no es un id",
      {
        ...PEDIDO,
        opciones: [
          { opcionId: OPCION, lineas: [{ insumoId: "x", cantidad: "1", escalaConTamano: false }] },
        ],
      },
    ],
    [
      "cantidad que no es texto",
      {
        ...PEDIDO,
        opciones: [
          { opcionId: OPCION, lineas: [{ insumoId: INSUMO, cantidad: 1, escalaConTamano: false }] },
        ],
      },
    ],
    [
      "cantidad sin fin",
      {
        ...PEDIDO,
        opciones: [
          {
            opcionId: OPCION,
            lineas: [{ insumoId: INSUMO, cantidad: "1".repeat(41), escalaConTamano: false }],
          },
        ],
      },
    ],
    [
      "escala que no es sí o no",
      {
        ...PEDIDO,
        opciones: [
          {
            opcionId: OPCION,
            lineas: [{ insumoId: INSUMO, cantidad: "1", escalaConTamano: "on" }],
          },
        ],
      },
    ],
    ["nada", null],
  ])("%s: PEDIDO_INVALIDO", (_caso, pedido) => {
    expect(leerElPedidoDeConsumo(pedido)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("100 opciones y 50 líneas todavía es la forma pedida; 101 y 51 no; 40 caracteres de cantidad también", () => {
    const linea = { insumoId: INSUMO, cantidad: "1", escalaConTamano: false };
    const opciones = (n: number) =>
      Array.from({ length: n }, () => ({ opcionId: OPCION, lineas: [] }));
    const lineas = (n: number) => [
      { opcionId: OPCION, lineas: Array.from({ length: n }, () => linea) },
    ];
    expect(leerElPedidoDeConsumo({ ...PEDIDO, opciones: opciones(100) })).toMatchObject({
      ok: true,
    });
    expect(leerElPedidoDeConsumo({ ...PEDIDO, opciones: opciones(101) })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(leerElPedidoDeConsumo({ ...PEDIDO, opciones: lineas(50) })).toMatchObject({ ok: true });
    expect(leerElPedidoDeConsumo({ ...PEDIDO, opciones: lineas(51) })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(
      leerElPedidoDeConsumo({
        ...PEDIDO,
        opciones: [{ opcionId: OPCION, lineas: [{ ...linea, cantidad: "1".repeat(40) }] }],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("nombreDeCampoDeConsumo", () => {
  it("es consumo_<opción>_<línea>_<campo>", () => {
    expect(nombreDeCampoDeConsumo(2, "l5", "cantidad")).toBe("consumo_2_l5_cantidad");
    expect(nombreDeCampoDeConsumo(0, "l0", "escala")).toBe("consumo_0_l0_escala");
  });
});

describe("leerLasLineasDeConsumo", () => {
  it("arma las líneas por opción, en el orden del formulario; la escala es verdadera solo si vino marcada", () => {
    expect(
      leerLasLineasDeConsumo(
        [
          ["consumo_1_l2_insumo", "B"],
          ["consumo_1_l2_cantidad", "2"],
          ["consumo_0_l0_insumo", "A"],
          ["consumo_0_l0_cantidad", "1.5"],
          ["consumo_0_l0_escala", "on"],
          ["consumo_0_l1_insumo", "C"],
          ["consumo_0_l1_cantidad", "3"],
        ],
        2,
      ),
    ).toEqual([
      [
        { insumoId: "A", cantidad: "1.5", escalaConTamano: true },
        { insumoId: "C", cantidad: "3", escalaConTamano: false },
      ],
      [{ insumoId: "B", cantidad: "2", escalaConTamano: false }],
    ]);
  });

  it("una línea sin insumo, o con insumo vacío, no existe; sin cantidad trae el texto vacío", () => {
    expect(
      leerLasLineasDeConsumo(
        [
          ["consumo_0_l0_cantidad", "5"],
          ["consumo_0_l1_insumo", ""],
          ["consumo_0_l1_cantidad", "5"],
          ["consumo_0_l2_insumo", "A"],
        ],
        1,
      ),
    ).toEqual([[{ insumoId: "A", cantidad: "", escalaConTamano: false }]]);
  });

  it("lo que no es un campo de consumo, no es texto o apunta a una opción que no se ligó no se lee", () => {
    expect(
      leerLasLineasDeConsumo(
        [
          ["nombre", "x"],
          ["consumo_5_l0_insumo", "fuera"],
          ["consumo_1_l0_insumo", "fuera"],
          ["consumo_0_x0_insumo", "mal"],
          ["consumo_0_l1234_insumo", "mal"],
          ["consumo_1234_l0_insumo", "mal"],
          ["consumo_0_l0_orden", "mal"],
          ["xconsumo_0_l0_insumo", "mal"],
          ["consumo_0_l0_insumo_x", "mal"],
          ["consumo_0_l0_insumo", new Blob(["x"])],
          ["consumo_0_l9_insumo", "Bien"],
        ],
        1,
      ),
    ).toEqual([[{ insumoId: "Bien", cantidad: "", escalaConTamano: false }]]);
  });

  it("una línea repetida conserva el primer valor de cada campo; una escala que no es «on» es falsa", () => {
    expect(
      leerLasLineasDeConsumo(
        [
          ["consumo_0_l0_insumo", "A"],
          ["consumo_0_l0_insumo", "B"],
          ["consumo_0_l0_cantidad", "1"],
          ["consumo_0_l0_cantidad", "2"],
          ["consumo_0_l0_escala", "no"],
          ["consumo_0_l0_escala", "on"],
        ],
        1,
      ),
    ).toEqual([[{ insumoId: "A", cantidad: "1", escalaConTamano: false }]]);
  });

  it("acepta posiciones y claves de hasta tres dígitos, y sin opciones no hay nada", () => {
    const campos: [string, string][] = [["consumo_123_l123_insumo", "A"]];
    expect(leerLasLineasDeConsumo(campos, 124)[123]).toEqual([
      { insumoId: "A", cantidad: "", escalaConTamano: false },
    ]);
    expect(leerLasLineasDeConsumo(campos, 0)).toEqual([]);
  });
});
