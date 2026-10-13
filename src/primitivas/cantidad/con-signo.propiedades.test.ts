import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { cantidadATexto, cantidadDesdeTexto } from "./cantidad";
import { ErrorDeValor } from "./errores";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
  cantidadConSignoDesdeTexto,
  compararConSigno,
  multiplicarCantidades,
  negarConSigno,
  restarConSigno,
  sumarConSigno,
  valorAbsolutoDe,
  type CantidadConSigno,
} from "./con-signo";

/**
 * Propiedades de `CantidadConSigno` y `multiplicarCantidades`. El oráculo es aritmética `bigint`
 * escrita aparte, sobre unidades de 1e-4 y texto, sin pasar por la primitiva ni por `number`.
 */

const MAXIMO = 10n ** 18n - 1n;
const D = 10n ** 4n;

/** Unidades de 1e-4 en todo el rango, con los bordes bien representados. */
const unidadesConSigno = fc.oneof(
  fc.bigInt({ min: -MAXIMO, max: MAXIMO }),
  fc.bigInt({ min: -1000n, max: 1000n }),
  fc.constantFrom(MAXIMO, -MAXIMO, MAXIMO - 1n, 1n - MAXIMO, 0n),
);
const unidadesSinSigno = fc.oneof(
  fc.bigInt({ min: 0n, max: MAXIMO }),
  fc.bigInt({ min: 0n, max: 100_000_000n }),
  fc.constantFrom(MAXIMO, 0n, 1n),
);

/** Texto decimal canónico escrito a mano (sin la primitiva) para unidades de 1e-4. */
function textoDe(u: bigint): string {
  const negativo = u < 0n;
  const digitos = (negativo ? -u : u).toString().padStart(5, "0");
  return `${negativo ? "-" : ""}${digitos.slice(0, -4)}.${digitos.slice(-4)}`;
}

function conSigno(u: bigint): CantidadConSigno {
  const r = cantidadConSignoDesdeTexto(textoDe(u));
  if (!r.ok) throw new Error(`no parsea ${textoDe(u)}`);
  return r.valor;
}

function aUnidades(c: CantidadConSigno): bigint {
  const [entera = "", fraccion = ""] = cantidadConSignoATexto(c).replace("-", "").split(".");
  const u = BigInt(entera + fraccion);
  return cantidadConSignoATexto(c).startsWith("-") ? -u : u;
}

const enRango = (u: bigint) => u >= -MAXIMO && u <= MAXIMO;

describe("CantidadConSigno: texto", () => {
  it("ida y vuelta sin pérdida: texto → valor → texto y valor → texto → valor", () => {
    fc.assert(
      fc.property(unidadesConSigno, (u) => {
        const texto = textoDe(u);
        const r = cantidadConSignoDesdeTexto(texto);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(cantidadConSignoATexto(r.valor)).toBe(texto);
        expect(aUnidades(r.valor)).toBe(u);
      }),
    );
  });

  it("un texto con menos decimales se completa a 4 y vale lo mismo", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAXIMO / D, max: MAXIMO / D }), (entero) => {
        const r = cantidadConSignoDesdeTexto(entero.toString());
        expect(r.ok).toBe(true);
        if (r.ok) expect(aUnidades(r.valor)).toBe(entero * D);
      }),
    );
  });

  it("más de 4 decimales siempre se rechaza con DECIMALES_DE_MAS, nunca se redondea", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -999_999n, max: 999_999n }),
        fc.stringMatching(/^[0-9]{4}[1-9]$/),
        (entero, fraccion) => {
          const texto = `${entero}.${fraccion}`;
          const r = cantidadConSignoDesdeTexto(texto);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.codigo).toBe("DECIMALES_DE_MAS");
        },
      ),
    );
  });

  it("un valor fuera de rango siempre se rechaza con FUERA_DE_RANGO", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: MAXIMO + 1n, max: 10n ** 22n }), fc.boolean(), (u, negativo) => {
        const r = cantidadConSignoDesdeTexto(textoDe(negativo ? -u : u));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.codigo).toBe("FUERA_DE_RANGO");
      }),
    );
  });
});

describe("CantidadConSigno: suma y resta", () => {
  it("la suma es conmutativa y asociativa mientras todo quede en rango", () => {
    fc.assert(
      fc.property(unidadesConSigno, unidadesConSigno, unidadesConSigno, (a, b, c) => {
        const ab = sumarConSigno(conSigno(a), conSigno(b));
        const ba = sumarConSigno(conSigno(b), conSigno(a));
        expect(ab.ok).toBe(ba.ok);
        if (ab.ok && ba.ok) expect(aUnidades(ab.valor)).toBe(aUnidades(ba.valor));

        // (a + b) + c contra a + (b + c): solo cuando los dos agrupamientos quedan en rango.
        const izq = ab.ok ? sumarConSigno(ab.valor, conSigno(c)) : undefined;
        const bc = sumarConSigno(conSigno(b), conSigno(c));
        const der = bc.ok ? sumarConSigno(conSigno(a), bc.valor) : undefined;
        if (izq?.ok === true && der?.ok === true) {
          expect(aUnidades(izq.valor)).toBe(aUnidades(der.valor));
          expect(aUnidades(izq.valor)).toBe(a + b + c);
        }
      }),
    );
  });

  it("suma y resta son exactas dentro del rango y rechazan el desborde con FUERA_DE_RANGO", () => {
    fc.assert(
      fc.property(unidadesConSigno, unidadesConSigno, (a, b) => {
        const suma = sumarConSigno(conSigno(a), conSigno(b));
        const resta = restarConSigno(conSigno(a), conSigno(b));
        for (const [r, esperado] of [
          [suma, a + b],
          [resta, a - b],
        ] as const) {
          expect(r.ok).toBe(enRango(esperado));
          if (r.ok) expect(aUnidades(r.valor)).toBe(esperado);
          else expect(r.error.codigo).toBe("FUERA_DE_RANGO");
        }
      }),
    );
  });

  it("a − b = a + (−b) y (a + b) − b = a cuando no desborda", () => {
    fc.assert(
      fc.property(unidadesConSigno, unidadesConSigno, (a, b) => {
        const resta = restarConSigno(conSigno(a), conSigno(b));
        const conNegado = sumarConSigno(conSigno(a), negarConSigno(conSigno(b)));
        expect(resta.ok).toBe(conNegado.ok);
        if (resta.ok && conNegado.ok)
          expect(aUnidades(resta.valor)).toBe(aUnidades(conNegado.valor));
        const suma = sumarConSigno(conSigno(a), conSigno(b));
        if (suma.ok) {
          const vuelta = restarConSigno(suma.valor, conSigno(b));
          expect(vuelta.ok && aUnidades(vuelta.valor)).toBe(a);
        }
      }),
    );
  });
});

describe("CantidadConSigno: comparación, negación y valor absoluto", () => {
  it("comparar coincide con el orden de las unidades y es antisimétrica", () => {
    fc.assert(
      fc.property(unidadesConSigno, unidadesConSigno, (a, b) => {
        const esperado = a < b ? -1 : a > b ? 1 : 0;
        expect(compararConSigno(conSigno(a), conSigno(b))).toBe(esperado);
        expect(compararConSigno(conSigno(b), conSigno(a))).toBe(0 - esperado);
      }),
    );
  });

  it("negar dos veces devuelve el original, nunca desborda, y el módulo no es negativo", () => {
    fc.assert(
      fc.property(unidadesConSigno, (u) => {
        const c = conSigno(u);
        expect(aUnidades(negarConSigno(c))).toBe(-u);
        expect(aUnidades(negarConSigno(negarConSigno(c)))).toBe(u);
        const modulo = valorAbsolutoDe(c);
        expect(cantidadATexto(modulo)).toBe(textoDe(u < 0n ? -u : u));
        expect(aUnidades(cantidadConSignoDesdeCantidad(modulo))).toBe(u < 0n ? -u : u);
      }),
    );
  });
});

describe("multiplicarCantidades", () => {
  const cantidad = (u: bigint) => cantidadDesdeTexto(textoDe(u));
  const unidadesDe = (texto: string) => BigInt(texto.replace(".", ""));

  /** Mitad hacia arriba escrita de otra forma: piso((2p + D) / 2D). */
  const mitadSube = (p: bigint) => (2n * p + D) / (2n * D);
  /** Mitad al par: el más cercano; en la mitad exacta, el par. */
  function mitadPar(p: bigint): bigint {
    const piso = p / D;
    const resto = p % D;
    if (2n * resto < D) return piso;
    if (2n * resto > D) return piso + 1n;
    return piso % 2n === 0n ? piso : piso + 1n;
  }

  it("es exacta hasta 4 decimales: sin decimales sobrantes no hay redondeo", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 6n }),
        fc.constantFrom("MITAD_SUBE_SIMETRICA", "MITAD_PAR"),
        (a, enteroB, politica) => {
          // b entero: a (4 decimales) × b es exacto en 4 decimales.
          const r = multiplicarCantidades(cantidad(a), cantidad(enteroB * D), politica);
          expect(unidadesDe(cantidadATexto(r))).toBe(a * enteroB);
        },
      ),
    );
  });

  it("redondea la mitad hacia arriba, una sola vez, contra el oráculo", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        (a, b) => {
          const r = multiplicarCantidades(cantidad(a), cantidad(b), "MITAD_SUBE_SIMETRICA");
          expect(unidadesDe(cantidadATexto(r))).toBe(mitadSube(a * b));
        },
      ),
    );
  });

  it("la mitad exacta sube siempre: a × 0,5 con a impar en unidades", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 10n }), (k) => {
        // (2k+1) × 0,5 = k + 0,5 unidades → k + 1.
        const a = 2n * k + 1n;
        const r = multiplicarCantidades(
          cantidad(a),
          cantidadDesdeTexto("0.5"),
          "MITAD_SUBE_SIMETRICA",
        );
        expect(unidadesDe(cantidadATexto(r))).toBe(k + 1n);
      }),
    );
  });

  it("MITAD_PAR coincide con el oráculo y difiere de la otra solo en la mitad exacta con piso par", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        (a, b) => {
          const par = unidadesDe(
            cantidadATexto(multiplicarCantidades(cantidad(a), cantidad(b), "MITAD_PAR")),
          );
          const sube = unidadesDe(
            cantidadATexto(multiplicarCantidades(cantidad(a), cantidad(b), "MITAD_SUBE_SIMETRICA")),
          );
          expect(par).toBe(mitadPar(a * b));
          const p = a * b;
          const esMitad = (p % D) * 2n === D;
          expect(par === sube).toBe(!(esMitad && (p / D) % 2n === 0n));
        },
      ),
    );
  });

  it("conmuta, por uno no cambia, por cero da cero", () => {
    fc.assert(
      fc.property(
        unidadesSinSigno,
        unidadesSinSigno,
        fc.constantFrom("MITAD_SUBE_SIMETRICA", "MITAD_PAR"),
        (a, b, politica) => {
          const ab = textoOCodigo(() => multiplicarCantidades(cantidad(a), cantidad(b), politica));
          const ba = textoOCodigo(() => multiplicarCantidades(cantidad(b), cantidad(a), politica));
          expect(ab).toBe(ba);
          expect(
            cantidadATexto(multiplicarCantidades(cantidad(a), cantidadDesdeTexto("1"), politica)),
          ).toBe(textoDe(a));
          expect(
            cantidadATexto(multiplicarCantidades(cantidad(a), cantidadDesdeTexto("0"), politica)),
          ).toBe("0.0000");
        },
      ),
    );
  });

  it("un producto que redondea fuera de rango se rechaza (FUERA_DE_RANGO) y uno en rango no", () => {
    fc.assert(
      fc.property(unidadesSinSigno, unidadesSinSigno, (a, b) => {
        const esperadoEnRango = mitadSube(a * b) <= MAXIMO;
        const resultado = textoOCodigo(() =>
          multiplicarCantidades(cantidad(a), cantidad(b), "MITAD_SUBE_SIMETRICA"),
        );
        expect(resultado.startsWith("FUERA_DE_RANGO")).toBe(!esperadoEnRango);
      }),
    );
  });
});

/** Texto del resultado, o el código del error de valor si se rechazó. */
function textoOCodigo(accion: () => { unidades: bigint } & object): string {
  try {
    return textoDe(accion().unidades);
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
}
