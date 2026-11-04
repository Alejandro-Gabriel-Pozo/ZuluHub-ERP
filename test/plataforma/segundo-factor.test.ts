import { describe, expect, it, vi } from "vitest";
import { CANCELADO, conSegundoFactor } from "../../apps/plataforma/logica/segundo-factor";

type Resultado = "BIEN" | "PIDE";
const pide = (r: Resultado): boolean => r === "PIDE";

describe("conSegundoFactor", () => {
  it("sin pedido de código corre una sola vez y nunca pide el código", async () => {
    const intento = vi.fn(() => Promise.resolve<Resultado>("BIEN"));
    const pedirCodigo = vi.fn(() => Promise.resolve(true));
    const r = await conSegundoFactor({ intento, pideCodigo: pide, pedirCodigo });
    expect(r).toBe("BIEN");
    expect(intento).toHaveBeenCalledTimes(1);
    expect(pedirCodigo).not.toHaveBeenCalled();
  });

  it("pide el código y repite el mismo intento", async () => {
    const respuestas: Resultado[] = ["PIDE", "BIEN"];
    const intento = vi.fn(() => Promise.resolve(respuestas.shift() ?? "BIEN"));
    const pedirCodigo = vi.fn(() => Promise.resolve(true));
    const r = await conSegundoFactor({ intento, pideCodigo: pide, pedirCodigo });
    expect(r).toBe("BIEN");
    expect(intento).toHaveBeenCalledTimes(2);
    expect(pedirCodigo).toHaveBeenCalledTimes(1);
  });

  it("si la persona cancela devuelve CANCELADO y no reintenta", async () => {
    const intento = vi.fn(() => Promise.resolve<Resultado>("PIDE"));
    const pedirCodigo = vi.fn(() => Promise.resolve(false));
    const r = await conSegundoFactor({ intento, pideCodigo: pide, pedirCodigo });
    expect(r).toBe(CANCELADO);
    expect(intento).toHaveBeenCalledTimes(1);
    expect(pedirCodigo).toHaveBeenCalledTimes(1);
  });

  it("si siempre pide, corta en el tope y devuelve el último resultado", async () => {
    const intento = vi.fn(() => Promise.resolve<Resultado>("PIDE"));
    const pedirCodigo = vi.fn(() => Promise.resolve(true));
    const r = await conSegundoFactor({ intento, pideCodigo: pide, pedirCodigo });
    expect(r).toBe("PIDE");
    expect(pedirCodigo).toHaveBeenCalledTimes(2);
    expect(intento).toHaveBeenCalledTimes(3);
  });

  it("respeta un tope propio", async () => {
    const intento = vi.fn(() => Promise.resolve<Resultado>("PIDE"));
    const pedirCodigo = vi.fn(() => Promise.resolve(true));
    const r = await conSegundoFactor({
      intento,
      pideCodigo: pide,
      pedirCodigo,
      maximoDeCodigos: 1,
    });
    expect(r).toBe("PIDE");
    expect(pedirCodigo).toHaveBeenCalledTimes(1);
    expect(intento).toHaveBeenCalledTimes(2);
  });

  it("propaga la excepción del intento", async () => {
    const intento = vi.fn(() => Promise.reject(new Error("se cortó")));
    const pedirCodigo = vi.fn(() => Promise.resolve(true));
    await expect(
      conSegundoFactor<Resultado>({ intento, pideCodigo: pide, pedirCodigo }),
    ).rejects.toThrow("se cortó");
    expect(pedirCodigo).not.toHaveBeenCalled();
  });

  it("propaga la excepción del reintento tras el código", async () => {
    let llamadas = 0;
    const intento = vi.fn(() => {
      llamadas += 1;
      return llamadas === 1
        ? Promise.resolve<Resultado>("PIDE")
        : Promise.reject(new Error("falló"));
    });
    await expect(
      conSegundoFactor({ intento, pideCodigo: pide, pedirCodigo: () => Promise.resolve(true) }),
    ).rejects.toThrow("falló");
  });
});
