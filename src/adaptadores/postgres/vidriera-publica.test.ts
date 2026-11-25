import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../../primitivas/resultado/resultado";
import { TOPE_DE_CARTAS_DE_LA_RAIZ } from "../../puertos/vidriera-publica";
import { crearVidrieraPublica, type TxPublicaDeCarta } from "./vidriera-publica";

/**
 * `listarDelHost` sin base: el host compartido no toca nada, el dedicado pide las candidatas de SU empresa con el tope y un fallo de la base se lanza (no se disfraza de lista vacía).
 * Lo que las candidatas deben cumplir para listarse (sucursal abierta, plan, fuera de línea) lo prueba `test/integracion/carta-publica-raiz.test.ts` con la base real.
 */
const MARCA = "00000e01-0000-4000-8000-0000000000aa";
const EMPRESA = "00000e01-0000-4000-8000-0000000000bb";
const catalogos = { catalogoDeModulos: {}, catalogoDePerillas: {} } as never;
const reloj = { ahora: () => new Date("2026-11-25T12:00:00Z") };

function armar(candidatas: readonly string[] | "falla") {
  const pedidas: Array<{ empresa: string; tope: number }> = [];
  const leer = vi.fn(<T>(trabajo: (tx: TxPublicaDeCarta) => Promise<T>) => {
    if (candidatas === "falla") {
      return Promise.resolve(err({ tipo: "Inesperado", sqlstate: null, mensaje: "x" } as const));
    }
    const tx = {
      cartas: {
        codigosDeLaEmpresa: (empresa: string, tope: number) => {
          pedidas.push({ empresa, tope });
          return Promise.resolve(candidatas);
        },
        // Ninguna candidata se sirve: el unitario solo mira lo que se pide.
        porCodigo: () => Promise.resolve(null),
      },
    } as unknown as TxPublicaDeCarta;
    return trabajo(tx).then((valor) => ok(valor));
  });
  const vidriera = crearVidrieraPublica({ leer } as never, reloj, catalogos);
  return { vidriera, leer, pedidas };
}

describe("listarDelHost", () => {
  it("un host de la marca devuelve vacío sin abrir ninguna transacción", async () => {
    const { vidriera, leer } = armar(["x"]);
    expect(await vidriera.listarDelHost({ marcaId: MARCA, duenio: { tipo: "MARCA" } })).toEqual([]);
    expect(leer).not.toHaveBeenCalled();
  });

  it("un host de empresa pide las candidatas de ESA empresa con el tope", async () => {
    const { vidriera, pedidas } = armar([]);
    await vidriera.listarDelHost({
      marcaId: MARCA,
      duenio: { tipo: "EMPRESA", empresaId: EMPRESA },
    });
    expect(pedidas).toEqual([{ empresa: EMPRESA, tope: TOPE_DE_CARTAS_DE_LA_RAIZ }]);
    expect(TOPE_DE_CARTAS_DE_LA_RAIZ).toBe(20);
  });

  it("un fallo de la base se lanza, no sale como lista vacía", async () => {
    const { vidriera } = armar("falla");
    await expect(
      vidriera.listarDelHost({ marcaId: MARCA, duenio: { tipo: "EMPRESA", empresaId: EMPRESA } }),
    ).rejects.toThrow("no se pudo leer la lista de cartas");
  });
});
