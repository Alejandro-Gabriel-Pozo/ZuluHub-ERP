import { describe, expect, it } from "vitest";
import { empresaId } from "../primitivas/identificadores/marca";
import { importeDesdeTexto } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  armarAnonimizacionDePartesEnTx,
  crearCopiasDePartes,
  crearImpedimentosDeAnonimizacion,
  fuenteDeCuentaDelCliente,
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
  centros: Partial<Record<Sentido, readonly string[]>> = {},
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
const roto = new Error("tabla ilegible");

describe("la fuente del libro de saldos (decisión del dueño, 25/11/2026)", () => {
  it("sin saldo en ningún sentido ni centro no impide; mira total y centros de los dos sentidos, de esta empresa y esta parte", async () => {
    const llamadas: string[] = [];
    expect(await fuenteDeSaldoDelLibro(libroDe({}, {}, llamadas))(EMPRESA, PARTE)).toEqual([]);
    expect(llamadas).toEqual(
      ["A_COBRAR", "A_PAGAR"].flatMap((s) => [
        `total|${EMPRESA}|${PARTE}|${s}`,
        `centros|${EMPRESA}|${PARTE}|${s}`,
      ]),
    );
    expect(
      await fuenteDeSaldoDelLibro(libroDe({}, { A_COBRAR: ["0.00", "0.00"] }))(EMPRESA, PARTE),
    ).toEqual([]);
  });

  it.each([
    [{ A_COBRAR: "10.00" }, {}],
    [{ A_PAGAR: "-0.01" }, {}],
    [{ A_COBRAR: "5.00", A_PAGAR: "-3.00" }, {}],
    [{}, { A_COBRAR: ["10.00", "-10.00"] }],
    [{}, { A_PAGAR: ["10.00", "-10.00"] }],
  ] as const)(
    "el saldo %j o el de un centro %j lo impide, con un solo impedimento",
    async (total, centros) => {
      expect(await fuenteDeSaldoDelLibro(libroDe(total, centros))(EMPRESA, PARTE)).toEqual([SALDO]);
    },
  );

  it("falla CERRADO: si no puede leer el total o el desglose, la excepción sale", async () => {
    const sinTotal = { ...libroDe({}), saldoDeParte: () => Promise.reject(roto) };
    const sinDesglose = { ...libroDe({}), saldoPorCentroDeCosto: () => Promise.reject(roto) };
    await expect(fuenteDeSaldoDelLibro(sinTotal)(EMPRESA, PARTE)).rejects.toBe(roto);
    await expect(fuenteDeSaldoDelLibro(sinDesglose)(EMPRESA, PARTE)).rejects.toBe(roto);
  });
});

describe("la fuente de la cuenta corriente del cliente (CC-1)", () => {
  const CUENTA = { modulo: "cuenta_corriente", motivo: "CUENTA_CORRIENTE_DEL_CLIENTE" } as const;
  const conFicha = (ficha: object | null, vistas: string[] = []) => ({
    obtenerPorParte: (empresa: string, parte: string) => {
      vistas.push(`${empresa}|${parte}`);
      return Promise.resolve(ficha as never);
    },
  });

  it("sin ficha no impide; con una ficha, habilitada o suspendida, impide; pregunta por esta empresa y esta parte", async () => {
    const vistas: string[] = [];
    expect(await fuenteDeCuentaDelCliente(conFicha(null, vistas))(EMPRESA, PARTE)).toEqual([]);
    for (const estado of ["HABILITADA", "SUSPENDIDA"]) {
      expect(await fuenteDeCuentaDelCliente(conFicha({ estado }, vistas))(EMPRESA, PARTE)).toEqual([
        CUENTA,
      ]);
    }
    expect(vistas).toEqual(Array(3).fill(`${EMPRESA}|${PARTE}`));
  });

  it("falla cerrado: si no puede leer la ficha, la excepción sale", async () => {
    const roto = new Error("tabla ilegible");
    const lectura = { obtenerPorParte: () => Promise.reject(roto) };
    await expect(fuenteDeCuentaDelCliente(lectura)(EMPRESA, PARTE)).rejects.toBe(roto);
  });
});

describe("la lista de fuentes de impedimentos y los pasos de copia", () => {
  it("junta los impedimentos de todas las fuentes en orden, con la empresa y la parte; sin fuentes, nada; falla cerrado y corta", async () => {
    const vistos: string[] = [];
    const fuente = (n: string, d: readonly (typeof SALDO)[]) => (e: string, p: string) => {
      vistos.push(`${n}|${e}|${p}`);
      return Promise.resolve(d);
    };
    expect(await crearImpedimentosDeAnonimizacion([]).impedimentos(EMPRESA, PARTE)).toEqual([]);
    const todas = crearImpedimentosDeAnonimizacion([
      fuente("a", [SALDO]),
      fuente("b", []),
      fuente("c", [SALDO]),
    ]);
    expect(await todas.impedimentos(EMPRESA, PARTE)).toEqual([SALDO, SALDO]);
    expect(vistos).toEqual(["a", "b", "c"].map((n) => `${n}|${EMPRESA}|${PARTE}`));
    let corrio = false;
    const cortada = crearImpedimentosDeAnonimizacion([
      () => Promise.reject(roto),
      () => ((corrio = true), Promise.resolve([])),
    ]);
    await expect(cortada.impedimentos(EMPRESA, PARTE)).rejects.toBe(roto);
    expect(corrio).toBe(false);
  });

  it("las copias: sin pasos ok; corre los pasos en orden con empresa, parte y hora; el primero que falla corta", async () => {
    expect(await crearCopiasDePartes().anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(
      ok(null),
    );
    const vistos: string[] = [];
    const paso =
      (
        n: string,
        r = ok(null) as ReturnType<PasoDeCopiaDeParte> extends Promise<infer R> ? R : never,
      ): PasoDeCopiaDeParte =>
      (e, p, h) => (vistos.push(`${n}|${e}|${p}|${h.toISOString()}`), Promise.resolve(r));
    const falla = { tipo: "Check", restriccion: "alguna" } as const;
    expect(
      await crearCopiasDePartes([paso("a"), paso("b")]).anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA),
    ).toEqual(ok(null));
    expect(
      await crearCopiasDePartes([paso("c", err(falla)), paso("d")]).anonimizarCopiasEnTx(
        EMPRESA,
        PARTE,
        AHORA,
      ),
    ).toEqual(err(falla));
    expect(vistos).toEqual(
      ["a", "b", "c"].map((n) => `${n}|${EMPRESA}|${PARTE}|${AHORA.toISOString()}`),
    );
  });

  it("lo armado sobre la conexión lee el libro de saldos Y la ficha de cuenta corriente (las dos fuentes), y trae las copias (hoy ninguna: ok)", async () => {
    const tablasLeidas: string[] = [];
    const consulta: object = new Proxy(
      {},
      {
        get: (_, propiedad) =>
          propiedad === "executeTakeFirst"
            ? () => Promise.resolve(undefined)
            : propiedad === "execute"
              ? () => Promise.resolve([])
              : () => consulta,
      },
    );
    const tablas = {
      selectFrom: (tabla: string) => {
        tablasLeidas.push(tabla);
        return consulta;
      },
    };
    const conexion = { withTables: () => tablas } as unknown as Parameters<
      typeof armarAnonimizacionDePartesEnTx
    >[0];
    const { anonimizacionDePartes } = armarAnonimizacionDePartesEnTx(conexion);
    expect(await anonimizacionDePartes.impedimentos.impedimentos(EMPRESA, PARTE)).toEqual([]);
    expect(tablasLeidas).toContain("cuenta_del_cliente");
    expect(tablasLeidas.some((t) => t.startsWith("saldo_de_parte"))).toBe(true);
    expect(await anonimizacionDePartes.copias.anonimizarCopiasEnTx(EMPRESA, PARTE, AHORA)).toEqual(
      ok(null),
    );
  });
});
