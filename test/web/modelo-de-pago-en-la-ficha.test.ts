import { describe, expect, it } from "vitest";
import {
  armarLaFicha,
  SIN_ACCIONES_DE_LA_COMPRA,
  type FichaDeCompraParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra";
import { textosDeCompras } from "../../apps/web/ui/plantillas/compras/textos-de-compras";

/**
 * Compras PR 8: el pago de la factura en la ficha de la compra (modelo puro). Nace cerrado: sin permiso no hay «Declarar pago» ni «Anular» del pago; sin factura, con la compra anulada o con un pago vigente
 * no se ofrece pagar; el pago muestra medio, fecha, importe, quién y cuándo, y uno anulado queda a la vista con su motivo (nada se borra). El modelo no calcula ningún importe: muestra el que dice el servidor.
 */
const textos = textosDeCompras();
const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const COMPROBANTE = "0c0c0c0c-1111-4222-8333-444444444444";
const pesos = (monto: string) => ({ moneda: "ARS", monto });
const pago = (cambios: Record<string, unknown> = {}) => ({
  id: "0d0d0d0d-1111-4222-8333-444444444444",
  fechaDePago: "2026-11-24",
  medio: "TRANSFERENCIA",
  importe: pesos("2420.10"),
  estado: "VIGENTE" as const,
  declaradoPor: "ana@ejemplo.com",
  declaradoEn: "2026-11-24T12:14:00.000Z",
  anuladoPor: null,
  anuladoEn: null,
  motivoDeAnulacion: null,
  ...cambios,
});
const ficha = (cambios: Record<string, unknown> = {}): FichaDeCompraParaLaPantalla => ({
  recepcionId: ID,
  numero: 5,
  proveedor: "Carnes del Sur",
  fechaNegocio: "2026-10-31",
  estado: "RECIBIDA_Y_FACTURADA",
  remito: null,
  registradaPor: "ana@ejemplo.com",
  registradaEn: "2026-11-01T00:14:00.000Z",
  anulacion: null,
  lineas: [],
  total: null,
  factura: {
    comprobanteId: COMPROBANTE,
    letra: "A",
    puntoDeVenta: 2,
    numero: 1187,
    fecha: "2026-10-31",
    vencimientoDePago: null,
    totalSegunLaFactura: pesos("2420.10"),
  },
  pagos: [],
  ...cambios,
});
const PUEDE = { corregir: false, anular: false, pagar: true, anularPago: true };

describe("el pago de la factura en la ficha de la compra", () => {
  it("sin permisos (o sin decir nada) no se ofrece ni «Declarar pago» ni «Anular» el pago: todo nace cerrado", () => {
    for (const f of [ficha(), ficha({ pagos: [pago()] })]) {
      const sin = armarLaFicha(f, textos);
      expect(sin.declararPago).toBeNull();
      expect(sin.anularPagoId).toBeNull();
      expect(armarLaFicha(f, textos, SIN_ACCIONES_DE_LA_COMPRA).declararPago).toBeNull();
    }
  });

  it("con permiso y una factura sin pago ofrece «Declarar pago» hacia la pantalla del pago, y nada que anular", () => {
    const f = armarLaFicha(ficha(), textos, PUEDE);
    expect(f.declararPago).toEqual({ texto: "Declarar pago", href: `/compras/${ID}/pago` });
    expect(f.anularPagoId).toBeNull();
    expect(f.pagos).toEqual([]);
  });

  it("no se ofrece pagar sin factura, con la compra anulada ni con un pago vigente; con el pago vigente se ofrece anularlo", () => {
    expect(armarLaFicha(ficha({ factura: null }), textos, PUEDE).declararPago).toBeNull();
    expect(armarLaFicha(ficha({ estado: "ANULADA" }), textos, PUEDE).declararPago).toBeNull();
    const pagada = armarLaFicha(ficha({ pagos: [pago()] }), textos, PUEDE);
    expect(pagada.declararPago).toBeNull();
    expect(pagada.anularPagoId).toBe("0d0d0d0d-1111-4222-8333-444444444444");
    expect(
      armarLaFicha(ficha({ pagos: [pago()] }), textos, { ...PUEDE, anularPago: false })
        .anularPagoId,
    ).toBeNull();
  });

  it("muestra el medio, la fecha, el importe con centavos exactos, quién y cuándo (hora de Argentina)", () => {
    const [p] = armarLaFicha(ficha({ pagos: [pago()] }), textos, PUEDE).pagos;
    expect(p?.titulo).toBe("Transferencia · 24/11/2026");
    expect(p?.importe).toBe("$ 2.420,10");
    expect(p?.quien).toBe("ana@ejemplo.com · 24/11/2026 09:14");
    expect(p?.anulado).toBeNull();
  });

  it("un pago anulado queda a la vista con «Anulado», su motivo, quién y cuándo, y vuelve «Declarar pago»", () => {
    const anulado = pago({
      estado: "ANULADO",
      anuladoPor: "bea@ejemplo.com",
      anuladoEn: "2026-11-24T13:00:00.000Z",
      motivoDeAnulacion: "Se pagó mal",
    });
    const f = armarLaFicha(ficha({ pagos: [anulado] }), textos, PUEDE);
    expect(f.pagos[0]?.anulado).toEqual({
      rotulo: "Anulado",
      motivo: "Se pagó mal",
      quien: "bea@ejemplo.com · 24/11/2026 10:00",
    });
    expect(f.declararPago).not.toBeNull();
    expect(f.anularPagoId).toBeNull();
  });

  it("sin correo que mostrar no se inventa ni un nombre ni una línea de «quién»", () => {
    const [p] = armarLaFicha(ficha({ pagos: [pago({ declaradoPor: null })] }), textos, PUEDE).pagos;
    expect(p?.quien).toBeNull();
  });
});
