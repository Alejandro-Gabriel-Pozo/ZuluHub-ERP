import { describe, expect, it } from "vitest";
import { huellaDeComando } from "./huella";
import {
  claveDeLaAnulacionDeLaConciliacion,
  claveDeLaAnulacionDeLaEntrada,
  claveDeLaConciliacionDeAtajo,
  claveDeLaEntradaDeStock,
  elegirDepositoDeLaCompra,
  huellaDeLaCompra,
  leerRemito,
  motivoDeAnulacionDesdeTexto,
  leerRenglonesDeCompra,
  MAXIMO_DE_RENGLONES_DE_UNA_COMPRA,
  origenDeLaEntradaDeStock,
  type PedidoDeCompra,
  type RenglonDeCompra,
} from "./registrar-compra";

const P1 = "0b0c3a62-4f6e-4a53-9a43-0d3cde7a90aa";
const P2 = "1b0c3a62-4f6e-4a53-9a43-0d3cde7a90bb";

const renglon = (extra: Record<string, unknown> = {}) => ({
  productoId: P1,
  presentacionId: null,
  unidadDeCompraId: "KILOGRAMO",
  cantidad: "2",
  pesoReal: null,
  precioPor: "UNIDAD",
  unidadDePrecioId: "KILOGRAMO",
  precio: "100",
  ...extra,
});

describe("leerRenglonesDeCompra", () => {
  it("lee un renglón completo y completa lo opcional con null", () => {
    expect(leerRenglonesDeCompra([renglon()])).toEqual({
      ok: true,
      valor: [renglon()],
    });
    const minimo = leerRenglonesDeCompra([
      { productoId: P1, unidadDeCompraId: "UNIDAD", cantidad: "1", precioPor: "PRESENTACION" },
    ]);
    expect(minimo).toEqual({
      ok: true,
      valor: [
        {
          productoId: P1,
          presentacionId: null,
          unidadDeCompraId: "UNIDAD",
          cantidad: "1",
          pesoReal: null,
          precioPor: "PRESENTACION",
          unidadDePrecioId: null,
          precio: null,
        },
      ],
    });
  });

  it("conserva la presentación, el peso real y el precio cuando vienen", () => {
    const r = leerRenglonesDeCompra([
      renglon({
        presentacionId: P2,
        pesoReal: "3.5",
        precio: "10.5",
        precioPor: "PRESENTACION",
        unidadDePrecioId: null,
      }),
    ]);
    expect(r.ok && r.valor[0]).toMatchObject({
      presentacionId: P2,
      pesoReal: "3.5",
      precio: "10.5",
      precioPor: "PRESENTACION",
    });
  });

  it("rechaza lo que no es una lista de 1 a 9999 renglones", () => {
    for (const valor of [
      undefined,
      null,
      {},
      "x",
      [],
      new Array(MAXIMO_DE_RENGLONES_DE_UNA_COMPRA + 1).fill(renglon()),
    ]) {
      expect(leerRenglonesDeCompra(valor)).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    }
    expect(
      leerRenglonesDeCompra(new Array(MAXIMO_DE_RENGLONES_DE_UNA_COMPRA).fill(renglon())).ok,
    ).toBe(true);
  });

  it("rechaza un renglón con cualquier campo de forma inválida (lista de permitidos)", () => {
    const malos: Record<string, unknown>[] = [
      { productoId: "no-uuid" },
      { productoId: 1 },
      { productoId: undefined },
      { presentacionId: "no-uuid" },
      { presentacionId: 5 },
      { unidadDeCompraId: "METRO_LINEAL" },
      { unidadDeCompraId: undefined },
      { unidadDeCompraId: "toString" },
      { cantidad: 2 },
      { cantidad: undefined },
      { pesoReal: 3 },
      { precio: 100 },
      { precioPor: "CAJA" },
      { precioPor: undefined },
      { unidadDePrecioId: "NADA" },
      { unidadDePrecioId: 3 },
    ];
    for (const mal of malos) {
      expect(leerRenglonesDeCompra([renglon(mal)])).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
    for (const crudo of [null, 3, "x", [], undefined]) {
      expect(leerRenglonesDeCompra([crudo])).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    }
  });

  it("no acepta un objeto con `toString` que parezca un texto válido (solo textos de verdad)", () => {
    const engano = (texto: string) => ({ toString: () => texto });
    for (const mal of [
      { productoId: engano(P1) },
      { presentacionId: engano(P2) },
      { unidadDeCompraId: engano("KILOGRAMO") },
      { unidadDePrecioId: engano("KILOGRAMO") },
      { cantidad: engano("2") },
    ]) {
      expect(leerRenglonesDeCompra([renglon(mal)])).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
  });

  it("un renglón malo entre buenos rechaza toda la lista", () => {
    expect(leerRenglonesDeCompra([renglon(), renglon({ cantidad: 1 }), renglon()]).ok).toBe(false);
  });
});

describe("leerRemito", () => {
  it("lee un remito válido", () => {
    expect(leerRemito({ puntoDeVenta: 4, numero: 123, fecha: "2026-11-10" })).toEqual({
      ok: true,
      valor: { puntoDeVenta: 4, numero: 123, fecha: "2026-11-10" },
    });
  });
  it("rechaza el punto de venta fuera de 1 a 99998, no entero o no numérico", () => {
    for (const puntoDeVenta of [0, 99999, 1.5, "4", null, undefined, Number.NaN]) {
      expect(leerRemito({ puntoDeVenta, numero: 1, fecha: "2026-11-10" })).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_INVALIDO",
      });
    }
    expect(leerRemito({ puntoDeVenta: 99998, numero: 1, fecha: "2026-11-10" }).ok).toBe(true);
  });
  it("rechaza el número fuera de 1 a 99999999, no entero o no numérico", () => {
    for (const numero of [0, 100000000, 2.5, "1", null, undefined]) {
      expect(leerRemito({ puntoDeVenta: 1, numero, fecha: "2026-11-10" })).toEqual({
        ok: false,
        error: "NUMERO_DE_COMPROBANTE_INVALIDO",
      });
    }
    expect(leerRemito({ puntoDeVenta: 1, numero: 99999999, fecha: "2026-11-10" }).ok).toBe(true);
  });
  it("rechaza una fecha que no es una fecha civil", () => {
    for (const fecha of [
      "2026-02-30",
      "10/11/2026",
      "",
      20261110,
      null,
      undefined,
      "2026-11-10T00:00:00Z",
    ]) {
      expect(leerRemito({ puntoDeVenta: 1, numero: 1, fecha })).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
  });
  it("no acepta números ni fechas disfrazados de otro tipo", () => {
    const engano = (texto: string) => ({ toString: () => texto, valueOf: () => Number(texto) });
    expect(leerRemito({ puntoDeVenta: engano("4"), numero: 1, fecha: "2026-11-10" })).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_INVALIDO",
    });
    expect(leerRemito({ puntoDeVenta: 1, numero: engano("4"), fecha: "2026-11-10" })).toEqual({
      ok: false,
      error: "NUMERO_DE_COMPROBANTE_INVALIDO",
    });
    expect(leerRemito({ puntoDeVenta: 1, numero: 1, fecha: engano("2026-11-10") })).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
  });
  it("rechaza lo que no es un objeto", () => {
    for (const valor of [null, undefined, 3, "x", []]) {
      expect(leerRemito(valor)).toEqual({ ok: false, error: "PUNTO_DE_VENTA_INVALIDO" });
    }
  });
});

describe("elegirDepositoDeLaCompra", () => {
  it("sin elegir, usa el único depósito; con varios hay que elegir; sin ninguno no hay", () => {
    expect(elegirDepositoDeLaCompra(["a"], null)).toEqual({ ok: true, valor: "a" });
    expect(elegirDepositoDeLaCompra(["a", "b"], null)).toEqual({
      ok: false,
      error: "DEPOSITO_A_ELEGIR",
    });
    expect(elegirDepositoDeLaCompra([], null)).toEqual({
      ok: false,
      error: "DEPOSITO_NO_ENCONTRADO",
    });
  });
  it("el elegido tiene que ser uno de los candidatos", () => {
    expect(elegirDepositoDeLaCompra(["a", "b"], "b")).toEqual({ ok: true, valor: "b" });
    expect(elegirDepositoDeLaCompra(["a", "b"], "c")).toEqual({
      ok: false,
      error: "DEPOSITO_NO_ENCONTRADO",
    });
    expect(elegirDepositoDeLaCompra([], "a")).toEqual({
      ok: false,
      error: "DEPOSITO_NO_ENCONTRADO",
    });
  });
});

describe("huellaDeLaCompra", () => {
  const r1 = leerRenglonesDeCompra([renglon()]);
  const r2 = leerRenglonesDeCompra([renglon({ productoId: P2, cantidad: "5" })]);
  if (!r1.ok || !r2.ok) throw new Error("renglones de prueba inválidos");
  const base: PedidoDeCompra = {
    sucursalId: "s1",
    proveedorId: "p1",
    depositoId: null,
    hechoEn: null,
    remito: null,
    renglones: [...r1.valor, ...r2.valor],
    factura: null,
    pago: null,
  };

  it("es un sha256 hexadecimal y es estable", () => {
    expect(huellaDeLaCompra(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaCompra(base)).toBe(huellaDeLaCompra({ ...base }));
  });
  it("el orden de los renglones no cambia la huella", () => {
    expect(huellaDeLaCompra({ ...base, renglones: [...base.renglones].reverse() })).toBe(
      huellaDeLaCompra(base),
    );
  });
  it("la huella es la del contenido canónico (operación, cabecera con el remito en su lugar, factura y pago, y renglones)", () => {
    const [uno, dos] = base.renglones as readonly [RenglonDeCompra, RenglonDeCompra];
    const fila = (r: RenglonDeCompra) => [
      r.productoId,
      r.presentacionId,
      r.unidadDeCompraId,
      r.cantidad,
      r.pesoReal,
      r.precioPor,
      r.unidadDePrecioId,
      r.precio,
    ];
    expect(huellaDeLaCompra(base)).toBe(
      huellaDeComando(
        "registrar_compra",
        ["s1", "p1", null, null, null, null, null, null, null],
        [fila(uno), fila(dos)],
      ),
    );
    expect(
      huellaDeLaCompra({
        ...base,
        depositoId: "d1",
        hechoEn: "2026-11-10T10:00:00.000Z",
        remito: { puntoDeVenta: 3, numero: 4, fecha: "2026-11-09" },
        factura: ["F", 1],
        pago: ["P"],
      }),
    ).toBe(
      huellaDeComando(
        "registrar_compra",
        ["s1", "p1", "d1", "2026-11-10T10:00:00.000Z", 3, 4, "2026-11-09", '["F",1]', '["P"]'],
        [fila(uno), fila(dos)],
      ),
    );
  });
  it("cada campo del pedido cambia la huella", () => {
    const h = huellaDeLaCompra(base);
    const otros: PedidoDeCompra[] = [
      { ...base, sucursalId: "s2" },
      { ...base, proveedorId: "p2" },
      { ...base, depositoId: "d1" },
      { ...base, hechoEn: "2026-11-10T10:00:00.000Z" },
      { ...base, remito: { puntoDeVenta: 1, numero: 2, fecha: "2026-11-10" } },
      { ...base, factura: ["FACTURA_A"] },
      { ...base, pago: ["EFECTIVO"] },
      { ...base, renglones: [...base.renglones].slice(0, 1) },
    ];
    for (const o of otros) expect(huellaDeLaCompra(o)).not.toBe(h);
    const unRenglon = (cambio: Partial<RenglonDeCompra>): PedidoDeCompra => ({
      ...base,
      renglones: [
        { ...(base.renglones[0] as RenglonDeCompra), ...cambio },
        base.renglones[1] as RenglonDeCompra,
      ],
    });
    for (const cambio of [
      { productoId: P2 },
      { presentacionId: P2 },
      { unidadDeCompraId: "GRAMO" as const },
      { cantidad: "3" },
      { pesoReal: "1" },
      { precioPor: "PRESENTACION" as const },
      { unidadDePrecioId: "GRAMO" as const },
      { precio: "101" },
    ]) {
      expect(huellaDeLaCompra(unRenglon(cambio))).not.toBe(h);
    }
  });
  it("cada campo del remito cambia la huella", () => {
    const con = (puntoDeVenta: number, numero: number, fecha: string) =>
      huellaDeLaCompra({ ...base, remito: { puntoDeVenta, numero, fecha } });
    const h = con(1, 2, "2026-11-10");
    expect(con(2, 2, "2026-11-10")).not.toBe(h);
    expect(con(1, 3, "2026-11-10")).not.toBe(h);
    expect(con(1, 2, "2026-11-11")).not.toBe(h);
  });
  it("una factura y un pago distintos dan huellas distintas, y su orden interno cuenta", () => {
    const f = (campos: readonly (string | number | null)[]) =>
      huellaDeLaCompra({ ...base, factura: campos });
    expect(f(["A", 1])).not.toBe(f(["A", 2]));
    expect(f(["A", 1])).not.toBe(f([1, "A"]));
    expect(huellaDeLaCompra({ ...base, factura: ["x"], pago: null })).not.toBe(
      huellaDeLaCompra({ ...base, factura: null, pago: ["x"] }),
    );
  });
});

describe("los identificadores de la entrada de stock", () => {
  const R = "11111111-1111-4111-8111-111111111111";
  const D = "22222222-2222-4222-8222-222222222222";
  const OTRO = "33333333-3333-4333-8333-333333333333";

  it("son los de siempre (valores fijos: cambiar un espacio de nombres reescribiría el origen de lo ya guardado)", () => {
    expect(origenDeLaEntradaDeStock(R, D)).toBe("0f43f1b5-e628-579b-bced-a03d3f07470b");
    expect(claveDeLaEntradaDeStock(R, D)).toBe("1c82184d-c497-5709-bcea-7b3aa81c5341");
    expect(claveDeLaAnulacionDeLaEntrada(R, D)).toBe("6ccf848d-3547-50cb-95b7-169b7e21658c");
  });
  it("las de la conciliación también son fijas y distintas entre sí", () => {
    expect(claveDeLaConciliacionDeAtajo(R)).toBe("958e1211-0e72-5699-b800-7b9f152e7fe9");
    expect(claveDeLaAnulacionDeLaConciliacion(R)).toBe("8fdda9b0-817d-5f55-af1f-9d6eb0044ac2");
    expect(claveDeLaConciliacionDeAtajo(R)).not.toBe(claveDeLaConciliacionDeAtajo(D));
    expect(claveDeLaAnulacionDeLaConciliacion(R)).not.toBe(claveDeLaAnulacionDeLaConciliacion(D));
  });
  it("cambian con la recepción y con el depósito, y no se confunden entre sí", () => {
    for (const f of [
      origenDeLaEntradaDeStock,
      claveDeLaEntradaDeStock,
      claveDeLaAnulacionDeLaEntrada,
    ]) {
      expect(f(R, D)).toBe(f(R, D));
      expect(f(R, D)).not.toBe(f(OTRO, D));
      expect(f(R, D)).not.toBe(f(R, OTRO));
      expect(f(R, D)).not.toBe(f(D, R));
    }
  });
});

describe("motivoDeAnulacionDesdeTexto", () => {
  it("acepta un motivo de una línea de hasta 500 caracteres", () => {
    expect(motivoDeAnulacionDesdeTexto("Se cargó dos veces")).toEqual({
      ok: true,
      valor: "Se cargó dos veces",
    });
    expect(motivoDeAnulacionDesdeTexto("a".repeat(500)).ok).toBe(true);
  });
  it("rechaza vacío, sin letras, con saltos de línea, de más de 500 y lo que no es texto", () => {
    for (const t of ["", "   ", "123", "a\nb", "a".repeat(501), 5, null, undefined, {}]) {
      expect(motivoDeAnulacionDesdeTexto(t)).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    }
  });
});
