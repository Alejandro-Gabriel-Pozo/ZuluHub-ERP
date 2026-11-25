import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDeTomarElCosto,
  facturaUnicaDeLaLinea,
  leerMotivoDelCostoTomado,
  leerTomarElCosto,
  motivoDelCostoTomado,
} from "./costo-de-la-factura";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

const CLAVE = "11111111-1111-4111-8111-111111111111";
const RECEPCION = "22222222-2222-4222-8222-222222222222";
const FACTURA = "33333333-3333-4333-8333-333333333333";
const OTRA_FACTURA = "44444444-4444-4444-8444-444444444444";

describe("leerTomarElCosto", () => {
  it("lee un pedido válido y no deja pasar nada más que lo declarado", () => {
    const r = leerTomarElCosto({
      clave: CLAVE,
      recepcionId: RECEPCION,
      linea: 2,
      precio: "999",
      motivo: "otro",
    });
    expect(r).toEqual({ ok: true, valor: { clave: CLAVE, recepcionId: RECEPCION, linea: 2 } });
  });

  it("acepta la primera y la última línea posible", () => {
    for (const linea of [1, MAXIMO_DE_RENGLONES_DE_UNA_COMPRA]) {
      expect(leerTomarElCosto({ clave: CLAVE, recepcionId: RECEPCION, linea }).ok).toBe(true);
    }
  });

  it.each([
    ["sin nada", undefined],
    ["un texto", "x"],
    ["una lista", [CLAVE]],
    ["null", null],
  ])("rechaza un pedido que no es un objeto (%s)", (_n, valor) => {
    expect(leerTomarElCosto(valor)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
  });

  it.each([
    ["clave que no es UUID", { clave: "abc", recepcionId: RECEPCION, linea: 1 }],
    ["clave que no es texto", { clave: 5, recepcionId: RECEPCION, linea: 1 }],
    ["recepción que no es UUID", { clave: CLAVE, recepcionId: "abc", linea: 1 }],
    ["recepción que no es texto", { clave: CLAVE, recepcionId: 7, linea: 1 }],
  ])("rechaza %s", (_n, valor) => {
    expect(leerTomarElCosto(valor)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
  });

  it.each([
    ["cero", 0],
    ["negativa", -1],
    ["decimal", 1.5],
    ["texto", "1"],
    ["pasada del máximo", MAXIMO_DE_RENGLONES_DE_UNA_COMPRA + 1],
    ["infinita", Number.POSITIVE_INFINITY],
    ["ausente", undefined],
  ])("rechaza una línea %s", (_n, linea) => {
    expect(leerTomarElCosto({ clave: CLAVE, recepcionId: RECEPCION, linea })).toEqual({
      ok: false,
      error: "LINEA_NO_ENCONTRADA",
    });
  });
});

describe("camposDeHuellaDeTomarElCosto", () => {
  it("lleva la recepción y la línea, y no la clave", () => {
    expect(
      camposDeHuellaDeTomarElCosto({ clave: CLAVE, recepcionId: RECEPCION, linea: 3 }),
    ).toEqual([RECEPCION, 3]);
  });
});

describe("el motivo del costo tomado", () => {
  it("es un código con la factura y la línea, y se lee de vuelta", () => {
    const motivo = motivoDelCostoTomado({ comprobanteId: FACTURA, lineaDeFactura: 12 });
    expect(motivo).toBe(`COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:12`);
    expect(leerMotivoDelCostoTomado(motivo)).toEqual({
      comprobanteId: FACTURA,
      lineaDeFactura: 12,
    });
  });

  it("entra en lo que la base acepta como texto de catálogo (sin guion bajo)", () => {
    expect(motivoDelCostoTomado({ comprobanteId: FACTURA, lineaDeFactura: 1 })).toMatch(
      /^[A-Za-z][A-Za-z0-9 .,&/()°:;"#-]*$/,
    );
  });

  it.each([
    ["otro texto", "Error de carga"],
    ["sin línea", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}`],
    ["línea cero", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:0`],
    ["línea con ceros a la izquierda", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:01`],
    ["línea de siete cifras", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:1234567`],
    ["línea con signo", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:-1`],
    ["id que no es UUID", "COSTO-TOMADO-DE-LA-FACTURA:abc:1"],
    [
      "id en mayúsculas",
      `COSTO-TOMADO-DE-LA-FACTURA:${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase()}:1`,
    ],
    ["con un agregado antes", `x COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:1`],
    ["con un agregado después", `COSTO-TOMADO-DE-LA-FACTURA:${FACTURA}:1 x`],
    ["con otra palabra clave", `COSTO-TOMADO-DE-OTRA-FACTURA:${FACTURA}:1`],
    ["vacío", ""],
  ])("no lee como costo tomado %s", (_n, motivo) => {
    expect(leerMotivoDelCostoTomado(motivo)).toBeNull();
  });
});

describe("facturaUnicaDeLaLinea", () => {
  const vigente = (comprobanteId: string, lineaDeFactura: number, cantidad: string) => ({
    comprobanteId,
    lineaDeFactura,
    cantidad,
  });

  it("devuelve la línea de la factura cuando toda la línea recibida está conciliada con una sola", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [vigente(FACTURA, 1, "60.0000")],
      }),
    ).toEqual({ ok: true, valor: { comprobanteId: FACTURA, lineaDeFactura: 1 } });
  });

  it("junta varias asignaciones de la misma línea de la misma factura", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [vigente(FACTURA, 2, "25.0000"), vigente(FACTURA, 2, "35.0000")],
      }),
    ).toEqual({ ok: true, valor: { comprobanteId: FACTURA, lineaDeFactura: 2 } });
  });

  it("no hay costo si lo conciliado no llega a lo recibido", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "50.0000",
        vigentes: [vigente(FACTURA, 1, "50.0000")],
      }),
    ).toEqual({ ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" });
  });

  it("no hay costo si no se concilió nada", () => {
    expect(
      facturaUnicaDeLaLinea({ recibida: "60.0000", asignada: "0.0000", vigentes: [] }),
    ).toEqual({ ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" });
  });

  it("una línea recibida en cero no se toma", () => {
    expect(facturaUnicaDeLaLinea({ recibida: "0.0000", asignada: "0.0000", vigentes: [] })).toEqual(
      { ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" },
    );
  });

  it.each([
    ["recibida ilegible", "x", "60.0000"],
    ["asignada ilegible", "60.0000", "x"],
  ])("cierra con %s", (_n, recibida, asignada) => {
    expect(
      facturaUnicaDeLaLinea({ recibida, asignada, vigentes: [vigente(FACTURA, 1, "60.0000")] }),
    ).toEqual({ ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" });
  });

  it("cierra si las asignaciones vigentes no suman lo asignado", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [vigente(FACTURA, 1, "40.0000")],
      }),
    ).toEqual({ ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" });
  });

  it("una cantidad vigente ilegible o en cero no suma", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [
          vigente(FACTURA, 1, "60.0000"),
          vigente(FACTURA, 1, "0.0000"),
          vigente(FACTURA, 1, "x"),
        ],
      }),
    ).toEqual({ ok: true, valor: { comprobanteId: FACTURA, lineaDeFactura: 1 } });
  });

  it("con dos líneas de la misma factura no hay un único precio", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [vigente(FACTURA, 1, "30.0000"), vigente(FACTURA, 2, "30.0000")],
      }),
    ).toEqual({ ok: false, error: "COSTO_SIN_FACTURA_UNICA" });
  });

  it("con la misma línea de dos facturas tampoco", () => {
    expect(
      facturaUnicaDeLaLinea({
        recibida: "60.0000",
        asignada: "60.0000",
        vigentes: [vigente(FACTURA, 1, "30.0000"), vigente(OTRA_FACTURA, 1, "30.0000")],
      }),
    ).toEqual({ ok: false, error: "COSTO_SIN_FACTURA_UNICA" });
  });

  it("sin asignaciones vigentes pero con lo asignado igual a lo recibido no hay de dónde tomar", () => {
    expect(
      facturaUnicaDeLaLinea({ recibida: "60.0000", asignada: "60.0000", vigentes: [] }),
    ).toEqual({ ok: false, error: "LINEA_NO_CONCILIADA_ENTERA" });
  });
});
