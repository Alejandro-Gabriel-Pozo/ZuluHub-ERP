import { describe, expect, it } from "vitest";
import {
  entradaDeCambiarElComprobante,
  entradaDeDeshacerAntesDeCambiar,
  entradaDeDeshacerAntesDeReemplazar,
  entradaDeReemplazarFactura,
} from "./entradas-de-reemplazo";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const VISTA = "33333333-3333-4333-8333-333333333333";
const PRODUCTO = "44444444-4444-4444-8444-444444444444";

const facturaSeparada = (extra: Record<string, unknown> = {}) => ({
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1234",
  fecha: "2026-11-20",
  lineas: [{ productoId: PRODUCTO, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" }],
  totalSegunFactura: "2420.00",
  ...extra,
});
const reemplazar = (extra: Record<string, unknown> = {}, f: Record<string, unknown> = {}) => ({
  clave: OTRO,
  comprobanteId: ID,
  motivo: "Reemplazada por la factura 0005-00001234",
  factura: facturaSeparada(f),
  ...extra,
});
const facturaDeCompra = (extra: Record<string, unknown> = {}) => ({
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1234",
  fecha: "2026-11-20",
  lineas: [{ renglon: 1, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" }],
  totalSegunFactura: "2420.00",
  ...extra,
});
const cambiar = (extra: Record<string, unknown> = {}, f: Record<string, unknown> = {}) => ({
  clave: OTRO,
  recepcionId: ID,
  facturaVigenteVistaId: VISTA,
  motivo: "Reemplazada por la factura 0005-00001234",
  factura: facturaDeCompra(f),
  ...extra,
});

describe("entradaDeReemplazarFactura", () => {
  it("lee la clave, la factura que se reemplaza, el motivo y la factura nueva campo por campo; los opcionales en blanco son null", () => {
    expect(entradaDeReemplazarFactura(reemplazar())).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        comprobanteId: ID,
        motivo: "Reemplazada por la factura 0005-00001234",
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: 1234,
          fecha: "2026-11-20",
          vencimientoDePago: null,
          lineas: [
            { productoId: PRODUCTO, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" },
          ],
          percepciones: null,
          totalSegunFactura: "2420.00",
          cuitDelProveedor: null,
          condicionIva: null,
        },
      },
    });
  });

  it("un vencimiento y percepciones en blanco son «no hay»; con valor pasan tal cual como texto", () => {
    const r = entradaDeReemplazarFactura(
      reemplazar({}, { vencimientoDePago: "  ", percepciones: "10.00" }),
    );
    expect(r.ok && r.valor.factura.vencimientoDePago).toBeNull();
    expect(r.ok && r.valor.factura.percepciones).toBe("10.00");
  });

  it("rechaza campos que el navegador inventó: el proveedor, la empresa, la persona y la sucursal no se leen", () => {
    for (const extra of [
      { proveedorId: OTRO },
      { empresaId: OTRO },
      { personaId: OTRO },
      { sucursalId: OTRO },
    ]) {
      expect(entradaDeReemplazarFactura(reemplazar(extra)).ok).toBe(false);
    }
    expect(entradaDeReemplazarFactura(reemplazar({}, { proveedorId: OTRO })).ok).toBe(false);
  });

  it("rechaza el pedido sin clave, sin factura, sin motivo, sin líneas o con ids que no son UUID", () => {
    expect(entradaDeReemplazarFactura(reemplazar({ clave: "abc" })).ok).toBe(false);
    expect(entradaDeReemplazarFactura(reemplazar({ comprobanteId: "abc" })).ok).toBe(false);
    expect(entradaDeReemplazarFactura(reemplazar({ motivo: undefined })).ok).toBe(false);
    expect(entradaDeReemplazarFactura(reemplazar({ factura: undefined })).ok).toBe(false);
    expect(entradaDeReemplazarFactura(reemplazar({}, { lineas: [] })).ok).toBe(false);
    expect(entradaDeReemplazarFactura(null).ok).toBe(false);
  });

  it("los importes son TEXTO: un número no pasa y un texto enorme tampoco; el formato canónico lo decide el dominio, no la frontera", () => {
    expect(entradaDeReemplazarFactura(reemplazar({}, { totalSegunFactura: 2420 })).ok).toBe(false);
    expect(
      entradaDeReemplazarFactura(reemplazar({}, { totalSegunFactura: "9".repeat(41) })).ok,
    ).toBe(false);
    const r = entradaDeReemplazarFactura(reemplazar({}, { totalSegunFactura: "1e3" }));
    expect(r.ok && r.valor.factura.totalSegunFactura).toBe("1e3");
  });

  it("la alícuota es de la lista de alícuotas", () => {
    const linea = { productoId: PRODUCTO, cantidadFacturada: "2", precioNeto: "1", alicuota: "99" };
    expect(entradaDeReemplazarFactura(reemplazar({}, { lineas: [linea] })).ok).toBe(false);
  });
});

describe("entradaDeCambiarElComprobante", () => {
  it("lee la clave, la compra, la factura que se miraba, el motivo y la factura nueva con sus renglones", () => {
    expect(entradaDeCambiarElComprobante(cambiar())).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        recepcionId: ID,
        facturaVigenteVistaId: VISTA,
        motivo: "Reemplazada por la factura 0005-00001234",
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: 1234,
          fecha: "2026-11-20",
          vencimientoDePago: null,
          lineas: [{ renglon: 1, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" }],
          percepciones: null,
          totalSegunFactura: "2420.00",
          cuitDelProveedor: null,
          condicionIva: null,
        },
      },
    });
  });

  it("sin la factura que se miraba no hay control de versión: se rechaza (no es opcional)", () => {
    expect(entradaDeCambiarElComprobante(cambiar({ facturaVigenteVistaId: undefined })).ok).toBe(
      false,
    );
    expect(entradaDeCambiarElComprobante(cambiar({ facturaVigenteVistaId: "abc" })).ok).toBe(false);
  });

  it("rechaza campos de más (proveedor, empresa, sucursal) y un renglón que no es entero", () => {
    expect(entradaDeCambiarElComprobante(cambiar({ proveedorId: OTRO })).ok).toBe(false);
    expect(entradaDeCambiarElComprobante(cambiar({ empresaId: OTRO })).ok).toBe(false);
    const linea = { renglon: "x", cantidadFacturada: "2", precioNeto: "1", alicuota: "21" };
    expect(entradaDeCambiarElComprobante(cambiar({}, { lineas: [linea] })).ok).toBe(false);
  });
});

describe("entradaDeDeshacerAntesDeReemplazar y entradaDeDeshacerAntesDeCambiar", () => {
  it("solo el id (un UUID); cualquier otra cosa se rechaza", () => {
    expect(entradaDeDeshacerAntesDeReemplazar({ comprobanteId: ID })).toEqual({
      ok: true,
      valor: { comprobanteId: ID },
    });
    expect(entradaDeDeshacerAntesDeReemplazar({ comprobanteId: ID, otro: 1 }).ok).toBe(false);
    expect(entradaDeDeshacerAntesDeReemplazar({ comprobanteId: "x" }).ok).toBe(false);
    expect(entradaDeDeshacerAntesDeCambiar({ recepcionId: ID })).toEqual({
      ok: true,
      valor: { recepcionId: ID },
    });
    expect(entradaDeDeshacerAntesDeCambiar({ recepcionId: ID, otro: 1 }).ok).toBe(false);
    expect(entradaDeDeshacerAntesDeCambiar({}).ok).toBe(false);
  });
});
