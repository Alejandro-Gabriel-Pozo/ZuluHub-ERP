import { describe, expect, it } from "vitest";
import { empresaId } from "../primitivas/identificadores/marca";
import { importeDesdeTexto } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  armarAnonimizacionDePartesEnTx,
  crearCopiasDePartes,
  crearImpedimentosDeAnonimizacion,
  fuenteDeSaldoDelLibro,
  type PasoDeCopiaDeParte,
} from "./anonimizacion-de-partes";

const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const PARTE = "22222222-2222-4222-8222-222222222222";
const AHORA = new Date("2026-11-25T15:00:00Z");

type Sentido = "A_COBRAR" | "A_PAGAR";
type Fila = Partial<Record<Sentido, string>>;
/** Un libro de mentira: el saldo total y el desglose por centro de cada sentido; anota qué se le preguntó. */
const libroDe = (
  total: Fila,
  centros: Partial<Record<Sentido, string[]>> = {},
  llamadas: string[] = [],
) => ({
  saldoDeParte: (empresa: string, parte: string, sentido: Sentido) => {
    llamadas.push(`total|${empresa}|${parte}|${sentido}`);
    return Promise.resolve(importeDesdeTexto(ARS, total[sentido] ?? "0.00"));
  },
  saldoPorCentroDeCosto: (empresa: string, parte: string, sentido: Sentido) => {
    llamadas.push(`centros|${empresa}|${parte}|${sentido}`);
    return Promise.resolve(
      (centros[sentido] ?? []).map((importe, i) => ({
        centroDeCosto: `centro-${i}`,
        importe: importeDesdeTexto(ARS, importe),
      })),
    );
  },
});

const SALDO = { modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" } as const;

describe("la fuente del libro de saldos: saldo distinto de cero (decisión del dueño, 25/11/2026)", () => {
  it("sin saldo en ningún sentido ni centro no impide (también una parte sin asientos), y mira los dos sentidos, total y centros, de esta empresa y esta parte", async () => {
    const llamadas: string[] = [];
    const fuente = fuenteDeSaldoDelLibro(libroDe({}, {}, llamadas));
    expect(await fuente(EMPRESA, PARTE)).toEqual([]);
    expect(llamadas).toEqual([
      `total|${EMPRESA}|${PARTE}|A_COBRAR`,
      `centros|${EMPRESA}|${PARTE}|A_COBRAR`,
      `total|${EMPRESA}|${PARTE}|A_PAGAR`,
      `centros|${EMPRESA}|${PARTE}|A_PAGAR`,
    ]);
  });

  it("centros en cero (un desglose con ceros) tampoco impide", async () => {
    expect(
      await fuenteDeSaldoDelLibro(libroDe({}, { A_COBRAR: ["0.00", "0.00"], A_PAGAR: ["0.00"] }))(
        EMPRESA,
        PARTE,
      ),
    ).toEqual([]);
  });

  it.each([
    ["A_COBRAR", "10.00"],
    ["A_PAGAR", "10.00"],
    ["A_COBRAR", "-0.01"],
    ["A_PAGAR", "-250.50"],
  ] as const)("el saldo %s de %s (en contra o a favor) lo impide", async (sentido, saldo) => {
    expect(await fuenteDeSaldoDelLibro(libroDe({ [sentido]: saldo }))(EMPRESA, PARTE)).toEqual([
      SALDO,
    ]);
  });

  it.each(["A_COBRAR", "A_PAGAR"] as const)(
    "un saldo en un centro de costo lo impide aunque el total sea cero (+10 y −10 en dos centros), en %s",
    async (sentido) => {
      const fuente = fuenteDeSaldoDelLibro(libroDe({}, { [sentido]: ["10.00", "-10.00"] }));
      expect(await fuente(EMPRESA, PARTE)).toEqual([SALDO]);
    },
  );

  it("con saldo en los dos sentidos devuelve UN solo impedimento", async () => {
    const fuente = fuenteDeSaldoDelLibro(libroDe({ A_COBRAR: "5.00", A_PAGAR: "-3.00" }));
    expect(await fuente(EMPRESA, PARTE)).toEqual([SALDO]);
  });

  it("falla CERRADO: si no puede leer el total o el desglose, la excepción sale (no hay «no impide» por no poder mirar)", async () => {
    const roto = new Error("tabla ilegible");
    const sinTotal = { ...libroDe({}), saldoDeParte: () => Promise.reject(roto) };
    const sinDesglose = { ...libroDe({}), saldoPorCentroDeCosto: () => Promise.reject(roto) };
    await expect(fuenteDeSaldoDelLibro(sinTotal)(EMPRESA, PARTE)).rejects.toBe(roto);
    await expect(fuenteDeSaldoDelLibro(sinDesglose)(EMPRESA, PARTE)).rejects.toBe(roto);
  });
});

describe("la lista de fuentes de impedimentos", () => {
  const CUENTA = { modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" } as const;

  it("sin fuentes no impide nada", async () => {
    expect(await crearImpedimentosDeAnonimizacion([]).impedimentos(EMPRESA, PARTE)).toEqual([]);
  });

  it("junta los impedimentos de todas las fuentes, en orden, con la empresa y la parte", async () => {
    const vistos: string[] = [];
    const fuente =
      (nombre: string, devuelve: readonly (typeof CUENTA)[]) =>
      (empresa: string, parte: string) => {
        vistos.push(`${nombre}|${empresa}|${parte}`);
        return Promise.resolve(devuelve);
      };
    const impedimentos = crearImpedimentosDeAnonimizacion([
      fuente("a", [CUENTA]),
      fuente("b", []),
      fuente("c", [CUENTA]),
    ]);
    expect(await impedimentos.impedimentos(EMPRESA, PARTE)).toEqual([CUENTA, CUENTA]);
    expect(vistos).toEqual([
      `a|${EMPRESA}|${PARTE}`,
      `b|${EMPRESA}|${PARTE}`,
      `c|${EMPRESA}|${PARTE}`,
    ]);
  });

  it("falla cerrado: si una fuente no puede leer, la excepción sale y las que siguen no corren", async () => {
    const roto = new Error("no se pudo leer");
    let corrio = false;
    const impedimentos = crearImpedimentosDeAnonimizacion([
      () => Promise.reject(roto),
      () => {
        corrio = true;
        return Promise.resolve([]);
      },
    ]);
    await expect(impedimentos.impedimentos(EMPRESA, PARTE)).rejects.toBe(roto);
    expect(corrio).toBe(false);
  });
});

describe("las copias que se vacían junto con la parte", () => {
  it("sin pasos (hoy ninguno) no hay nada que vaciar y sale ok", async () => {
    expect(await crearCopiasDePartes().anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(
      ok(null),
    );
    expect(await crearCopiasDePartes([]).anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(
      ok(null),
    );
  });

  it("corre todos los pasos en orden con la empresa, la parte y la hora", async () => {
    const vistos: string[] = [];
    const paso =
      (nombre: string): PasoDeCopiaDeParte =>
      (empresa, parte, ahora) => {
        vistos.push(`${nombre}|${empresa}|${parte}|${ahora.toISOString()}`);
        return Promise.resolve(ok(null));
      };
    const copias = crearCopiasDePartes([paso("a"), paso("b")]);
    expect(await copias.anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(ok(null));
    expect(vistos).toEqual([
      `a|${EMPRESA}|${PARTE}|${AHORA.toISOString()}`,
      `b|${EMPRESA}|${PARTE}|${AHORA.toISOString()}`,
    ]);
  });

  it("el primer paso que falla corta: devuelve su error y los siguientes no corren", async () => {
    const vistos: string[] = [];
    const falla = { tipo: "Check", restriccion: "alguna" } as const;
    const copias = crearCopiasDePartes([
      () => {
        vistos.push("a");
        return Promise.resolve(ok(null));
      },
      () => {
        vistos.push("b");
        return Promise.resolve(err(falla));
      },
      () => {
        vistos.push("c");
        return Promise.resolve(ok(null));
      },
    ]);
    expect(await copias.anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(err(falla));
    expect(vistos).toEqual(["a", "b"]);
  });
});

describe("lo que se arma sobre la conexión de la transacción", () => {
  it("trae la fuente del libro de saldos (lee la base: si no puede, falla cerrado) y las copias (hoy ninguna: ok)", async () => {
    const ilegible = new Error("tabla de saldos ilegible");
    const tablas = {
      selectFrom: () => {
        throw ilegible;
      },
    };
    const conexion = { withTables: () => tablas } as unknown as Parameters<
      typeof armarAnonimizacionDePartesEnTx
    >[0];
    const { anonimizacionDePartes } = armarAnonimizacionDePartesEnTx(conexion);
    await expect(anonimizacionDePartes.impedimentos.impedimentos(EMPRESA, PARTE)).rejects.toBe(
      ilegible,
    );
    expect(await anonimizacionDePartes.copias.anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(
      ok(null),
    );
  });
});
