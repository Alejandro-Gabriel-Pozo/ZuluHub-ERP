import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatearDecimalFijo } from "../../src/primitivas/cantidad/decimal-fijo";
import { ErrorDeValor } from "../../src/primitivas/cantidad/errores";
import {
  importeATexto,
  importeDesdeTexto,
  importesIguales,
  restar,
  sumar,
} from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import {
  exactoDeImporte,
  restarExactos,
  sumarExactos,
  type MontoExacto,
} from "../../src/primitivas/dinero/monto-exacto";
import { prorratear } from "../../src/primitivas/dinero/prorrateo";
import { redondear, type Politica } from "../../src/primitivas/dinero/redondeo";
import {
  importeArbitrario,
  importeChico,
  montoExactoArbitrario,
  pesoArbitrario,
} from "./generadores";
import "./configuracion";

const politicas: readonly Politica[] = ["MITAD_SUBE_SIMETRICA", "MITAD_PAR"];
const cero = exactoDeImporte(importeDesdeTexto(ARS, "0"));

function codigoDe(accion: () => unknown): string | undefined {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
  return undefined;
}

/** Oráculo independiente: fracciones con bigint, sin reducir y sin usar el código bajo prueba. */
type Fraccion = { n: bigint; d: bigint };
const fraccion = (m: MontoExacto): Fraccion => ({ n: m.numerador, d: m.denominador });
const sumaDe = (fs: Fraccion[]): Fraccion =>
  fs.reduce((a, f) => ({ n: a.n * f.d + f.n * a.d, d: a.d * f.d }), { n: 0n, d: 1n });
const piso = (n: bigint, d: bigint): bigint => (n >= 0n ? n / d : -((-n + d - 1n) / d));

describe("P-D1 y P-D2: prorratear", () => {
  const casos = fc.record({
    total: importeArbitrario,
    pesos: fc.array(pesoArbitrario, { minLength: 1, maxLength: 12 }),
  });

  it("P-D1: la suma de las partes es exactamente el total", () => {
    fc.assert(
      fc.property(casos, ({ total, pesos }) => {
        const positivos = pesos.some((p) => p.numerador > 0n);
        fc.pre(positivos || total.unidades === 0n);
        const partes = prorratear(total, pesos);
        const suma = partes.reduce(sumar, importeDesdeTexto(ARS, "0"));
        expect(partes).toHaveLength(pesos.length);
        expect(importesIguales(suma, total)).toBe(true);
      }),
    );
  });

  it("P-D2: cada parte es el piso o el techo de su parte exacta, y es determinista", () => {
    fc.assert(
      fc.property(casos, ({ total, pesos }) => {
        const suma = sumaDe(pesos.map(fraccion));
        fc.pre(suma.n > 0n);
        const partes = prorratear(total, pesos);
        expect(prorratear(total, pesos).map((p) => p.unidades)).toEqual(
          partes.map((p) => p.unidades),
        );
        pesos.forEach((peso, i) => {
          // parte exacta = total × (n/d) / (SN/SD) = total × n × SD / (d × SN)
          const base = piso(total.unidades * peso.numerador * suma.d, peso.denominador * suma.n);
          const parte = partes[i]?.unidades;
          expect([base, base + 1n]).toContain(parte);
        });
      }),
    );
  });

  it("P-D2: con pesos iguales los centavos sobrantes van a los primeros, por orden", () => {
    fc.assert(
      fc.property(importeArbitrario, fc.integer({ min: 1, max: 20 }), (total, cuantos) => {
        const iguales = Array.from({ length: cuantos }, () =>
          exactoDeImporte(importeDesdeTexto(ARS, "1")),
        );
        const unidades = prorratear(total, iguales).map((p) => p.unidades);
        expect(unidades).toEqual([...unidades].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)));
        expect(unidades[0]! - unidades[unidades.length - 1]!).toBeLessThanOrEqual(1n);
      }),
    );
  });
});

describe("P-D4: el total no depende del orden ni de la agrupación", () => {
  const lista = fc.array(montoExactoArbitrario, { minLength: 0, maxLength: 12 });

  it("asociatividad y conmutatividad de la suma exacta", () => {
    fc.assert(
      fc.property(
        montoExactoArbitrario,
        montoExactoArbitrario,
        montoExactoArbitrario,
        (a, b, c) => {
          expect(sumarExactos(sumarExactos(a, b), c)).toEqual(sumarExactos(a, sumarExactos(b, c)));
          expect(sumarExactos(a, b)).toEqual(sumarExactos(b, a));
        },
      ),
    );
  });

  it("el total redondeado una vez es el mismo en cualquier orden", () => {
    fc.assert(
      fc.property(lista, fc.infiniteStream(fc.nat()), (montos, azar) => {
        const barajados = [...montos];
        const iterador = azar[Symbol.iterator]();
        for (let i = barajados.length - 1; i > 0; i--) {
          const j = iterador.next().value % (i + 1);
          [barajados[i], barajados[j]] = [barajados[j]!, barajados[i]!];
        }
        const total = (ms: MontoExacto[]) => ms.reduce(sumarExactos, cero);
        for (const politica of politicas) {
          expect(
            importesIguales(
              redondear(total(montos), politica),
              redondear(total(barajados), politica),
            ),
          ).toBe(true);
        }
      }),
    );
  });
});

describe("P-D5 y P-D6: redondear", () => {
  it("queda a no más de medio centavo del exacto", () => {
    fc.assert(
      fc.property(montoExactoArbitrario, (m) => {
        for (const politica of politicas) {
          const r = redondear(m, politica).unidades;
          const distanciaDoble = (r * m.denominador - m.numerador) * 2n;
          expect(distanciaDoble < 0n ? -distanciaDoble : distanciaDoble).toBeLessThanOrEqual(
            m.denominador,
          );
        }
      }),
    );
  });

  it("es monótono", () => {
    fc.assert(
      fc.property(montoExactoArbitrario, montoExactoArbitrario, (a, b) => {
        const [menor, mayor] =
          a.numerador * b.denominador <= b.numerador * a.denominador ? [a, b] : [b, a];
        for (const politica of politicas) {
          expect(redondear(menor, politica).unidades).toBeLessThanOrEqual(
            redondear(mayor, politica).unidades,
          );
        }
      }),
    );
  });

  it("redondear(exacto(i)) = i para todo importe", () => {
    fc.assert(
      fc.property(importeArbitrario, (i) => {
        for (const politica of politicas) {
          expect(importesIguales(redondear(exactoDeImporte(i), politica), i)).toBe(true);
        }
      }),
    );
  });

  it("P-D6: la política vigente es simétrica: redondear(−x) = −redondear(x)", () => {
    fc.assert(
      fc.property(montoExactoArbitrario, (m) => {
        const negado = restarExactos(cero, m);
        expect(redondear(negado, "MITAD_SUBE_SIMETRICA").unidades).toBe(
          -redondear(m, "MITAD_SUBE_SIMETRICA").unidades,
        );
      }),
    );
  });
});

describe("P-D9: texto ↔ Importe", () => {
  const canonico = fc
    .bigInt({ min: -(10n ** 18n - 1n), max: 10n ** 18n - 1n })
    .map((u) => formatearDecimalFijo(u, 2));

  it("la ida y vuelta es la identidad sobre la forma canónica", () => {
    fc.assert(
      fc.property(canonico, (texto) => {
        expect(importeATexto(importeDesdeTexto(ARS, texto))).toBe(texto);
      }),
    );
  });

  it("más decimales que la moneda se rechaza siempre", () => {
    fc.assert(
      fc.property(importeChico, fc.stringMatching(/^[0-9]{1,6}$/), (i, extra) => {
        const texto = `${importeATexto(i)}${extra}`;
        expect(codigoDe(() => importeDesdeTexto(ARS, texto))).toBe("DECIMALES_DE_MAS");
      }),
    );
  });

  it("coma, espacios, notación científica, signo + y NaN se rechazan", () => {
    fc.assert(
      fc.property(importeChico, (i) => {
        const texto = importeATexto(i);
        const variantes = [
          texto.replace(".", ","),
          ` ${texto}`,
          `${texto} `,
          `+${texto}`,
          `${texto}e0`,
          `${texto}\n`,
          `0${texto}`,
        ];
        for (const variante of variantes) {
          if (variante === `0${texto}` && texto.startsWith("0.")) continue;
          expect(codigoDe(() => importeDesdeTexto(ARS, variante))).toBe("FORMATO_INVALIDO");
        }
      }),
    );
    for (const texto of ["NaN", "Infinity", "-Infinity", "1e5", "0x10", "1_000.00"]) {
      expect(codigoDe(() => importeDesdeTexto(ARS, texto))).toBe("FORMATO_INVALIDO");
    }
  });
});

describe("P-D10: monedas", () => {
  it("sumar o restar importes de monedas distintas es un error", () => {
    fc.assert(
      fc.property(importeChico, importeChico, (a, b) => {
        const dolares = { ...b, moneda: "USD" } as unknown as typeof b;
        expect(codigoDe(() => sumar(a, dolares))).toBe("MONEDA_DISTINTA");
        expect(codigoDe(() => restar(a, dolares))).toBe("MONEDA_DISTINTA");
      }),
    );
  });
});
