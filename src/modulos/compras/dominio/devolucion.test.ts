import { describe, expect, it } from "vitest";
import {
  claveDeLaSalidaDeDevolucion,
  huellaDeLaDevolucion,
  leerDevolucion,
  LARGO_MAXIMO_DEL_REMITO_DE_DEVOLUCION,
} from "./devolucion";

const SUCURSAL = "00000000-0000-4000-8000-0000000000b1";
const PROVEEDOR = "00000000-0000-4000-8000-0000000000a1";
const DEPOSITO = "00000000-0000-4000-8000-0000000000d1";
const MOTIVO = "00000000-0000-4000-8000-0000000000e1";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const RECEPCION = "00000000-0000-4000-8000-0000000000c1";

const pedido = (extra: Record<string, unknown> = {}) => ({
  sucursalId: SUCURSAL,
  proveedorId: PROVEEDOR,
  depositoId: DEPOSITO,
  motivoId: MOTIVO,
  lineas: [{ productoId: P1, cantidad: "2.5" }],
  ...extra,
});

describe("leerDevolucion", () => {
  it("lee el pedido completo con la cantidad en forma canónica; remito y origen son opcionales", () => {
    expect(leerDevolucion(pedido())).toEqual({
      ok: true,
      valor: {
        sucursalId: SUCURSAL,
        proveedorId: PROVEEDOR,
        depositoId: DEPOSITO,
        motivoId: MOTIVO,
        remito: null,
        lineas: [{ productoId: P1, cantidad: "2.5000", origen: null }],
      },
    });
    const completo = leerDevolucion(
      pedido({
        remito: { numero: "  0001-00000012 ", fecha: "2026-11-10" },
        lineas: [
          { productoId: P1, cantidad: "1", recepcionId: RECEPCION, lineaDeRecepcion: 2 },
          { productoId: P2, cantidad: "3", recepcionId: null, lineaDeRecepcion: null },
        ],
      }),
    );
    expect(completo).toEqual({
      ok: true,
      valor: {
        sucursalId: SUCURSAL,
        proveedorId: PROVEEDOR,
        depositoId: DEPOSITO,
        motivoId: MOTIVO,
        remito: { numero: "0001-00000012", fecha: "2026-11-10" },
        lineas: [
          {
            productoId: P1,
            cantidad: "1.0000",
            origen: { recepcionId: RECEPCION, lineaDeRecepcion: 2 },
          },
          { productoId: P2, cantidad: "3.0000", origen: null },
        ],
      },
    });
    expect(leerDevolucion(pedido({ remito: null }))).toMatchObject({ ok: true });
  });

  it("los cuatro ids tienen que ser uuid", () => {
    for (const campo of ["sucursalId", "proveedorId", "depositoId", "motivoId"]) {
      for (const malo of ["x", 5, null, undefined]) {
        expect(leerDevolucion(pedido({ [campo]: malo })), `${campo}=${String(malo)}`).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      }
    }
    expect(leerDevolucion(null)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
    expect(leerDevolucion([])).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
  });

  it("el remito: número de hasta 40 caracteres y fecha civil, los dos o error", () => {
    const con = (remito: unknown) => leerDevolucion(pedido({ remito }));
    expect(LARGO_MAXIMO_DEL_REMITO_DE_DEVOLUCION).toBe(40);
    expect(con({ numero: "A".repeat(40), fecha: "2026-11-10" })).toMatchObject({ ok: true });
    for (const numero of ["A".repeat(41), "", "   ", 12, null, "<x>"]) {
      expect(con({ numero, fecha: "2026-11-10" }), String(numero)).toEqual({
        ok: false,
        error: "NUMERO_DE_COMPROBANTE_INVALIDO",
      });
    }
    expect(con("0001")).toEqual({ ok: false, error: "NUMERO_DE_COMPROBANTE_INVALIDO" });
    for (const fecha of ["2026-02-30", "mañana", 20261110, null, undefined]) {
      expect(con({ numero: "1", fecha }), String(fecha)).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
  });

  it("las líneas: no vacía, con tope, sin repetir producto y cada una con cantidad positiva", () => {
    const con = (lineas: unknown) => leerDevolucion(pedido({ lineas }));
    const mal = { ok: false, error: "RENGLONES_INVALIDOS" };
    expect(con([])).toEqual(mal);
    expect(con("x")).toEqual(mal);
    expect(con(undefined)).toEqual(mal);
    expect(con(Array.from({ length: 10_000 }, () => ({ productoId: P1, cantidad: "1" })))).toEqual(
      mal,
    );
    expect(
      con([
        { productoId: P1, cantidad: "1" },
        { productoId: P1, cantidad: "2" },
      ]),
    ).toEqual(mal);
    for (const cantidad of ["0", "-1", "1.00001", "abc", 5, null, undefined]) {
      expect(con([{ productoId: P1, cantidad }]), String(cantidad)).toEqual(mal);
    }
    expect(con([{ productoId: "x", cantidad: "1" }])).toEqual(mal);
    expect(con([5])).toEqual(mal);
    expect(
      con([
        { productoId: P1, cantidad: "1" },
        { productoId: P2, cantidad: "1" },
      ]),
    ).toMatchObject({ ok: true });
  });

  it("la línea recibida de origen se dice completa: recepción uuid y línea entera desde 1, o nada", () => {
    const con = (extra: Record<string, unknown>) =>
      leerDevolucion(pedido({ lineas: [{ productoId: P1, cantidad: "1", ...extra }] }));
    const mal = { ok: false, error: "RENGLONES_INVALIDOS" };
    expect(con({ recepcionId: RECEPCION })).toEqual(mal);
    expect(con({ lineaDeRecepcion: 1 })).toEqual(mal);
    expect(con({ recepcionId: "x", lineaDeRecepcion: 1 })).toEqual(mal);
    expect(con({ recepcionId: RECEPCION, lineaDeRecepcion: 0 })).toEqual(mal);
    expect(con({ recepcionId: RECEPCION, lineaDeRecepcion: 1.5 })).toEqual(mal);
    expect(con({ recepcionId: RECEPCION, lineaDeRecepcion: "1" })).toEqual(mal);
    expect(con({ recepcionId: RECEPCION, lineaDeRecepcion: 1 })).toMatchObject({ ok: true });
  });
});

describe("huellaDeLaDevolucion", () => {
  const leida = (extra: Record<string, unknown> = {}) => {
    const r = leerDevolucion(pedido(extra));
    if (!r.ok) throw new Error("pedido de prueba inválido");
    return r.valor;
  };
  const base = huellaDeLaDevolucion(leida(), null);

  it("es un sha256 estable y las líneas en otro orden son el mismo pedido", () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaDevolucion(leida(), null)).toBe(base);
    const a = { productoId: P1, cantidad: "1" };
    const b = { productoId: P2, cantidad: "2" };
    expect(huellaDeLaDevolucion(leida({ lineas: [a, b] }), null)).toBe(
      huellaDeLaDevolucion(leida({ lineas: [b, a] }), null),
    );
  });

  it("cualquier campo distinto da otra huella", () => {
    const otras = [
      huellaDeLaDevolucion(leida({ sucursalId: P2 }), null),
      huellaDeLaDevolucion(leida({ proveedorId: P2 }), null),
      huellaDeLaDevolucion(leida({ depositoId: P2 }), null),
      huellaDeLaDevolucion(leida({ motivoId: P2 }), null),
      huellaDeLaDevolucion(leida({ remito: { numero: "1", fecha: "2026-11-10" } }), null),
      huellaDeLaDevolucion(
        leida({ remito: { numero: "1", fecha: "2026-11-10" } }),
        "2026-11-10T10:00:00.000Z",
      ),
      huellaDeLaDevolucion(leida({ remito: { numero: "2", fecha: "2026-11-10" } }), null),
      huellaDeLaDevolucion(leida({ remito: { numero: "1", fecha: "2026-11-11" } }), null),
      huellaDeLaDevolucion(leida(), "2026-11-10T10:00:00.000Z"),
      huellaDeLaDevolucion(leida({ lineas: [{ productoId: P2, cantidad: "2.5" }] }), null),
      huellaDeLaDevolucion(leida({ lineas: [{ productoId: P1, cantidad: "3" }] }), null),
      huellaDeLaDevolucion(
        leida({
          lineas: [
            { productoId: P1, cantidad: "2.5", recepcionId: RECEPCION, lineaDeRecepcion: 1 },
          ],
        }),
        null,
      ),
      huellaDeLaDevolucion(
        leida({
          lineas: [
            { productoId: P1, cantidad: "2.5", recepcionId: RECEPCION, lineaDeRecepcion: 2 },
          ],
        }),
        null,
      ),
    ];
    expect(new Set([base, ...otras]).size).toBe(otras.length + 1);
    // Y las dos con origen (línea 1 y 2) entre sí.
    expect(otras.at(-1)).not.toBe(otras.at(-2));
  });
});

describe("claveDeLaSalidaDeDevolucion", () => {
  it("es un uuid determinista de la devolución", () => {
    const clave = claveDeLaSalidaDeDevolucion(P1);
    expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(claveDeLaSalidaDeDevolucion(P1)).toBe(clave);
    expect(claveDeLaSalidaDeDevolucion(P2)).not.toBe(clave);
  });
});
