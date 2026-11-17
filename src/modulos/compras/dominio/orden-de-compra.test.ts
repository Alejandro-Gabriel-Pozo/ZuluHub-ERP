import { describe, expect, it } from "vitest";
import { huellaDeLaOrden, leerOrden, leerVinculos } from "./orden-de-compra";

const PROVEEDOR = "00000000-0000-4000-8000-0000000000a1";
const SUCURSAL = "00000000-0000-4000-8000-0000000000b1";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";

const orden = (extra: Record<string, unknown> = {}) => ({
  proveedorId: PROVEEDOR,
  sucursalId: SUCURSAL,
  entrega: "2026-12-01",
  lineas: [{ productoId: P1, cantidad: "10", precio: "12.5" }],
  ...extra,
});

describe("leerOrden", () => {
  it("lee el pedido completo con las cantidades y los precios en forma canónica", () => {
    expect(leerOrden(orden())).toEqual({
      ok: true,
      valor: {
        proveedorId: PROVEEDOR,
        sucursalId: SUCURSAL,
        entrega: "2026-12-01",
        lineas: [{ productoId: P1, cantidad: "10.0000", precio: "12.500000" }],
      },
    });
  });

  it("la sucursal, la entrega y el precio son opcionales (ausentes o null dan null)", () => {
    const r = leerOrden({ proveedorId: PROVEEDOR, lineas: [{ productoId: P1, cantidad: "1" }] });
    expect(r).toEqual({
      ok: true,
      valor: {
        proveedorId: PROVEEDOR,
        sucursalId: null,
        entrega: null,
        lineas: [{ productoId: P1, cantidad: "1.0000", precio: null }],
      },
    });
    expect(
      leerOrden(
        orden({
          sucursalId: null,
          entrega: null,
          lineas: [{ productoId: P1, cantidad: "1", precio: null }],
        }),
      ),
    ).toMatchObject({ ok: true, valor: { sucursalId: null, entrega: null } });
  });

  it("el proveedor y la sucursal tienen que ser identificadores", () => {
    for (const extra of [
      { proveedorId: "x" },
      { proveedorId: 7 },
      { proveedorId: undefined },
      { sucursalId: "x" },
      { sucursalId: 7 },
    ]) {
      expect(leerOrden(orden(extra))).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
    }
    expect(leerOrden(null)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
    expect(leerOrden([])).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
  });

  it("la entrega tiene que ser una fecha civil", () => {
    for (const entrega of ["mañana", "2026-02-30", 20261201, ""]) {
      expect(leerOrden(orden({ entrega }))).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    }
  });

  it("las líneas: no vacías, con tope, sin producto repetido, cantidad positiva y precio positivo si viene", () => {
    const malas: unknown[] = [
      undefined,
      "x",
      [],
      [null],
      [7],
      [{ productoId: "x", cantidad: "1" }],
      [{ productoId: P1 }],
      [{ productoId: P1, cantidad: 1 }],
      [{ productoId: P1, cantidad: "0" }],
      [{ productoId: P1, cantidad: "-1" }],
      [{ productoId: P1, cantidad: "1.00001" }],
      [{ productoId: P1, cantidad: "1", precio: 5 }],
      [{ productoId: P1, cantidad: "1", precio: "0" }],
      [{ productoId: P1, cantidad: "1", precio: "-2" }],
      [
        { productoId: P1, cantidad: "1" },
        { productoId: P1, cantidad: "2" },
      ],
      Array.from({ length: 10_000 }, (_, i) => ({
        productoId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        cantidad: "1",
      })),
    ];
    for (const lineas of malas) {
      expect(leerOrden(orden({ lineas }))).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    }
  });

  it("acepta el tope de líneas", () => {
    const lineas = Array.from({ length: 9_999 }, (_, i) => ({
      productoId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      cantidad: "1",
    }));
    expect(leerOrden(orden({ lineas })).ok).toBe(true);
  });
});

describe("huellaDeLaOrden", () => {
  const leida = (extra: Record<string, unknown> = {}) => {
    const r = leerOrden(orden(extra));
    if (!r.ok) throw new Error("la orden de prueba tiene que ser válida");
    return r.valor;
  };
  const dos = [
    { productoId: P1, cantidad: "1", precio: "2" },
    { productoId: P2, cantidad: "3", precio: null },
  ];

  it("es sha256 en hex, estable y no depende del orden de las líneas", () => {
    const h = huellaDeLaOrden(leida({ lineas: dos }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaOrden(leida({ lineas: [...dos].reverse() }))).toBe(h);
    // Fija el contenido: si cambia, una orden repetida dejaría de reconocerse.
    expect(h).toBe("ebdbf4d48ec3bf4cc6b024dfaf2bab5a2570abf8ca4b03ccc2f4e65ebb0ee420");
  });

  it("cualquier campo distinto da otra huella", () => {
    const base = huellaDeLaOrden(leida());
    const otras = [
      leida({ proveedorId: "00000000-0000-4000-8000-0000000000a2" }),
      leida({ sucursalId: null }),
      leida({ entrega: "2026-12-02" }),
      leida({ entrega: null }),
      leida({ lineas: [{ productoId: P2, cantidad: "10", precio: "12.5" }] }),
      leida({ lineas: [{ productoId: P1, cantidad: "11", precio: "12.5" }] }),
      leida({ lineas: [{ productoId: P1, cantidad: "10", precio: "12.6" }] }),
      leida({ lineas: [{ productoId: P1, cantidad: "10", precio: null }] }),
    ].map(huellaDeLaOrden);
    expect(new Set([base, ...otras]).size).toBe(otras.length + 1);
  });
});

describe("leerVinculos", () => {
  const O = "00000000-0000-4000-8000-0000000000c1";
  const v = (extra: Record<string, unknown> = {}) => ({
    linea: 1,
    ordenId: O,
    lineaDeOrden: 2,
    ...extra,
  });

  it("lee los vínculos con la confirmación en falso por defecto", () => {
    expect(leerVinculos([v(), v({ linea: 2, confirmoExceso: true })], 2)).toEqual({
      ok: true,
      valor: [
        { linea: 1, ordenId: O, lineaDeOrden: 2, confirmoExceso: false },
        { linea: 2, ordenId: O, lineaDeOrden: 2, confirmoExceso: true },
      ],
    });
    expect(leerVinculos([], 1)).toEqual({ ok: true, valor: [] });
  });

  it("rechaza lo que no tiene la forma: lista, objeto, ids, números y confirmación booleana", () => {
    for (const malo of [
      "x",
      null,
      [null],
      [7],
      [v({ ordenId: "x" })],
      [v({ ordenId: 7 })],
      [v({ linea: "1" })],
      [v({ linea: 1.5 })],
      [v({ lineaDeOrden: 0 })],
      [v({ lineaDeOrden: "2" })],
      [v({ confirmoExceso: "si" })],
      Array.from({ length: 10_000 }, (_, i) => v({ linea: i + 1 })),
    ]) {
      expect(leerVinculos(malo, 9_999)).toEqual({ ok: false, error: "VINCULO_INVALIDO" });
    }
  });

  it("cada vínculo apunta a una línea que existe y ninguna se repite", () => {
    expect(leerVinculos([v({ linea: 0 })], 2)).toEqual({ ok: false, error: "LINEA_NO_ENCONTRADA" });
    expect(leerVinculos([v({ linea: 3 })], 2)).toEqual({ ok: false, error: "LINEA_NO_ENCONTRADA" });
    expect(leerVinculos([v(), v()], 2)).toEqual({ ok: false, error: "LINEA_REPETIDA" });
  });

  it("la línea de la orden empieza en 1: la 1 se acepta y la 0 o una negativa no", () => {
    expect(leerVinculos([v({ lineaDeOrden: 1 })], 1)).toEqual({
      ok: true,
      valor: [{ linea: 1, ordenId: O, lineaDeOrden: 1, confirmoExceso: false }],
    });
    for (const lineaDeOrden of [0, -1]) {
      expect(leerVinculos([v({ lineaDeOrden })], 1), String(lineaDeOrden)).toEqual({
        ok: false,
        error: "VINCULO_INVALIDO",
      });
    }
  });

  it("acepta el tope de líneas", () => {
    const lista = Array.from({ length: 9_999 }, (_, i) => v({ linea: i + 1 }));
    expect(leerVinculos(lista, 9_999).ok).toBe(true);
  });
});
