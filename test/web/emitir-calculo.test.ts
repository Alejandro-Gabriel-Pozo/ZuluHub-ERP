import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularRenglones } from "../../src/modulos/fiscal/dominio/calculo-de-renglones";
import { cantidadDesdeTexto } from "../../src/primitivas/cantidad/cantidad";
import { importeATexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../src/primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../src/primitivas/dinero/redondeo";
import {
  calcularLaEmision,
  cantidadCanonica,
  conRenglon,
  idSiguiente,
  limpiarCantidad,
  renglonVacio,
  sinRenglon,
  type RenglonEscrito,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";

/**
 * Lo que la persona escribe en Emitir y lo que se calcula con eso (D-84, D-85). El total y el importe de cada renglón que muestra
 * «Revisar» son los que registra el servidor: el cálculo se compara con `calcularRenglones` del dominio (IVA incluido, sin descuento)
 * sobre entradas al azar. Previene: que la pantalla muestre $ 9.000,00 y la factura salga por otra cifra (un centavo de redondeo).
 */

const renglon = (cambios: Partial<RenglonEscrito> = {}): RenglonEscrito => ({
  ...renglonVacio(1),
  descripcion: "Medialunas",
  precio: "4500.00",
  ...cambios,
});

describe("la cantidad que se tipea", () => {
  it.each([
    ["2", "2"],
    ["1,5", "1,5"],
    ["1.5", "1,5"],
    ["0,125", "0,125"],
    ["1.000", "1000"],
    ["12.345.678", "12345678"],
    ["2,", "2,"],
    ["abc", ""],
    ["-3", "3"],
    ["007", "7"],
    ["0", "0"],
    ["1,23456", "1,2345"],
    ["1,2,3", "1,23"],
    ["", ""],
  ])("«%s» queda «%s»", (escrito, queda) => {
    expect(limpiarCantidad(escrito)).toBe(queda);
  });

  it("el texto decimal para el servidor: con punto, sin la coma final y vacío si no hay cantidad", () => {
    expect(cantidadCanonica("1,5")).toBe("1.5");
    expect(cantidadCanonica("2,")).toBe("2");
    expect(cantidadCanonica("1.000")).toBe("1000");
    expect(cantidadCanonica("")).toBe("");
    expect(cantidadCanonica("abc")).toBe("");
  });

  it("nunca pasa de los catorce enteros ni de los cuatro decimales de la primitiva (siempre es una cantidad válida)", () => {
    fc.assert(
      fc.property(fc.string(), (escrito) => {
        const canonica = cantidadCanonica(escrito);
        if (canonica !== "") expect(() => cantidadDesdeTexto(canonica)).not.toThrow();
      }),
    );
  });
});

describe("el cálculo de «Revisar»", () => {
  it("un renglón: 2 × $ 4.500,00 = $ 9.000,00", () => {
    expect(calcularLaEmision([renglon({ cantidad: "2" })])).toEqual({
      importes: ["9000.00"],
      total: "9000.00",
    });
  });

  it("el total se redondea UNA vez y se prorratea: los importes suman exactamente el total", () => {
    // 3 × 0,335 = 1,005 y 1 × 0,335 = 0,335: redondeados de a uno sumarían 1,01 + 0,34 = 1,35; el total es 1,34 + 0,01 de resto.
    const calculo = calcularLaEmision([
      renglon({ id: 1, cantidad: "3", precio: "0.335" }),
      renglon({ id: 2, cantidad: "1", precio: "0.335" }),
    ]);
    expect(calculo?.total).toBe("1.34");
    expect(calculo?.importes.join("+")).toBe("1.01+0.33");
  });

  it("sin renglones, o con uno sin cantidad o sin precio, no hay total", () => {
    expect(calcularLaEmision([])).toBeNull();
    expect(calcularLaEmision([renglon({ cantidad: "" })])).toBeNull();
    expect(calcularLaEmision([renglon({ precio: "" })])).toBeNull();
    expect(calcularLaEmision([renglon(), renglon({ id: 2, precio: "" })])).toBeNull();
  });

  it("un total que no entra como importe no revienta: no hay total (el servidor dice TOTAL_FUERA_DE_RANGO)", () => {
    expect(
      calcularLaEmision([renglon({ cantidad: "99999999999999", precio: "9999999999999999.99" })]),
    ).toBeNull();
  });

  it("coincide con el cálculo del dominio (`calcularRenglones`) en entradas al azar", () => {
    const cantidad = fc
      .tuple(fc.integer({ min: 0, max: 99999 }), fc.integer({ min: 0, max: 9999 }))
      .map(([e, d]) => `${e}.${String(d).padStart(4, "0")}`);
    const precio = fc
      .tuple(fc.integer({ min: 0, max: 99999999 }), fc.integer({ min: 0, max: 99 }))
      .map(([e, d]) => `${e}.${String(d).padStart(2, "0")}`);
    fc.assert(
      fc.property(fc.array(fc.tuple(cantidad, precio), { minLength: 1, maxLength: 6 }), (datos) => {
        const renglones = datos.map(([c, p], i) => renglon({ id: i + 1, cantidad: c, precio: p }));
        const mio = calcularLaEmision(renglones);
        const dominio = calcularRenglones(
          ARS,
          datos.map(([c, p]) => ({
            cantidad: cantidadDesdeTexto(c),
            precioUnitario: precioUnitarioDesdeTexto(p),
            descuento: null,
            alicuota: null,
          })),
          "IVA_INCLUIDO",
          POLITICA_VIGENTE,
        );
        // El dominio rechaza un total en cero o fuera de rango; la pantalla solo calcula, y esa validación es del servidor.
        if (!dominio.ok) return;
        expect(mio).toEqual({
          importes: dominio.valor.renglones.map(importeATexto),
          total: importeATexto(dominio.valor.total),
        });
      }),
    );
  });
});

describe("agregar y quitar renglones", () => {
  it("un renglón nuevo lleva un número que no repite el de uno quitado", () => {
    const uno = [renglonVacio(1), renglonVacio(2), renglonVacio(3)];
    const sin3 = sinRenglon(uno, 3);
    expect(idSiguiente(sin3)).toBe(3);
    expect(idSiguiente(sinRenglon(uno, 1))).toBe(4);
    expect(idSiguiente([])).toBe(1);
  });

  it("cambiar un renglón no toca los demás", () => {
    const lista = [renglonVacio(1), renglonVacio(2)];
    const nueva = conRenglon(lista, 2, { descripcion: "Café" });
    expect(nueva[0]).toBe(lista[0]);
    expect(nueva[1]?.descripcion).toBe("Café");
  });
});
