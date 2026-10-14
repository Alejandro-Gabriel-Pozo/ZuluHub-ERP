import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import { cuitDesdeTexto } from "../../primitivas/identificacion-fiscal/cuit";
import { fechaCivilDesdeTexto } from "../../primitivas/tiempo/fecha-civil";
import type { SolicitudDeAutorizacion } from "../../modulos/fiscal/publico";
import { solicitudDeAutorizacion } from "../../../test/utilidades/emision-falsa";
import { solicitudId } from "../../modulos/fiscal/publico";
import { pedidoFECAESolicitar } from "./pedidos-de-wsfe";
import { grabacion } from "../../../test/utilidades/arca";
import { aSolicitudDeWsfe, fechaParaArca } from "./traducir";

const cuit = (texto: string) => {
  const c = cuitDesdeTexto(texto);
  if (!c.ok) throw new Error(texto);
  return c.valor;
};
const fecha = (texto: string) => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error(texto);
  return f.valor;
};
const importe = (texto: string) => importeDesdeTexto(ARS, texto);

const base = (cambios: Partial<SolicitudDeAutorizacion> = {}): SolicitudDeAutorizacion =>
  solicitudDeAutorizacion(
    {
      puntoDeVenta: { cuit: cuit("20111111112"), numero: 1 },
      tipo: "FACTURA_B",
      numero: 14n,
      solicitud: solicitudId("00000000-0000-4000-8000-000000000001"),
    },
    cambios,
  );

describe("de la solicitud del dominio a los valores de WSFE", () => {
  it("una Factura B a consumidor final: cada valor con su código de ARCA", () => {
    expect(aSolicitudDeWsfe(base())).toEqual({
      puntoDeVenta: 1,
      tipoDeComprobante: 6,
      concepto: 1,
      tipoDeDocumento: 99,
      numeroDeDocumento: "0",
      numero: "14",
      fecha: "20261013",
      total: "121.00",
      noGravado: "0.00",
      neto: "100.00",
      exento: "0.00",
      tributos: "0.00",
      iva: "21.00",
      servicio: null,
      moneda: "PES",
      condicionIva: 5,
      asociado: null,
      alicuotas: [{ id: 5, base: "100.00", importe: "21.00" }],
    });
  });

  it("los tipos de comprobante de las notas y de las otras letras", () => {
    const tipos = {
      FACTURA_A: 1,
      NOTA_DEBITO_A: 2,
      NOTA_CREDITO_A: 3,
      FACTURA_B: 6,
      NOTA_DEBITO_B: 7,
      NOTA_CREDITO_B: 8,
      FACTURA_C: 11,
      NOTA_DEBITO_C: 12,
      NOTA_CREDITO_C: 13,
    } as const;
    for (const [tipo, codigo] of Object.entries(tipos)) {
      const s = base({ tipo: tipo as keyof typeof tipos });
      expect(aSolicitudDeWsfe(s).tipoDeComprobante, tipo).toBe(codigo);
    }
  });

  it("un receptor con CUIT: tipo 80 y su número completo, sin pasar por number", () => {
    const s = aSolicitudDeWsfe(
      base({
        receptor: {
          documento: { tipo: "CUIT", numero: cuit("30500010912") },
          condicionIva: "RESPONSABLE_INSCRIPTO",
        },
      }),
    );
    expect(s).toMatchObject({
      tipoDeDocumento: 80,
      numeroDeDocumento: "30500010912",
      condicionIva: 1,
    });
  });

  it("los demás documentos y condiciones del receptor", () => {
    const documento = (tipo: "DNI" | "PASAPORTE" | "CUIL" | "CDI", numero: string) =>
      aSolicitudDeWsfe(
        base({ receptor: { documento: { tipo, numero }, condicionIva: "MONOTRIBUTO" } }),
      );
    expect(documento("DNI", "12345678")).toMatchObject({
      tipoDeDocumento: 96,
      numeroDeDocumento: "12345678",
      condicionIva: 6,
    });
    expect(documento("PASAPORTE", "123456789")).toMatchObject({ tipoDeDocumento: 94 });
    expect(documento("CUIL", "20111111112")).toMatchObject({ tipoDeDocumento: 86 });
    expect(documento("CDI", "20111111112")).toMatchObject({ tipoDeDocumento: 87 });
  });

  it("los importes salen con dos decimales, el exento y el no gravado en su lugar", () => {
    const s = aSolicitudDeWsfe(
      base({
        importes: {
          total: importe("1234.56"),
          neto: importe("1000.00"),
          iva: importe("210.00"),
          exento: importe("20.00"),
          noGravado: importe("4.56"),
          tributos: importe("0.00"),
          alicuotas: [
            { alicuota: "21", base: importe("1000.00"), iva: importe("210.00") },
            { alicuota: "2.5", base: importe("0.10"), iva: importe("0.00") },
          ],
        },
      }),
    );
    expect(s).toMatchObject({
      total: "1234.56",
      neto: "1000.00",
      iva: "210.00",
      exento: "20.00",
      noGravado: "4.56",
      tributos: "0.00",
      alicuotas: [
        { id: 5, base: "1000.00", importe: "210.00" },
        { id: 9, base: "0.10", importe: "0.00" },
      ],
    });
  });

  it("un importe enorme no pierde cifras (no pasa por number)", () => {
    const s = aSolicitudDeWsfe(
      base({
        importes: {
          total: importe("12345678901234.56"),
          neto: importe("12345678901234.56"),
          iva: importe("0.00"),
          exento: importe("0.00"),
          noGravado: importe("0.00"),
          tributos: importe("0.00"),
          alicuotas: [],
        },
      }),
    );
    expect(s.total).toBe("12345678901234.56");
  });

  it("el concepto de servicios lleva las tres fechas del abono", () => {
    const s = aSolicitudDeWsfe(
      base({
        concepto: "SERVICIOS",
        servicio: {
          desde: fecha("2026-10-01"),
          hasta: fecha("2026-10-31"),
          vencimientoDePago: fecha("2026-11-10"),
        },
      }),
    );
    expect(s).toMatchObject({
      concepto: 2,
      servicio: { desde: "20261001", hasta: "20261031", vencimientoDePago: "20261110" },
    });
    expect(aSolicitudDeWsfe(base({ concepto: "PRODUCTOS_Y_SERVICIOS" })).concepto).toBe(3);
  });

  it("una nota lleva su comprobante asociado con el número como texto", () => {
    const s = aSolicitudDeWsfe(
      base({
        tipo: "NOTA_CREDITO_B",
        asociado: {
          tipo: "FACTURA_B",
          puntoDeVenta: 3,
          numero: 12345678n,
          cuit: cuit("20111111112"),
          fecha: fecha("2026-10-12"),
        },
      }),
    );
    expect(s.asociado).toEqual({
      tipoDeComprobante: 6,
      puntoDeVenta: 3,
      numero: "12345678",
      cuit: "20111111112",
      fecha: "20261012",
    });
  });

  it("una alícuota sin id en Iva (exento o no gravado) es un defecto de quien armó los importes", () => {
    const mal = base({
      importes: {
        ...base().importes,
        alicuotas: [{ alicuota: "EXENTO", base: importe("1.00"), iva: importe("0.00") }],
      },
    });
    expect(() => aSolicitudDeWsfe(mal)).toThrow(
      new RangeError("la alícuota EXENTO no se informa en Iva"),
    );
  });

  it("fechaParaArca quita todos los guiones", () => {
    expect(fechaParaArca("2026-10-14")).toBe("20261014");
  });

  it("armado con pedidoFECAESolicitar, la Factura B de la grabación sale idéntica", () => {
    const s = aSolicitudDeWsfe(
      base({
        fecha: fecha("2026-10-14"),
        numero: 14n,
        importes: {
          total: importe("231.50"),
          neto: importe("200.00"),
          iva: importe("31.50"),
          exento: importe("0.00"),
          noGravado: importe("0.00"),
          tributos: importe("0.00"),
          alicuotas: [
            { alicuota: "21", base: importe("100.00"), iva: importe("21.00") },
            { alicuota: "10.5", base: importe("100.00"), iva: importe("10.50") },
          ],
        },
      }),
    );
    expect(
      pedidoFECAESolicitar({ token: "[OCULTO]", sign: "[OCULTO]", cuit: "20111111112" }, s),
    ).toBe(grabacion(1, "031", "pedido"));
  });
});
