import { describe, expect, it } from "vitest";
import {
  anulacionTotal,
  aFacturaParaAnular,
  calcularLaAnulacion,
  escribirImporte,
  filasDeLaFactura,
  leerImporte,
  pasarAUnaParte,
  problemaDelMotivo,
  volverAlTotal,
  type EleccionDeAnulacion,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-anulacion";
import { conFactura, factura, facturaC } from "../utilidades/anulacion";

/**
 * El cálculo de la anulación por importe (12A, D-69): el total (por defecto) o un importe con IVA incluido por alícuota; la suma
 * exacta, el aviso sin bloqueo cuando se pasa de lo facturado en esa alícuota (D-72) y cuándo anda «Siguiente». Todo en texto decimal.
 */

const parte = (...escritos: [string, string][]): EleccionDeAnulacion =>
  escritos.reduce(
    (e, [clave, valor]) => escribirImporte(e, clave, valor),
    pasarAUnaParte(anulacionTotal),
  );

describe("leerImporte: texto decimal canónico o nada", () => {
  it.each([
    ["20000.50", "20000.50"],
    ["20000", "20000.00"],
    ["0.5", "0.50"],
    ["0", "0.00"],
    ["0.00", "0.00"],
  ])("«%s» es dinero", (escrito, canonico) => {
    expect(leerImporte(escrito)).not.toBeNull();
    expect(calcularLaAnulacion(factura, parte(["21", escrito])).aAnular).toBe(
      escrito === "0" || escrito === "0.00" ? "0.00" : canonico,
    );
  });

  it.each(["", " ", "abc", "-5", "-0.01", "1,5", "1.234", "1e3", "$ 100", "1.2.3", ".5", "5."])(
    "«%s» no es dinero",
    (escrito) => {
      expect(leerImporte(escrito)).toBeNull();
    },
  );
});

describe("anular el total: un renglón por alícuota con lo facturado en ella", () => {
  it("las partes son las alícuotas de la factura, con su total, y la suma es el total de la factura", () => {
    const c = calcularLaAnulacion(factura, anulacionTotal);
    expect(c.partes.map((p) => [p.fila.alicuota, p.fila.facturado])).toEqual([
      ["21", "60500.00"],
      ["10.5", "30250.00"],
    ]);
    expect(c.aAnular).toBe("90750.00");
    expect(c.sePuedeSeguir).toBe(true);
    expect(c.partes.every((p) => !p.superaLoFacturado)).toBe(true);
  });

  it("una sola alícuota: un solo renglón", () => {
    const f = conFactura({
      importes: { total: "121.00" },
      alicuotas: [{ alicuota: "21", total: "121.00" }],
    });
    expect(calcularLaAnulacion(f, anulacionTotal).partes).toHaveLength(1);
  });

  it("una alícuota sin importe (total cero) no entra a la nota", () => {
    const f = conFactura({
      alicuotas: [
        { alicuota: "21", total: "60500.00" },
        { alicuota: "27", total: "0.00" },
      ],
    });
    expect(calcularLaAnulacion(f, anulacionTotal).partes.map((p) => p.fila.alicuota)).toEqual([
      "21",
    ]);
  });

  it("letra C: un solo renglón sin alícuota por el total de la factura", () => {
    const c = calcularLaAnulacion(facturaC, anulacionTotal);
    expect(c.partes.map((p) => [p.fila.alicuota, p.fila.facturado])).toEqual([[null, "45000.00"]]);
    expect(c.aAnular).toBe("45000.00");
  });

  it("exento y no gravado se anulan con su código (el servidor sabe que no llevan IVA)", () => {
    const f = conFactura({
      alicuotas: [
        { alicuota: "EXENTO", total: "100.00" },
        { alicuota: "NO_GRAVADO", total: "50.00" },
      ],
    });
    expect(calcularLaAnulacion(f, anulacionTotal).partes.map((p) => p.fila.alicuota)).toEqual([
      "EXENTO",
      "NO_GRAVADO",
    ]);
  });

  it("lo escrito en una parte no cuenta si se vuelve al total, pero se conserva si se vuelve a la parte", () => {
    const e = volverAlTotal(parte(["21", "100.00"]));
    expect(calcularLaAnulacion(factura, e).aAnular).toBe("90750.00");
    expect(calcularLaAnulacion(factura, pasarAUnaParte(e)).aAnular).toBe("100.00");
  });
});

describe("anular solo una parte: un importe con IVA incluido por alícuota", () => {
  it("arranca vacía: no se puede seguir", () => {
    const c = calcularLaAnulacion(factura, pasarAUnaParte(anulacionTotal));
    expect(c).toMatchObject({
      partes: [],
      aAnular: "0.00",
      hayInvalidos: false,
      sePuedeSeguir: false,
    });
  });

  it("una alícuota con importe: solo esa va a la nota", () => {
    const c = calcularLaAnulacion(factura, parte(["10.5", "1500.50"]));
    expect(c.partes.map((p) => [p.fila.alicuota, p.importe.unidades])).toEqual([["10.5", 150050n]]);
    expect(c.aAnular).toBe("1500.50");
    expect(c.sePuedeSeguir).toBe(true);
  });

  it("varias alícuotas: la suma es exacta al centavo", () => {
    const c = calcularLaAnulacion(factura, parte(["21", "0.10"], ["10.5", "0.20"]));
    expect(c.aAnular).toBe("0.30");
    const grande = calcularLaAnulacion(
      factura,
      parte(["21", "9999999999999.99"], ["10.5", "0.01"]),
    );
    expect(grande.aAnular).toBe("10000000000000.00");
  });

  it("un importe en cero cuenta como vacío (no va a la nota); si todos son cero no se puede seguir", () => {
    const uno = calcularLaAnulacion(factura, parte(["21", "0.00"], ["10.5", "20.00"]));
    expect(uno.partes.map((p) => p.fila.alicuota)).toEqual(["10.5"]);
    expect(calcularLaAnulacion(factura, parte(["21", "0.00"])).sePuedeSeguir).toBe(false);
  });

  it("algo escrito que no es dinero frena, aunque haya otro bien", () => {
    const c = calcularLaAnulacion(factura, parte(["21", "-5"], ["10.5", "20.00"]));
    expect(c.hayInvalidos).toBe(true);
    expect(c.sePuedeSeguir).toBe(false);
  });

  it("D-72: pasarse de lo facturado en esa alícuota avisa en esa alícuota y NO bloquea; igual a lo facturado no avisa", () => {
    const c = calcularLaAnulacion(factura, parte(["21", "20000.00"], ["10.5", "40000.00"]));
    expect(c.partes.map((p) => [p.fila.clave, p.superaLoFacturado])).toEqual([
      ["21", false],
      ["10.5", true],
    ]);
    expect(c.sePuedeSeguir).toBe(true);
    expect(c.aAnular).toBe("60000.00");
    const justo = calcularLaAnulacion(factura, parte(["10.5", "30250.00"]));
    expect(justo.partes[0]?.superaLoFacturado).toBe(false);
    const centavo = calcularLaAnulacion(factura, parte(["10.5", "30250.01"]));
    expect(centavo.partes[0]?.superaLoFacturado).toBe(true);
  });

  it("no hay tope por lo ya anulado (D-11): con notas que ya suman todo, igual se puede seguir", () => {
    const f = conFactura({ acreditado: "90750.00" });
    expect(calcularLaAnulacion(f, parte(["21", "1.00"])).sePuedeSeguir).toBe(true);
  });

  it("letra C: un solo importe, sin alícuota; el aviso mira el total de la factura", () => {
    const c = calcularLaAnulacion(facturaC, parte(["C", "50000.00"]));
    expect(c.partes.map((p) => [p.fila.clave, p.fila.alicuota, p.superaLoFacturado])).toEqual([
      ["C", null, true],
    ]);
    expect(filasDeLaFactura(facturaC)).toHaveLength(1);
  });

  it("una clave que la factura no tiene se ignora (nunca se manda una alícuota ajena)", () => {
    expect(calcularLaAnulacion(factura, parte(["27", "10.00"])).partes).toEqual([]);
  });
});

describe("el motivo: obligatorio, sin espacios de borde, de hasta el límite del servidor", () => {
  it.each([
    ["", "VACIO"],
    ["   ", "VACIO"],
    ["\n\t ", "VACIO"],
    ["Se facturó de más", null],
    ["  con espacios  ", null],
    ["a".repeat(200), null],
    ["a".repeat(201), "LARGO"],
    [` ${"a".repeat(200)} `, null],
  ])("«%s»", (motivo, problema) => {
    expect(problemaDelMotivo(motivo, 200)).toBe(problema);
  });

  it("el límite es el que se pasa (el del servidor), no un 200 escrito acá", () => {
    expect(problemaDelMotivo("a".repeat(11), 10)).toBe("LARGO");
    expect(problemaDelMotivo("a".repeat(10), 10)).toBeNull();
  });
});

describe("la factura que viaja al navegador", () => {
  it("es una lista blanca: lo que la consulta agregue no pasa", () => {
    const conDemas = { ...factura, cae: "123", emisor: { cuit: "20" } } as typeof factura;
    expect(Object.keys(aFacturaParaAnular(conDemas)).sort()).toEqual(
      [
        "acreditado",
        "alicuotas",
        "concepto",
        "estado",
        "id",
        "importes",
        "notasQueLoCitan",
        "numero",
        "receptor",
        "servicio",
        "tipo",
      ].sort(),
    );
  });

  it("copia el período de un servicio", () => {
    const servicio = { desde: "2026-10-01", hasta: "2026-10-31", vencimientoDePago: "2026-11-10" };
    expect(aFacturaParaAnular(conFactura({ concepto: "SERVICIOS", servicio })).servicio).toEqual(
      servicio,
    );
  });
});
