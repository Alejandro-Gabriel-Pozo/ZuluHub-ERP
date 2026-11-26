import { describe, expect, it } from "vitest";
import {
  FACTURA_VACIA,
  type FacturaEscrita,
} from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-factura";
import type { RenglonEscrito } from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-nueva-compra";
import {
  SIN_ACCIONES_DEL_REEMPLAZO,
  armarElPedidoDeReemplazo,
  importeDifiere,
  motivoDelReemplazo,
  numeroParaElMotivo,
  pasosPrevios,
  renglonesDeLaCompra,
  type FrenoParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/reemplazo/modelo-de-reemplazo";

const FACTURA = "0b0b0b0b-1111-4222-8333-444444444444";
const COMPRA = "0c0c0c0c-1111-4222-8333-444444444444";
const TODO = { anularPago: true, anularConciliacion: true, verNotas: true };
const FRENOS: readonly FrenoParaLaPantalla[] = [
  { freno: "PAGO_VIGENTE", pagoId: "p1" },
  { freno: "CONCILIACIONES_VIVAS" },
  { freno: "NOTAS_VIGENTES" },
];

describe("pasosPrevios", () => {
  it("respeta el orden del servidor y lleva cada paso a la pantalla que lo resuelve, con el permiso de ese paso", () => {
    expect(pasosPrevios(FRENOS, { facturaId: FACTURA, recepcionId: COMPRA }, TODO)).toEqual([
      { freno: "PAGO_VIGENTE", ruta: `/compras/${COMPRA}` },
      { freno: "CONCILIACIONES_VIVAS", ruta: `/compras/facturas/${FACTURA}/conciliar` },
      { freno: "NOTAS_VIGENTES", ruta: `/compras/facturas/${FACTURA}/notas` },
    ]);
  });

  it("un paso sin el permiso de ese paso va sin enlace (nace cerrado), pero se muestra", () => {
    expect(
      pasosPrevios(FRENOS, { facturaId: FACTURA, recepcionId: COMPRA }, SIN_ACCIONES_DEL_REEMPLAZO),
    ).toEqual([
      { freno: "PAGO_VIGENTE", ruta: null },
      { freno: "CONCILIACIONES_VIVAS", ruta: null },
      { freno: "NOTAS_VIGENTES", ruta: null },
    ]);
  });

  it("cada permiso abre solo su paso", () => {
    const origen = { facturaId: FACTURA, recepcionId: COMPRA };
    const solo = (campo: keyof typeof TODO) =>
      pasosPrevios(FRENOS, origen, { ...SIN_ACCIONES_DEL_REEMPLAZO, [campo]: true }).map(
        (p) => p.ruta !== null,
      );
    expect(solo("anularPago")).toEqual([true, false, false]);
    expect(solo("anularConciliacion")).toEqual([false, true, false]);
    expect(solo("verNotas")).toEqual([false, false, true]);
  });

  it("el pago de una factura que llega sola (sin compra) no tiene pantalla: sin enlace aunque haya permiso", () => {
    expect(
      pasosPrevios([{ freno: "PAGO_VIGENTE" }], { facturaId: FACTURA, recepcionId: null }, TODO),
    ).toEqual([{ freno: "PAGO_VIGENTE", ruta: null }]);
  });

  it("sin frenos no hay pasos", () => {
    expect(pasosPrevios([], { facturaId: FACTURA, recepcionId: null }, TODO)).toEqual([]);
  });
});

describe("numeroParaElMotivo", () => {
  it("completa con ceros el punto de venta (4) y el número (8)", () => {
    expect(numeroParaElMotivo("5", "1234")).toBe("0005-00001234");
    expect(numeroParaElMotivo(" 12 ", " 7 ")).toBe("0012-00000007");
  });
  it("incompleto, vacío", () => {
    expect(numeroParaElMotivo("", "1234")).toBe("");
    expect(numeroParaElMotivo("5", "  ")).toBe("");
  });
});

describe("motivoDelReemplazo", () => {
  const porDefecto = "Reemplazada por la factura {numero}";
  it("sin tocar el campo, el precargado con el número de la nueva", () => {
    expect(motivoDelReemplazo(null, "0005-00001234", porDefecto)).toBe(
      "Reemplazada por la factura 0005-00001234",
    );
  });
  it("mientras falta el número no hay motivo precargado", () => {
    expect(motivoDelReemplazo(null, "", porDefecto)).toBe("");
  });
  it("lo que escribió la persona manda, aunque cambie el número; y vacío es vacío (no vuelve el precargado)", () => {
    expect(motivoDelReemplazo("A mano", "0005-00001234", porDefecto)).toBe("A mano");
    expect(motivoDelReemplazo("", "0005-00001234", porDefecto)).toBe("");
  });
});

describe("importeDifiere", () => {
  it("compara texto decimal sin ceros de relleno: mismo valor, otra escritura, no difiere", () => {
    expect(importeDifiere("2420.00", "2420")).toBe(false);
    expect(importeDifiere("2420.5000", "2420.5")).toBe(false);
    expect(importeDifiere(" 2420.00 ", "2420.00 ")).toBe(false);
  });
  it("otro importe difiere", () => {
    expect(importeDifiere("2420.00", "2420.01")).toBe(true);
    expect(importeDifiere("2420.00", "242.00")).toBe(true);
  });
  it("mientras no se escribió el importe de la nueva no se avisa", () => {
    expect(importeDifiere("2420.00", "")).toBe(false);
    expect(importeDifiere("2420.00", "   ")).toBe(false);
  });
});

const renglon = (extra: Partial<RenglonEscrito> = {}): RenglonEscrito => ({
  id: 1,
  productoId: "pr1",
  nombre: "Bife",
  unidadBase: "KG",
  unidadDeCompra: "KG",
  cantidad: "2",
  unidadDePrecio: "KG",
  precio: "1000",
  ...extra,
});
const escrita = (extra: Partial<FacturaEscrita> = {}): FacturaEscrita => ({
  ...FACTURA_VACIA,
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1234",
  fecha: "2026-11-20",
  totalSegunFactura: "2420.00",
  ...extra,
});

describe("armarElPedidoDeReemplazo", () => {
  it("N3/N4: cada línea dice su producto; el motivo y la factura salen como TEXTO, sin ninguna cuenta", () => {
    expect(armarElPedidoDeReemplazo(escrita(), [renglon()], "Por error", true)).toEqual({
      motivo: "Por error",
      factura: {
        tipo: "FACTURA_A",
        puntoDeVenta: "5",
        numero: "1234",
        fecha: "2026-11-20",
        vencimientoDePago: null,
        lineas: [{ productoId: "pr1", cantidadFacturada: "2", precioNeto: "1000", alicuota: "21" }],
        percepciones: null,
        totalSegunFactura: "2420.00",
        cuitDelProveedor: null,
      },
    });
  });

  it("N2: cada línea dice el renglón de la compra al que corresponde, sin producto", () => {
    const pedido = armarElPedidoDeReemplazo(escrita(), [renglon()], "Por error", false);
    expect(pedido?.factura).toMatchObject({
      lineas: [{ renglon: 1, cantidadFacturada: "2", precioNeto: "1000", alicuota: "21" }],
    });
    expect(JSON.stringify(pedido)).not.toContain("productoId");
  });

  it("un renglón sin producto en el modo con producto sale con producto vacío (el servidor rechaza)", () => {
    const pedido = armarElPedidoDeReemplazo(escrita(), [renglon({ productoId: "" })], "x", true);
    expect(pedido?.factura).toMatchObject({ lineas: [{ productoId: "" }] });
  });

  it("sin motivo (vacío o en blanco) no hay pedido", () => {
    expect(armarElPedidoDeReemplazo(escrita(), [renglon()], "", true)).toBeNull();
    expect(armarElPedidoDeReemplazo(escrita(), [renglon()], "   ", false)).toBeNull();
  });

  it("falta algo de la factura o de las líneas: no hay pedido", () => {
    expect(armarElPedidoDeReemplazo(escrita({ numero: "" }), [renglon()], "x", true)).toBeNull();
    expect(armarElPedidoDeReemplazo(escrita(), [], "x", true)).toBeNull();
    expect(armarElPedidoDeReemplazo(escrita(), [renglon({ precio: "" })], "x", true)).toBeNull();
  });

  it("una factura B sin IVA discriminado va sin alícuota", () => {
    const pedido = armarElPedidoDeReemplazo(escrita({ tipo: "FACTURA_B" }), [renglon()], "x", true);
    expect(pedido?.factura).toMatchObject({ lineas: [{ alicuota: null }] });
  });
});

describe("renglonesDeLaCompra", () => {
  it("la cantidad es lo que entró al stock en la unidad base, sin ceros de relleno; el precio queda vacío", () => {
    expect(
      renglonesDeLaCompra([
        { numero: 1, producto: "Bife", cantidadEnStock: "23.2000", unidadDeStockId: "KG" },
        { numero: 2, producto: null, cantidadEnStock: "5", unidadDeStockId: null },
      ]),
    ).toEqual([
      {
        id: 1,
        productoId: "",
        nombre: "Bife",
        unidadBase: "KG",
        unidadDeCompra: "KG",
        cantidad: "23.2",
        unidadDePrecio: "KG",
        precio: "",
      },
      {
        id: 2,
        productoId: "",
        nombre: "",
        unidadBase: "",
        unidadDeCompra: "",
        cantidad: "5",
        unidadDePrecio: "",
        precio: "",
      },
    ]);
  });
});
