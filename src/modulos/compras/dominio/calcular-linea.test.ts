import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularLinea, type EntradaDeLinea } from "./calcular-linea";

const base: EntradaDeLinea = {
  unidadBase: "KILOGRAMO",
  presentacion: null,
  unidadDeCompra: "KILOGRAMO",
  cantidadDeCompra: "10",
  pesoReal: null,
  precioPor: "UNIDAD",
  unidadDePrecio: "KILOGRAMO",
  precio: "100",
};
const con = (cambios: Partial<EntradaDeLinea>): EntradaDeLinea => ({ ...base, ...cambios });
const error = (e: EntradaDeLinea) => {
  const r = calcularLinea(e);
  return r.ok ? null : r.error;
};
const valor = (e: EntradaDeLinea) => {
  const r = calcularLinea(e);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

describe("calcularLinea: los cuatro casos de E9 §3.4", () => {
  it("2 cajas de peso variable (≈ 47 kg), 46,6 kg al pesar, cobra por kilo a $ 11.000", () => {
    expect(
      valor(
        con({
          presentacion: { cantidadEnBase: "23.5", dePesoVariable: true },
          cantidadDeCompra: "2",
          pesoReal: "46.6",
          precioPor: "UNIDAD",
          precio: "11000",
        }),
      ),
    ).toEqual({
      cantidadEnStock: "46.6000",
      importe: "512600.00",
      costoPorUnidadDeStock: "11000.000000",
    });
  });

  it("la misma caja, cobrada por caja (2 × $ 250.000): el importe no cambia con el peso", () => {
    expect(
      valor(
        con({
          presentacion: { cantidadEnBase: "23.5", dePesoVariable: true },
          cantidadDeCompra: "2",
          pesoReal: "46.6",
          precioPor: "PRESENTACION",
          unidadDePrecio: null,
          precio: "250000",
        }),
      ),
    ).toEqual({
      cantidadEnStock: "46.6000",
      importe: "500000.00",
      costoPorUnidadDeStock: "10729.613734",
    });
  });

  it("3 packs de 12 gaseosas, cobra por pack $ 21.600", () => {
    expect(
      valor({
        unidadBase: "UNIDAD",
        presentacion: { cantidadEnBase: "12", dePesoVariable: false },
        unidadDeCompra: "UNIDAD",
        cantidadDeCompra: "3",
        pesoReal: null,
        precioPor: "PRESENTACION",
        unidadDePrecio: null,
        precio: "21600",
      }),
    ).toEqual({
      cantidadEnStock: "36.0000",
      importe: "64800.00",
      costoPorUnidadDeStock: "1800.000000",
    });
  });

  it("2 bidones de 5 L, cobra por bidón $ 14.500", () => {
    expect(
      valor({
        unidadBase: "LITRO",
        presentacion: { cantidadEnBase: "5", dePesoVariable: false },
        unidadDeCompra: "LITRO",
        cantidadDeCompra: "2",
        pesoReal: null,
        precioPor: "PRESENTACION",
        unidadDePrecio: null,
        precio: "14500",
      }),
    ).toEqual({
      cantidadEnStock: "10.0000",
      importe: "29000.00",
      costoPorUnidadDeStock: "2900.000000",
    });
  });
});

describe("calcularLinea: unidades y conversiones", () => {
  it("sin presentación convierte exacto a la base (2,5 kg en una base de gramos)", () => {
    expect(
      valor(
        con({
          unidadBase: "GRAMO",
          unidadDeCompra: "KILOGRAMO",
          cantidadDeCompra: "2.5",
          unidadDePrecio: "KILOGRAMO",
          precio: "1000",
        }),
      ),
    ).toEqual({
      cantidadEnStock: "2500.0000",
      importe: "2500.00",
      costoPorUnidadDeStock: "1.000000",
    });
  });

  it("el precio por una unidad distinta de la base (por kilo con base en gramos)", () => {
    expect(
      valor(
        con({
          unidadBase: "GRAMO",
          unidadDeCompra: "GRAMO",
          cantidadDeCompra: "500",
          unidadDePrecio: "KILOGRAMO",
          precio: "8000",
        }),
      ),
    ).toMatchObject({
      cantidadEnStock: "500.0000",
      importe: "4000.00",
      costoPorUnidadDeStock: "8.000000",
    });
  });

  it("el peso real de una caja se escribe en la unidad de compra y entra en la base", () => {
    expect(
      valor(
        con({
          unidadBase: "GRAMO",
          unidadDeCompra: "KILOGRAMO",
          presentacion: { cantidadEnBase: "20000", dePesoVariable: true },
          cantidadDeCompra: "1",
          pesoReal: "19.5",
          unidadDePrecio: "KILOGRAMO",
          precio: "10",
        }),
      ),
    ).toMatchObject({ cantidadEnStock: "19500.0000", importe: "195.00" });
  });

  it("una conversión que no es exacta se rechaza, nunca se redondea", () => {
    expect(
      error(
        con({
          unidadBase: "TONELADA",
          unidadDeCompra: "GRAMO",
          cantidadDeCompra: "1",
          unidadDePrecio: "TONELADA",
        }),
      ),
    ).toBe("CONVERSION_NO_EXACTA");
  });

  it("otra dimensión: de compra, de precio", () => {
    expect(error(con({ unidadDeCompra: "LITRO" }))).toBe("DIMENSION_DISTINTA");
    expect(error(con({ unidadDePrecio: "LITRO" }))).toBe("DIMENSION_DISTINTA");
  });

  it("una cantidad fuera de rango se rechaza", () => {
    expect(
      error(
        con({
          unidadBase: "GRAMO",
          unidadDeCompra: "TONELADA",
          cantidadDeCompra: "99999999999999",
          unidadDePrecio: "GRAMO",
        }),
      ),
    ).toBe("FUERA_DE_RANGO");
    expect(
      error(
        con({
          presentacion: { cantidadEnBase: "9999999999", dePesoVariable: false },
          cantidadDeCompra: "9999999999",
          precioPor: "PRESENTACION",
        }),
      ),
    ).toBe("FUERA_DE_RANGO");
    expect(
      error(
        con({
          cantidadDeCompra: "99999999999999.9999",
          precio: "999999999999.999999",
          unidadDePrecio: "KILOGRAMO",
        }),
      ),
    ).toBe("FUERA_DE_RANGO");
  });

  it("la cantidad por presentación tiene que ser exacta a 4 decimales", () => {
    expect(
      error(
        con({
          presentacion: { cantidadEnBase: "0.0001", dePesoVariable: false },
          cantidadDeCompra: "0.5",
          precioPor: "PRESENTACION",
        }),
      ),
    ).toBe("CONVERSION_NO_EXACTA");
  });
});

describe("calcularLinea: bordes del rango y dimensión con presentación", () => {
  it("la cantidad máxima de numeric(18,4) entra exacta", () => {
    expect(
      valor(
        con({
          presentacion: { cantidadEnBase: "1", dePesoVariable: false },
          cantidadDeCompra: "99999999999999.9999",
          precioPor: "PRESENTACION",
          precio: null,
        }),
      ).cantidadEnStock,
    ).toBe("99999999999999.9999");
  });
  it("el costo máximo de numeric(18,6) entra; con presentación fija la unidad de compra también es de la dimensión del producto", () => {
    expect(
      valor(con({ cantidadDeCompra: "1", precio: "999999999999.999999" })).costoPorUnidadDeStock,
    ).toBe("999999999999.999999");
    expect(
      error(
        con({
          presentacion: { cantidadEnBase: "5", dePesoVariable: false },
          unidadDeCompra: "LITRO",
          precioPor: "PRESENTACION",
        }),
      ),
    ).toBe("DIMENSION_DISTINTA");
  });
});

describe("calcularLinea: peso real y cantidad", () => {
  const variable = { cantidadEnBase: "23.5", dePesoVariable: true } as const;
  it("peso variable sin pesar (o con un peso inválido o cero) no se confirma", () => {
    for (const pesoReal of [null, "0", "-1", "abc", ""]) {
      expect(
        error(con({ presentacion: variable, cantidadDeCompra: "2", pesoReal })),
        String(pesoReal),
      ).toBe("PESO_REAL_REQUERIDO");
    }
  });
  it("un peso real donde no corresponde se rechaza", () => {
    expect(error(con({ pesoReal: "5" }))).toBe("PESO_REAL_NO_CORRESPONDE");
    expect(
      error(
        con({
          presentacion: { cantidadEnBase: "5", dePesoVariable: false },
          pesoReal: "5",
          precioPor: "PRESENTACION",
        }),
      ),
    ).toBe("PESO_REAL_NO_CORRESPONDE");
  });
  it("la cantidad de compra tiene que ser mayor que cero y decimal exacto", () => {
    for (const cantidadDeCompra of ["0", "0.0000", "-1", "abc", "", "1.00001"]) {
      expect(error(con({ cantidadDeCompra })), cantidadDeCompra).toBe("CANTIDAD_INVALIDA");
    }
  });
  it("la cantidad de la presentación tiene que ser mayor que cero", () => {
    for (const cantidadEnBase of ["0", "x", ""]) {
      expect(
        error(
          con({
            presentacion: { cantidadEnBase, dePesoVariable: false },
            precioPor: "PRESENTACION",
          }),
        ),
        cantidadEnBase,
      ).toBe("PRESENTACION_INVALIDA");
    }
  });
  it("la cantidad se valida antes que la dimensión y que el precio", () => {
    expect(error(con({ cantidadDeCompra: "0", unidadDeCompra: "LITRO", precio: "x" }))).toBe(
      "CANTIDAD_INVALIDA",
    );
    expect(error(con({ unidadDeCompra: "LITRO", precio: "x" }))).toBe("DIMENSION_DISTINTA");
  });
});

describe("calcularLinea: precio", () => {
  it("sin precio: importe y costo null juntos, nunca cero, y la cantidad igual entra", () => {
    expect(valor(con({ precio: null }))).toEqual({
      cantidadEnStock: "10.0000",
      importe: null,
      costoPorUnidadDeStock: null,
    });
    expect(
      valor(con({ precio: null, precioPor: "PRESENTACION", unidadDePrecio: null })),
    ).toMatchObject({ importe: null });
  });
  it("un precio inválido o cero se rechaza", () => {
    for (const precio of ["0", "0.000000", "-1", "x", "", "1.1234567"]) {
      expect(error(con({ precio })), precio).toBe("PRECIO_INVALIDO");
    }
  });
  it("precio por presentación sin presentación, y por unidad sin unidad de precio", () => {
    expect(error(con({ precioPor: "PRESENTACION" }))).toBe("PRECIO_POR_INVALIDO");
    expect(error(con({ unidadDePrecio: null }))).toBe("UNIDAD_DE_PRECIO_REQUERIDA");
  });
  it("redondea una sola vez, la mitad se aleja del cero", () => {
    // 3 × 0,335 = 1,005 → 1,01; el costo sale de lo exacto: 1,005 / 3 = 0,335
    expect(valor(con({ cantidadDeCompra: "3", precio: "0.335" }))).toMatchObject({
      importe: "1.01",
      costoPorUnidadDeStock: "0.335000",
    });
    // 1 × 0,004999 = 0,004999 → 0,00 (no 0,01); 1 × 0,005 → 0,01
    expect(valor(con({ cantidadDeCompra: "1", precio: "0.004999" })).importe).toBe("0.00");
    expect(valor(con({ cantidadDeCompra: "1", precio: "0.005" })).importe).toBe("0.01");
  });
  it("el costo se redondea a 6 decimales desde lo exacto", () => {
    // 1 / 3 = 0,333333… ; 2 / 3 = 0,666667
    expect(
      valor(con({ cantidadDeCompra: "3", precioPor: "UNIDAD", precio: "0.01" })),
    ).toMatchObject({ importe: "0.03", costoPorUnidadDeStock: "0.010000" });
    const r = valor(
      con({
        presentacion: { cantidadEnBase: "3", dePesoVariable: false },
        cantidadDeCompra: "1",
        precioPor: "PRESENTACION",
        unidadDePrecio: null,
        precio: "2",
      }),
    );
    expect(r).toEqual({
      cantidadEnStock: "3.0000",
      importe: "2.00",
      costoPorUnidadDeStock: "0.666667",
    });
  });
  it("un importe o un costo que no entran en numeric(18) se rechazan", () => {
    expect(
      error(
        con({
          cantidadDeCompra: "99999999999999",
          precio: "99999999999.999999",
          unidadDePrecio: "KILOGRAMO",
        }),
      ),
    ).toBe("FUERA_DE_RANGO");
  });
  it("un costo enorme con un importe que sí entra queda fuera de rango", () => {
    expect(
      error({
        unidadBase: "TONELADA",
        presentacion: null,
        unidadDeCompra: "TONELADA",
        cantidadDeCompra: "0.0001",
        pesoReal: null,
        precioPor: "UNIDAD",
        unidadDePrecio: "GRAMO",
        precio: "999999999999.999999",
      }),
    ).toBe("FUERA_DE_RANGO");
  });
});

describe("calcularLinea: propiedades (R2)", () => {
  const entero = (min: number, max: number) => fc.integer({ min, max });
  it("el importe y el costo son los de la cuenta exacta, con un solo redondeo cada uno", () => {
    fc.assert(
      fc.property(
        entero(1, 1_000_000),
        entero(1, 1_000_000_000),
        (cantidadMilesimas, precioMillonesimos) => {
          const cantidad = `${Math.floor(cantidadMilesimas / 1000)}.${String(cantidadMilesimas % 1000).padStart(3, "0")}`;
          const precio = `${Math.floor(precioMillonesimos / 1_000_000)}.${String(precioMillonesimos % 1_000_000).padStart(6, "0")}`;
          const r = valor(con({ cantidadDeCompra: cantidad, precio }));
          // Cuenta exacta con bigint: precio × cantidad en centavos y costo = precio (la unidad de precio es la de stock)
          const exactoMicro = BigInt(precioMillonesimos) * BigInt(cantidadMilesimas); // millonésimos × milésimas
          const centavos = (exactoMicro * 100n * 2n + 10n ** 9n) / (2n * 10n ** 9n);
          expect(r.importe).toBe(`${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`);
          expect(r.costoPorUnidadDeStock).toBe(precio);
          expect(r.cantidadEnStock).toBe(
            `${Math.floor(cantidadMilesimas / 1000)}.${String(cantidadMilesimas % 1000).padStart(3, "0")}0`,
          );
        },
      ),
    );
  });
  it("con precio por presentación: importe = precio × cantidad de presentaciones, costo = importe / lo que entra", () => {
    fc.assert(
      fc.property(
        entero(1, 500),
        entero(1, 100),
        entero(1, 100_000_00),
        (cajas, porCaja, precioCentavos) => {
          const precio = `${Math.floor(precioCentavos / 100)}.${String(precioCentavos % 100).padStart(2, "0")}`;
          const r = valor({
            unidadBase: "UNIDAD",
            presentacion: { cantidadEnBase: String(porCaja), dePesoVariable: false },
            unidadDeCompra: "UNIDAD",
            cantidadDeCompra: String(cajas),
            pesoReal: null,
            precioPor: "PRESENTACION",
            unidadDePrecio: null,
            precio,
          });
          const total = BigInt(cajas) * BigInt(precioCentavos);
          expect(r.importe).toBe(`${total / 100n}.${String(total % 100n).padStart(2, "0")}`);
          expect(r.cantidadEnStock).toBe(`${cajas * porCaja}.0000`);
          // costo × cantidad se aleja del importe a lo sumo medio millonésimo por unidad
          const costo = BigInt((r.costoPorUnidadDeStock ?? "0").replace(".", ""));
          const diferencia = costo * BigInt(cajas * porCaja) * 100n - total * 1_000_000n;
          expect(diferencia < 0n ? -diferencia : diferencia).toBeLessThanOrEqual(
            BigInt(cajas * porCaja) * 50n,
          );
        },
      ),
    );
  });
});
