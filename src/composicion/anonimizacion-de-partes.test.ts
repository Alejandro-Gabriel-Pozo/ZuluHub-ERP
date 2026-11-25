import { describe, expect, it } from "vitest";
import { empresaId } from "../primitivas/identificadores/marca";
import { importeDesdeTexto } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  crearCopiasDePartes,
  crearImpedimentosPorSaldo,
  type PasoDeCopiaDeParte,
} from "./anonimizacion-de-partes";

const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const PARTE = "22222222-2222-4222-8222-222222222222";
const AHORA = new Date("2026-11-25T15:00:00Z");

type Sentido = "A_COBRAR" | "A_PAGAR";
const saldosDe = (porSentido: Partial<Record<Sentido, string>>, llamadas: string[] = []) => ({
  saldoDeParte: (empresa: string, parte: string, sentido: Sentido) => {
    llamadas.push(`${empresa}|${parte}|${sentido}`);
    return Promise.resolve(importeDesdeTexto(ARS, porSentido[sentido] ?? "0.00"));
  },
});

describe("lo que impide anonimizar: saldo distinto de cero (decisión del dueño, 25/11/2026)", () => {
  const IMPEDIDA = [{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }];

  it("sin saldo en ningún sentido no hay impedimentos (también una parte sin asientos)", async () => {
    const llamadas: string[] = [];
    const impedimentos = crearImpedimentosPorSaldo(saldosDe({}, llamadas));
    expect(await impedimentos.impedimentos(EMPRESA, PARTE)).toEqual([]);
    // Se miran los dos sentidos, de esta empresa y de esta parte.
    expect(llamadas).toEqual([`${EMPRESA}|${PARTE}|A_COBRAR`, `${EMPRESA}|${PARTE}|A_PAGAR`]);
  });

  it.each([
    ["A_COBRAR", "10.00"],
    ["A_PAGAR", "10.00"],
    ["A_COBRAR", "-0.01"],
    ["A_PAGAR", "-250.50"],
  ] as const)("el saldo %s de %s (en contra o a favor) lo impide", async (sentido, saldo) => {
    const impedimentos = crearImpedimentosPorSaldo(saldosDe({ [sentido]: saldo }));
    expect(await impedimentos.impedimentos(EMPRESA, PARTE)).toEqual(IMPEDIDA);
  });

  it("con saldo en los dos sentidos devuelve UN solo impedimento", async () => {
    const impedimentos = crearImpedimentosPorSaldo(
      saldosDe({ A_COBRAR: "5.00", A_PAGAR: "-3.00" }),
    );
    expect(await impedimentos.impedimentos(EMPRESA, PARTE)).toEqual(IMPEDIDA);
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
