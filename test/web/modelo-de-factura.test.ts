import { describe, expect, it } from "vitest";
import {
  ALICUOTAS_PARA_ELEGIR,
  CLAVE_DE_TEXTO_DE_LA_ALICUOTA,
  CLAVE_DE_TEXTO_DEL_TIPO,
  FACTURA_VACIA,
  TIPOS_DE_FACTURA,
  conLinea,
  facturaParaCotizar,
  facturaParaElServidor,
  type FacturaEscrita,
} from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-factura";
import {
  renglonNuevo,
  type RenglonCotizado,
  type RenglonEscrito,
} from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-nueva-compra";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import {
  ALICUOTAS_DE_COMPRA,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
} from "../../src/modulos/compras/publico";
import { discriminaIva } from "../../src/modulos/compras/dominio/comprobante";

/**
 * Compras PR 7: el modelo puro de la factura de «Nueva compra». Las listas de la pantalla son subconjuntos de las del dominio (una regla, un lugar); qué se precarga del renglón; cuándo la factura está completa y qué sale al servidor
 * (todo texto, sin importes calculados); y que una A discrimina IVA y una B o C no (coincide con el dominio).
 */
const renglon = (cambios: Partial<RenglonEscrito> = {}): RenglonEscrito => ({
  ...renglonNuevo(1, { productoId: "p1", nombre: "Bife", unidadBase: "GRAMO" }),
  cantidad: "2000",
  precio: "1.5",
  ...cambios,
});
const factura = (cambios: Partial<FacturaEscrita> = {}): FacturaEscrita => ({
  ...FACTURA_VACIA,
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1187",
  fecha: "2026-11-20",
  totalSegunFactura: "3630.00",
  ...cambios,
});
const SIN_COTIZAR = new Map<string, RenglonCotizado>();

describe("las listas de la pantalla son las del dominio", () => {
  it("los tipos son facturas del dominio y cada uno tiene su texto; las alícuotas existen en el dominio y cada una tiene el suyo", () => {
    for (const t of TIPOS_DE_FACTURA) expect(TIPOS_DE_COMPROBANTE_DE_PROVEEDOR).toContain(t);
    expect(TIPOS_DE_FACTURA.map((t) => texto({}, CLAVE_DE_TEXTO_DEL_TIPO[t]))).toEqual([
      "Factura A",
      "Factura B",
      "Factura C",
    ]);
    for (const a of ALICUOTAS_PARA_ELEGIR) expect(ALICUOTAS_DE_COMPRA).toContain(a);
    expect(ALICUOTAS_PARA_ELEGIR.map((a) => texto({}, CLAVE_DE_TEXTO_DE_LA_ALICUOTA[a]))).toEqual([
      "21 %",
      "10,5 %",
      "27 %",
      "Exento",
      "No gravado",
    ]);
  });

  it("solo una A discrimina IVA, igual que el dominio", () => {
    for (const t of TIPOS_DE_FACTURA) {
      expect(discriminaIva(t)).toBe(t === "FACTURA_A");
    }
  });
});

describe("la factura que sale", () => {
  it("precarga cantidad y precio del renglón (unidad base), con la alícuota inicial en una A; todo texto", () => {
    const f = facturaParaElServidor(factura(), [renglon()], SIN_COTIZAR, false);
    expect(f).toEqual({
      tipo: "FACTURA_A",
      puntoDeVenta: "5",
      numero: "1187",
      fecha: "2026-11-20",
      vencimientoDePago: null,
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" }],
      percepciones: null,
      totalSegunFactura: "3630.00",
      cuitDelProveedor: null,
    });
  });

  it("lo que la persona escribe pisa lo precargado; una B o C no manda alícuota", () => {
    let f = factura({ tipo: "FACTURA_B", percepciones: "10.50", vencimientoDePago: "2026-12-01" });
    f = conLinea(f, 1, { cantidad: "1999", precio: "2", alicuota: "10.5" });
    expect(facturaParaElServidor(f, [renglon()], SIN_COTIZAR, false)).toMatchObject({
      lineas: [{ cantidadFacturada: "1999", precioNeto: "2", alicuota: null }],
      percepciones: "10.50",
      vencimientoDePago: "2026-12-01",
    });
    expect(
      facturaParaElServidor(
        conLinea(factura(), 1, { alicuota: "10.5" }),
        [renglon()],
        SIN_COTIZAR,
        false,
      ),
    ).toMatchObject({ lineas: [{ alicuota: "10.5" }] });
  });

  it("si se compró en otra unidad, la cantidad es la que el servidor dice que entra al stock y el precio queda vacío (no se convierte en la pantalla)", () => {
    const r = renglon({
      unidadDeCompra: "KILOGRAMO",
      unidadDePrecio: "KILOGRAMO",
      cantidad: "2",
      precio: "1500",
    });
    const cotizados = new Map([
      [
        "p1",
        {
          productoId: "p1",
          cantidadEnStock: "2000.0000",
          importe: "3000.00",
          costoPorUnidadDeStock: "1.500000",
        },
      ],
    ]);
    expect(facturaParaElServidor(factura(), [r], cotizados, false)).toBeNull();
    expect(facturaParaCotizar(factura(), [r], cotizados)).toBeNull();
    const conPrecio = conLinea(factura(), 1, { precio: "1.5" });
    expect(facturaParaElServidor(conPrecio, [r], cotizados, false)).toMatchObject({
      lineas: [{ cantidadFacturada: "2000", precioNeto: "1.5" }],
    });
  });

  it("falta algo → no sale: sin tipo, sin total, sin punto de venta, número o fecha, o sin CUIT cuando se pide", () => {
    const r = [renglon()];
    expect(facturaParaElServidor(factura({ tipo: "" }), r, SIN_COTIZAR, false)).toBeNull();
    expect(facturaParaElServidor(factura({ tipo: "FACTURA_Z" }), r, SIN_COTIZAR, false)).toBeNull();
    expect(
      facturaParaElServidor(factura({ totalSegunFactura: "" }), r, SIN_COTIZAR, false),
    ).toBeNull();
    expect(facturaParaElServidor(factura({ puntoDeVenta: "" }), r, SIN_COTIZAR, false)).toBeNull();
    expect(facturaParaElServidor(factura({ numero: "" }), r, SIN_COTIZAR, false)).toBeNull();
    expect(facturaParaElServidor(factura({ fecha: "" }), r, SIN_COTIZAR, false)).toBeNull();
    expect(facturaParaElServidor(factura(), r, SIN_COTIZAR, true)).toBeNull();
    expect(
      facturaParaElServidor(factura({ cuit: "20123456786" }), r, SIN_COTIZAR, true),
    ).toMatchObject({
      cuitDelProveedor: "20123456786",
    });
  });

  it("para cotizar alcanza con tipo, total y las líneas (sin punto de venta ni número); sin renglones no hay nada", () => {
    expect(
      facturaParaCotizar(
        factura({ puntoDeVenta: "", numero: "", fecha: "" }),
        [renglon()],
        SIN_COTIZAR,
      ),
    ).toEqual({
      tipo: "FACTURA_A",
      lineas: [{ cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" }],
      percepciones: null,
      totalSegunFactura: "3630.00",
    });
    expect(facturaParaCotizar(factura(), [], SIN_COTIZAR)).toBeNull();
  });
});
