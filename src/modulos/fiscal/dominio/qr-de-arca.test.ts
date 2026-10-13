import { describe, expect, it } from "vitest";
import { fecha } from "../../../../test/utilidades/facturacion";
import { CUIT_B, CUIT_C } from "../../../../test/utilidades/fiscal";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { TIPOS_DE_COMPROBANTE } from "./comprobante-emitido";
import { CODIGO_DE_TIPO_DE_COMPROBANTE } from "./codigos-de-arca";
import { URL_BASE_DEL_QR, jsonDelQr, urlDelQr, type DatosParaQr } from "./qr-de-arca";

function cuit(texto: string): Cuit {
  const r = cuitDesdeTexto(texto);
  if (!r.ok) throw new Error(`CUIT de prueba inválido: ${texto}`);
  return r.valor;
}

/** Valores del ejemplo público de la especificación del QR: CUIT 30000000007, factura A 10-94, CAE de 14 dígitos. */
const EJEMPLO: DatosParaQr = {
  fecha: fecha("2020-10-13"),
  cuit: cuit("30000000007"),
  puntoDeVenta: 10,
  tipo: "FACTURA_A",
  numero: 94n,
  total: importeDesdeTexto(ARS, "12100.00"),
  documento: { tipo: "CUIT", numero: "20000000001" },
  cae: "70417054367476",
};

const CAMPOS = [
  "ver",
  "fecha",
  "cuit",
  "ptoVta",
  "tipoCmp",
  "nroCmp",
  "importe",
  "moneda",
  "ctz",
  "tipoDocRec",
  "nroDocRec",
  "tipoCodAut",
  "codAut",
];

const json = (datos: DatosParaQr) => {
  const r = jsonDelQr(datos);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

describe("QR de ARCA: el JSON", () => {
  it("el ejemplo, campo por campo y en el orden de la especificación", () => {
    expect(json(EJEMPLO)).toBe(
      '{"ver":1,"fecha":"2020-10-13","cuit":30000000007,"ptoVta":10,"tipoCmp":1,"nroCmp":94,"importe":12100,"moneda":"PES","ctz":1,"tipoDocRec":80,"nroDocRec":20000000001,"tipoCodAut":"E","codAut":70417054367476}',
    );
    expect(Object.keys(JSON.parse(json(EJEMPLO)) as object)).toEqual(CAMPOS);
  });

  it("el importe sale en decimal mínimo, desde centavos y sin ceros de más", () => {
    const importe = (monto: string) =>
      (
        JSON.parse(json({ ...EJEMPLO, total: importeDesdeTexto(ARS, monto) })) as {
          importe: number;
        }
      ).importe;
    const texto = (monto: string) =>
      /"importe":([0-9.]+),/.exec(json({ ...EJEMPLO, total: importeDesdeTexto(ARS, monto) }))?.[1];
    expect(texto("12100.00")).toBe("12100");
    expect(texto("2260.50")).toBe("2260.5");
    expect(texto("2260.55")).toBe("2260.55");
    expect(texto("0.05")).toBe("0.05");
    expect(texto("0.10")).toBe("0.1");
    expect(texto("100.00")).toBe("100");
    expect(texto("10.00")).toBe("10");
    expect(texto("1000.10")).toBe("1000.1");
    expect(texto("9999999999999.99")).toBe("9999999999999.99");
    expect(importe("0.01")).toBe(0.01);
  });

  it("el consumidor final sin identificar va como documento 99 y número 0", () => {
    const j = JSON.parse(json({ ...EJEMPLO, documento: { tipo: "SIN_IDENTIFICAR" } })) as Record<
      string,
      unknown
    >;
    expect([j["tipoDocRec"], j["nroDocRec"]]).toEqual([99, 0]);
  });

  it("DNI y los otros documentos con su código", () => {
    const j = (documento: DatosParaQr["documento"]) =>
      JSON.parse(json({ ...EJEMPLO, documento })) as Record<string, unknown>;
    expect([
      j({ tipo: "DNI", numero: "12345678" })["tipoDocRec"],
      j({ tipo: "DNI", numero: "12345678" })["nroDocRec"],
    ]).toEqual([96, 12345678]);
    expect(j({ tipo: "CUIL", numero: CUIT_C })["tipoDocRec"]).toBe(86);
    expect(j({ tipo: "CDI", numero: CUIT_C })["tipoDocRec"]).toBe(87);
    expect(j({ tipo: "PASAPORTE", numero: "123" })["tipoDocRec"]).toBe(94);
  });

  it("los números largos salen sin ceros a la izquierda (un entero con ceros no es JSON)", () => {
    const j = json({ ...EJEMPLO, cuit: cuit("01000000007"), cae: "00000000000012" });
    expect(j).toContain('"cuit":1000000007,');
    expect(j).toContain('"codAut":12}');
    expect(JSON.parse(j) as unknown).toMatchObject({ cuit: 1000000007, codAut: 12 });
  });

  it("el código del tipo de comprobante, el punto de venta y el número", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const j = JSON.parse(
        json({ ...EJEMPLO, tipo, puntoDeVenta: 99999, numero: 99999999n }),
      ) as Record<string, unknown>;
      expect([j["tipoCmp"], j["ptoVta"], j["nroCmp"]]).toEqual([
        CODIGO_DE_TIPO_DE_COMPROBANTE[tipo],
        99999,
        99999999,
      ]);
    }
  });

  it("el CAE tiene que ser de 14 dígitos", () => {
    for (const cae of [
      "",
      "7041705436747",
      "704170543674760",
      "7041705436747a",
      " 70417054367476",
      "7041705436747.",
      "-0417054367476",
    ]) {
      expect(jsonDelQr({ ...EJEMPLO, cae }), cae).toEqual({ ok: false, error: "CAE_INVALIDO" });
    }
  });
});

describe("QR de ARCA: la URL", () => {
  const url = (datos: DatosParaQr, base?: string) => {
    const r = base === undefined ? urlDelQr(datos) : urlDelQr(datos, base);
    if (!r.ok) throw new Error(r.error);
    return r.valor;
  };

  it("golden: `{URL}?p={JSON en base64}` del ejemplo", () => {
    // base64 calculado aparte con la herramienta `base64` del sistema, no con el código
    expect(url(EJEMPLO)).toBe(
      "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjoyMDAwMDAwMDAwMSwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjcwNDE3MDU0MzY3NDc2fQ==",
    );
  });

  it("golden: factura B a consumidor final con importe con decimales", async () => {
    const datos: DatosParaQr = {
      fecha: fecha("2026-10-13"),
      cuit: CUIT_B,
      puntoDeVenta: 1,
      tipo: "FACTURA_B",
      numero: 11n,
      total: importeDesdeTexto(ARS, "2260.50"),
      documento: { tipo: "SIN_IDENTIFICAR" },
      cae: "70417054367476",
    };
    await expect(url(datos)).toMatchFileSnapshot("./golden/qr-factura-b.golden.txt");
    expect(url(datos)).toBe(
      "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMC0xMyIsImN1aXQiOjMwNzA4NTMzOTM1LCJwdG9WdGEiOjEsInRpcG9DbXAiOjYsIm5yb0NtcCI6MTEsImltcG9ydGUiOjIyNjAuNSwibW9uZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo5OSwibnJvRG9jUmVjIjowLCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6NzA0MTcwNTQzNjc0NzZ9",
    );
  });

  it("el base64 decodifica al JSON exacto", () => {
    const u = url(EJEMPLO);
    const base64 = u.slice(u.indexOf("?p=") + 3);
    expect(atob(base64)).toBe(json(EJEMPLO));
  });

  it("la URL base se puede cambiar sin tocar el armado", () => {
    expect(
      url(EJEMPLO, "https://www.arca.gob.ar/fe/qr/").startsWith(
        "https://www.arca.gob.ar/fe/qr/?p=",
      ),
    ).toBe(true);
    expect(URL_BASE_DEL_QR).toBe("https://www.afip.gob.ar/fe/qr/");
  });

  it("un CAE inválido no arma URL", () => {
    expect(urlDelQr({ ...EJEMPLO, cae: "123" })).toEqual({ ok: false, error: "CAE_INVALIDO" });
  });
});
