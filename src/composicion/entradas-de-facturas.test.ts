import { describe, expect, it } from "vitest";
import {
  entradaDeAnularConciliacion,
  entradaDeConciliarFactura,
  entradaDeFichaDeFactura,
  entradaDeListarFacturas,
  entradaDeRegistrarFactura,
} from "./entradas-de-facturas";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const linea = { productoId: ID, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" };
const factura = (extra: Record<string, unknown> = {}) => ({
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1234",
  fecha: "2026-11-20",
  lineas: [linea],
  totalSegunFactura: "3630.00",
  ...extra,
});
const registrar = (extra: Record<string, unknown> = {}, f: Record<string, unknown> = {}) => ({
  clave: OTRO,
  proveedorId: ID,
  factura: factura(f),
  ...extra,
});

describe("entradaDeRegistrarFactura: lista de permitidos, sin sucursal", () => {
  it("toma lo declarado: cada línea con su producto, los opcionales en blanco son «no hay» y todo viaja como texto", () => {
    expect(
      entradaDeRegistrarFactura(
        registrar({}, { vencimientoDePago: "  ", percepciones: "", cuitDelProveedor: "" }),
      ),
    ).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        proveedorId: ID,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: 1234,
          fecha: "2026-11-20",
          vencimientoDePago: null,
          lineas: [
            { productoId: ID, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" },
          ],
          percepciones: null,
          totalSegunFactura: "3630.00",
          cuitDelProveedor: null,
          condicionIva: null,
        },
      },
    });
  });

  it("la empresa, la persona, la sucursal, el depósito, el remito o una clave de más no entran", () => {
    for (const extra of [
      { empresaId: ID },
      { personaId: ID },
      { sucursalId: ID },
      { depositoId: ID },
      { remito: null },
      { estado: "ANULADO" },
    ]) {
      expect(entradaDeRegistrarFactura(registrar(extra)).ok).toBe(false);
    }
    expect(entradaDeRegistrarFactura(registrar({}, { sucursalId: ID })).ok).toBe(false);
  });

  it("una línea sin producto, con un producto que no es identificador, con un número como cantidad o con un campo inventado se rechaza", () => {
    const con = (campo: Record<string, unknown>) =>
      entradaDeRegistrarFactura(registrar({}, { lineas: [{ ...linea, ...campo }] }));
    expect(con({ productoId: "harina" }).ok).toBe(false);
    expect(con({ cantidadFacturada: 2000 }).ok).toBe(false);
    expect(con({ precioNeto: 1.5 }).ok).toBe(false);
    expect(con({ renglon: 1 }).ok).toBe(false);
    expect(con({ costo: "1" }).ok).toBe(false);
    const sinProducto = { cantidadFacturada: "1", precioNeto: "1" };
    expect(entradaDeRegistrarFactura(registrar({}, { lineas: [sinProducto] })).ok).toBe(false);
    expect(entradaDeRegistrarFactura(registrar({}, { lineas: [] })).ok).toBe(false);
  });

  it("sin clave, sin proveedor o con un tipo que no es factura se rechaza", () => {
    expect(entradaDeRegistrarFactura({ proveedorId: ID, factura: factura() }).ok).toBe(false);
    expect(entradaDeRegistrarFactura({ clave: OTRO, factura: factura() }).ok).toBe(false);
    expect(entradaDeRegistrarFactura(registrar({}, { tipo: "NOTA_DE_CREDITO_A" })).ok).toBe(false);
    expect(entradaDeRegistrarFactura(registrar({ clave: "no" })).ok).toBe(false);
  });
});

describe("entradaDeConciliarFactura", () => {
  const asignacion = { lineaDeFactura: 1, recepcionId: OTRO, lineaDeRecepcion: 2, cantidad: "40" };
  const conciliar = (extra: Record<string, unknown> = {}) => ({
    clave: OTRO,
    comprobanteId: ID,
    asignaciones: [asignacion],
    ...extra,
  });

  it("toma la clave, la factura y las asignaciones con la cantidad como texto", () => {
    expect(entradaDeConciliarFactura(conciliar())).toEqual({ ok: true, valor: conciliar() });
  });

  it("sin asignaciones, con una cantidad numérica, con un campo de más o con la empresa o la sucursal, se rechaza", () => {
    expect(entradaDeConciliarFactura(conciliar({ asignaciones: [] })).ok).toBe(false);
    expect(
      entradaDeConciliarFactura(conciliar({ asignaciones: [{ ...asignacion, cantidad: 40 }] })).ok,
    ).toBe(false);
    expect(
      entradaDeConciliarFactura(conciliar({ asignaciones: [{ ...asignacion, sucursalId: ID }] }))
        .ok,
    ).toBe(false);
    expect(entradaDeConciliarFactura(conciliar({ empresaId: ID })).ok).toBe(false);
    expect(entradaDeConciliarFactura(conciliar({ clave: "x" })).ok).toBe(false);
  });
});

describe("entradaDeAnularConciliacion, entradaDeFichaDeFactura y entradaDeListarFacturas", () => {
  it("anular lleva solo el id (sin motivo ni nada más)", () => {
    expect(entradaDeAnularConciliacion({ conciliacionId: ID })).toEqual({
      ok: true,
      valor: { conciliacionId: ID },
    });
    expect(entradaDeAnularConciliacion({ conciliacionId: ID, motivo: "x" }).ok).toBe(false);
    expect(entradaDeAnularConciliacion({ conciliacionId: "no" }).ok).toBe(false);
  });

  it("el detalle lleva solo un id válido", () => {
    expect(entradaDeFichaDeFactura({ comprobanteId: ID }).ok).toBe(true);
    expect(entradaDeFichaDeFactura({ comprobanteId: "../x" }).ok).toBe(false);
    expect(entradaDeFichaDeFactura({ comprobanteId: ID, empresaId: OTRO }).ok).toBe(false);
  });

  it("la lista solo lee el cursor `despues`, con la forma que entrega la lista; uno mal formado se rechaza", () => {
    expect(entradaDeListarFacturas({})).toEqual({ ok: true, valor: { despuesDe: null } });
    expect(entradaDeListarFacturas({ despues: `2026-11-20|${ID}`, sucursalId: ID })).toEqual({
      ok: true,
      valor: { despuesDe: `2026-11-20|${ID}` },
    });
    expect(entradaDeListarFacturas({ despues: "20" }).ok).toBe(false);
  });
});
