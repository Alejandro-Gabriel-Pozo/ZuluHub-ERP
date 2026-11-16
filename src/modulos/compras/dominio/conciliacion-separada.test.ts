import { describe, expect, it } from "vitest";
import {
  huellaDeLaFacturaSeparada,
  leerAsignaciones,
  leerFacturaSeparada,
  pendienteDeLinea,
  proponerAsignaciones,
} from "./conciliacion-separada";

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const R1 = "00000000-0000-4000-8000-0000000000a1";
const R2 = "00000000-0000-4000-8000-0000000000a2";

const factura = (extra: Record<string, unknown> = {}) => ({
  tipo: "FACTURA_A",
  puntoDeVenta: 5,
  numero: 100,
  fecha: "2026-10-10",
  lineas: [{ productoId: P1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
  totalSegunFactura: "2420.00",
  cuitDelProveedor: null,
  ...extra,
});

describe("leerFacturaSeparada", () => {
  it("lee la factura de N2 más el producto de cada línea, numerando las líneas por posición", () => {
    const r = leerFacturaSeparada(
      factura({
        lineas: [
          { productoId: P1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" },
          { productoId: P2, cantidadFacturada: "5", precioNeto: "2", alicuota: null },
        ],
      }),
    );
    expect(r.ok && r.valor.productos).toEqual([P1, P2]);
    expect(r.ok && r.valor.factura.lineas.map((l) => l.renglon)).toEqual([1, 2]);
    expect(r.ok && r.valor.factura.numero).toBe(100);
  });

  it("sin líneas, o con lo que no es una lista, son LINEAS_REQUERIDAS", () => {
    for (const lineas of [[], null, undefined, "x", {}]) {
      expect(leerFacturaSeparada(factura({ lineas }))).toEqual({
        ok: false,
        error: "LINEAS_REQUERIDAS",
      });
    }
    for (const crudo of [null, undefined, "x", [], 5]) {
      expect(leerFacturaSeparada(crudo)).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    }
  });

  it("cada línea necesita un producto que sea un identificador: sin él, PRODUCTO_NO_ENCONTRADO", () => {
    const sin = { cantidadFacturada: "1", precioNeto: "1", alicuota: "21" };
    for (const productoId of [undefined, null, "", "no-es-un-id", 5]) {
      expect(leerFacturaSeparada(factura({ lineas: [{ ...sin, productoId }] }))).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
    }
    expect(leerFacturaSeparada(factura({ lineas: [sin] }))).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
    const mezcla = [{ ...sin, productoId: P1 }, sin];
    expect(leerFacturaSeparada(factura({ lineas: mezcla }))).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
  });

  it("los errores de la factura de N2 pasan tal cual (primero la forma de la factura, después el producto)", () => {
    expect(leerFacturaSeparada(factura({ tipo: "OTRA" }))).toEqual({
      ok: false,
      error: "TIPO_DE_COMPROBANTE_INVALIDO",
    });
    expect(
      leerFacturaSeparada(
        factura({ tipo: "OTRA", lineas: [{ cantidadFacturada: "1", precioNeto: "1" }] }),
      ),
    ).toEqual({ ok: false, error: "TIPO_DE_COMPROBANTE_INVALIDO" });
    expect(leerFacturaSeparada(factura({ fecha: "2026-13-40" }))).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
  });
});

describe("huellaDeLaFacturaSeparada", () => {
  it("es de 64 hex, igual para el mismo pedido, y distinta si cambia el proveedor, la factura o el producto de una línea", () => {
    const leida = leerFacturaSeparada(factura());
    if (!leida.ok) throw new Error("la factura de prueba tiene que leerse");
    const h = huellaDeLaFacturaSeparada("prov-1", leida.valor);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaFacturaSeparada("prov-1", { ...leida.valor })).toBe(h);
    expect(huellaDeLaFacturaSeparada("prov-2", leida.valor)).not.toBe(h);
    expect(huellaDeLaFacturaSeparada("prov-1", { ...leida.valor, productos: [P2] })).not.toBe(h);
    const otra = leerFacturaSeparada(factura({ numero: 101 }));
    if (!otra.ok) throw new Error("la otra factura tiene que leerse");
    expect(huellaDeLaFacturaSeparada("prov-1", otra.valor)).not.toBe(h);
  });

  it("el contenido canónico no cambia: la huella de una factura ya guardada tiene que seguir siendo la misma", () => {
    const leida = leerFacturaSeparada(factura());
    if (!leida.ok) throw new Error("la factura de prueba tiene que leerse");
    expect(huellaDeLaFacturaSeparada("prov-1", leida.valor)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaFacturaSeparada("prov-1", leida.valor)).toBe(
      huellaDeLaFacturaSeparada("prov-1", leida.valor),
    );
  });
});

describe("leerAsignaciones", () => {
  const a = (extra: Record<string, unknown> = {}) => ({
    lineaDeFactura: 1,
    recepcionId: R1,
    lineaDeRecepcion: 1,
    cantidad: "100",
    ...extra,
  });

  it("lee la lista con la cantidad en forma canónica", () => {
    expect(leerAsignaciones([a(), a({ lineaDeFactura: 2, cantidad: "2.5" })])).toEqual({
      ok: true,
      valor: [
        { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "100.0000" },
        { lineaDeFactura: 2, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "2.5000" },
      ],
    });
  });

  it("rechaza lo que no es una lista no vacía, el mismo par repetido y lo que pasa el tope", () => {
    for (const crudo of [[], null, undefined, "x", {}]) {
      expect(leerAsignaciones(crudo)).toEqual({ ok: false, error: "ASIGNACIONES_INVALIDAS" });
    }
    expect(leerAsignaciones([a(), a({ cantidad: "5" })])).toEqual({
      ok: false,
      error: "ASIGNACIONES_INVALIDAS",
    });
    expect(leerAsignaciones([a(), a({ lineaDeRecepcion: 2 })]).ok).toBe(true);
    expect(leerAsignaciones([a(), a({ recepcionId: R2 })]).ok).toBe(true);
    expect(leerAsignaciones([a(), a({ lineaDeFactura: 2 })]).ok).toBe(true);
    const muchas = Array.from({ length: 10_000 }, (_, i) => a({ lineaDeFactura: i + 1 }));
    expect(leerAsignaciones(muchas)).toEqual({ ok: false, error: "ASIGNACIONES_INVALIDAS" });
    expect(leerAsignaciones(muchas.slice(0, 9_999)).ok).toBe(true);
  });

  it("cada campo tiene que ser del tipo y el rango que dice", () => {
    const invalidas: Record<string, unknown>[] = [
      { lineaDeFactura: 0 },
      { lineaDeFactura: -1 },
      { lineaDeFactura: 1.5 },
      { lineaDeFactura: "1" },
      { lineaDeFactura: undefined },
      { lineaDeRecepcion: 0 },
      { lineaDeRecepcion: 1.5 },
      { lineaDeRecepcion: "1" },
      { recepcionId: "no-es-un-id" },
      { recepcionId: 5 },
      { recepcionId: undefined },
      { cantidad: "0" },
      { cantidad: "-1" },
      { cantidad: "1.00001" },
      { cantidad: "abc" },
      { cantidad: 100 },
      { cantidad: undefined },
    ];
    for (const extra of invalidas) {
      expect(leerAsignaciones([a(extra)]), JSON.stringify(extra)).toEqual({
        ok: false,
        error: "ASIGNACIONES_INVALIDAS",
      });
    }
    for (const crudo of [null, "x", 5, [a()]]) {
      expect(leerAsignaciones([crudo])).toEqual({ ok: false, error: "ASIGNACIONES_INVALIDAS" });
    }
  });
});

describe("pendienteDeLinea", () => {
  it("el total menos lo asignado, o null si no queda nada o los datos no son decimales", () => {
    expect(pendienteDeLinea("2000.0000", "500.0000")).toBe("1500.0000");
    expect(pendienteDeLinea("2000.0000", "0.0000")).toBe("2000.0000");
    expect(pendienteDeLinea("0.0001", "0")).toBe("0.0001");
    expect(pendienteDeLinea("2000.0000", "2000.0000")).toBeNull();
    expect(pendienteDeLinea("1", "2")).toBeNull();
    expect(pendienteDeLinea("abc", "1")).toBeNull();
    expect(pendienteDeLinea("5", "abc")).toBeNull();
  });
});

describe("proponerAsignaciones", () => {
  const f = (numero: number, productoId: string, sinConciliar: string) => ({
    numero,
    productoId,
    sinConciliar,
  });
  const r = (recepcionId: string, linea: number, productoId: string, sinAsignar: string) => ({
    recepcionId,
    linea,
    productoId,
    sinAsignar,
  });

  it("toma por producto y en el orden recibido hasta cubrir lo facturado", () => {
    expect(
      proponerAsignaciones(
        [f(1, P1, "2500")],
        [r(R1, 1, P1, "2000"), r(R2, 1, P1, "1000"), r(R2, 2, P2, "9")],
      ),
    ).toEqual([
      { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "2000.0000" },
      { lineaDeFactura: 1, recepcionId: R2, lineaDeRecepcion: 1, cantidad: "500.0000" },
    ]);
  });

  it("lo que una línea toma ya no lo toma la siguiente del mismo producto", () => {
    expect(
      proponerAsignaciones([f(1, P1, "1500"), f(2, P1, "1500")], [r(R1, 1, P1, "2000")]),
    ).toEqual([
      { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "1500.0000" },
      { lineaDeFactura: 2, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "500.0000" },
    ]);
  });

  it("el saldo exacto se asigna entero y una línea sin saldo, de otro producto o con datos inválidos no genera nada", () => {
    expect(proponerAsignaciones([f(1, P1, "2000")], [r(R1, 1, P1, "2000")])).toEqual([
      { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "2000.0000" },
    ]);
    expect(proponerAsignaciones([f(1, P1, "10")], [r(R1, 1, P2, "10")])).toEqual([]);
    expect(proponerAsignaciones([f(1, P1, "10")], [r(R1, 1, P1, "0")])).toEqual([]);
    expect(proponerAsignaciones([f(1, P1, "10")], [r(R1, 1, P1, "abc")])).toEqual([]);
    expect(proponerAsignaciones([f(1, P1, "abc")], [r(R1, 1, P1, "10")])).toEqual([]);
    expect(proponerAsignaciones([f(1, P1, "0")], [r(R1, 1, P1, "10")])).toEqual([]);
    expect(proponerAsignaciones([], [r(R1, 1, P1, "10")])).toEqual([]);
    expect(proponerAsignaciones([f(1, P1, "10")], [])).toEqual([]);
  });

  it("dos líneas recibidas con la misma recepción y distinta línea tienen saldos separados", () => {
    expect(
      proponerAsignaciones([f(1, P1, "30")], [r(R1, 1, P1, "10"), r(R1, 2, P1, "10")]),
    ).toEqual([
      { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 1, cantidad: "10.0000" },
      { lineaDeFactura: 1, recepcionId: R1, lineaDeRecepcion: 2, cantidad: "10.0000" },
    ]);
  });
});
