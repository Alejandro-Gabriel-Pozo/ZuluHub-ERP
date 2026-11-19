import { describe, expect, it } from "vitest";
import type { VentaCobrada } from "../../apps/web/ui/plantillas/cobrar/modelo-de-cobro";
import { esVentaACero } from "../../apps/web/ui/plantillas/cobrar/modelo-de-cobro";
import {
  confirmacionDeCero,
  esImporteEnCero,
  pedidoDeVentaACero,
  type CotizacionDeLaVenta,
  type LineaDeLaVenta,
} from "../../apps/web/ui/plantillas/venta/modelo-de-la-cuenta";

const linea = (clave: string): LineaDeLaVenta => ({
  clave,
  productoId: `p-${clave}`,
  varianteId: null,
  opcionIds: [],
  cantidad: 10000,
  revision: 0,
});
const importe = (monto: string) => ({ moneda: "ARS", monto });
const cotizada = (unitario: string, total = unitario) => ({
  precioUnitario: importe(unitario),
  importe: importe(total),
});
const cotizacion = (
  total: string,
  ...lineas: ReturnType<typeof cotizada>[]
): CotizacionDeLaVenta => ({
  total: importe(total),
  lineas,
});
const nombre = (l: LineaDeLaVenta) => `Producto ${l.clave}`;

describe("esImporteEnCero", () => {
  it.each(["0", "0.00", "0.000", "00.0"])("«%s» es cero", (monto) => {
    expect(esImporteEnCero(monto)).toBe(true);
  });
  it.each(["0.01", "10.00", "100", "", "-0.00"])("«%s» no es cero", (monto) => {
    expect(esImporteEnCero(monto)).toBe(false);
  });
});

describe("confirmacionDeCero (mira solo la cotización del servidor)", () => {
  it("total 0 con una línea: TOTAL con esa línea", () => {
    expect(confirmacionDeCero([linea("a")], nombre, cotizacion("0.00", cotizada("0.00")))).toEqual({
      tipo: "TOTAL",
      lineasACero: [{ lineaId: "a", nombre: "Producto a" }],
    });
  });
  it("total 0 con varias líneas: TOTAL con todas, en el orden de la cuenta", () => {
    const pedido = confirmacionDeCero(
      [linea("a"), linea("b")],
      nombre,
      cotizacion("0", cotizada("0.000"), cotizada("0")),
    );
    expect(pedido).toEqual({
      tipo: "TOTAL",
      lineasACero: [
        { lineaId: "a", nombre: "Producto a" },
        { lineaId: "b", nombre: "Producto b" },
      ],
    });
  });
  it("una línea a 0 dentro de un total positivo: LINEA solo con la de cero", () => {
    expect(
      confirmacionDeCero(
        [linea("a"), linea("b")],
        nombre,
        cotizacion("800.00", cotizada("800.00"), cotizada("0.00")),
      ),
    ).toEqual({ tipo: "LINEA", lineasACero: [{ lineaId: "b", nombre: "Producto b" }] });
  });
  it("una cotización con menos líneas que la cuenta no inventa líneas a cero", () => {
    expect(
      confirmacionDeCero(
        [linea("a"), linea("b")],
        nombre,
        cotizacion("800.00", cotizada("800.00")),
      ),
    ).toEqual({ tipo: "NINGUNA" });
  });
  it("nada a cero: NINGUNA", () => {
    expect(
      confirmacionDeCero([linea("a")], nombre, cotizacion("800.00", cotizada("800.00"))),
    ).toEqual({ tipo: "NINGUNA" });
  });
  it("precio unitario positivo pero importe cero (cantidad mínima) también es línea a cero", () => {
    expect(
      confirmacionDeCero(
        [linea("a"), linea("b")],
        nombre,
        cotizacion("800.00", cotizada("800.00"), cotizada("5.00", "0.00")),
      ).tipo,
    ).toBe("LINEA");
  });
});

describe("esVentaACero", () => {
  const venta = (monto: string, cobros: VentaCobrada["cobros"]): VentaCobrada => ({
    ticketId: "t",
    ejemplarId: "e",
    numero: 1,
    estado: "CORTESIA",
    total: importe(monto),
    cobros,
  });
  it("sin cobros y total cero", () => {
    expect(esVentaACero(venta("0.00", []))).toBe(true);
    expect(esVentaACero(venta("0", []))).toBe(true);
  });
  it("con cobros no es venta a cero aunque el total sea cero", () => {
    const cobro = { medioDePagoId: "m", cuentaDeCobroId: null, importe: importe("0.00") };
    expect(esVentaACero(venta("0.00", [cobro]))).toBe(false);
  });
  it("con cobros o con total positivo no", () => {
    const cobro = { medioDePagoId: "m", cuentaDeCobroId: null, importe: importe("800.00") };
    expect(esVentaACero(venta("800.00", [cobro]))).toBe(false);
    expect(esVentaACero(venta("800.00", []))).toBe(false);
  });
});

describe("pedidoDeVentaACero", () => {
  const ids = { cuentaId: "c", ejemplarId: "e", lineas: new Map([["a", "la"]]) };
  it("manda cobros vacío, la confirmación, el total esperado y la caja", () => {
    expect(
      pedidoDeVentaACero({ ids, cajaId: "caja-1", cuenta: [linea("a")], total: importe("0.00") }),
    ).toEqual({
      cuentaId: "c",
      ejemplarId: "e",
      lineas: [{ lineaId: "la", productoId: "p-a", opcionIds: [], cantidad: "1" }],
      totalEsperado: importe("0.00"),
      cajaId: "caja-1",
      cobros: [],
      confirmaciones: ["VENTA_A_CERO"],
    });
  });
  it("la medida elegida viaja con su id y una cuenta vacía no arma pedido", () => {
    const conMedida = { ...linea("a"), varianteId: "mediana", opcionIds: ["x"] };
    expect(
      pedidoDeVentaACero({ ids, cajaId: "caja-1", cuenta: [conMedida], total: importe("0.00") }),
    ).toMatchObject({
      lineas: [{ lineaId: "la", productoId: "p-a", varianteId: "mediana", opcionIds: ["x"] }],
    });
    expect(
      pedidoDeVentaACero({ ids, cajaId: "caja-1", cuenta: [], total: importe("0.00") }),
    ).toBeNull();
  });
  it("sin id para una línea no hay pedido (nunca a medias)", () => {
    expect(
      pedidoDeVentaACero({
        ids,
        cajaId: "caja-1",
        cuenta: [linea("a"), linea("b")],
        total: importe("0.00"),
      }),
    ).toBeNull();
  });
});
