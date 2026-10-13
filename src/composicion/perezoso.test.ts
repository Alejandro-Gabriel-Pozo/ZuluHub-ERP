import { describe, expect, it } from "vitest";
import { perezoso } from "./perezoso";

describe("perezoso", () => {
  it("no crea nada hasta que se pide", () => {
    let creados = 0;
    perezoso(() => ++creados);
    expect(creados).toBe(0);
  });

  it("crea una sola vez y devuelve siempre la misma instancia", () => {
    let creados = 0;
    const obtener = perezoso(() => ({ n: ++creados }));
    const a = obtener();
    expect(obtener()).toBe(a);
    expect(obtener()).toBe(a);
    expect(creados).toBe(1);
  });

  it("dos pedidos simultáneos comparten una sola instancia", async () => {
    let creados = 0;
    const obtener = perezoso(() => ({ n: ++creados }));
    const [a, b, c] = await Promise.all([
      Promise.resolve().then(obtener),
      Promise.resolve().then(obtener),
      Promise.resolve().then(obtener),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(creados).toBe(1);
  });

  it("memoriza también un valor que parece vacío (undefined, null, 0, cadena vacía)", () => {
    for (const valor of [undefined, null, 0, "", false]) {
      let creados = 0;
      const obtener = perezoso(() => {
        creados++;
        return valor;
      });
      expect(obtener()).toBe(valor);
      expect(obtener()).toBe(valor);
      expect(creados).toBe(1);
    }
  });

  it("si crear lanza, no memoriza el fallo: el próximo pedido lo intenta de nuevo", () => {
    let intentos = 0;
    const obtener = perezoso(() => {
      intentos++;
      if (intentos === 1) throw new Error("todavía no");
      return "listo";
    });
    expect(() => obtener()).toThrow("todavía no");
    expect(obtener()).toBe("listo");
    expect(obtener()).toBe("listo");
    expect(intentos).toBe(2);
  });
});
