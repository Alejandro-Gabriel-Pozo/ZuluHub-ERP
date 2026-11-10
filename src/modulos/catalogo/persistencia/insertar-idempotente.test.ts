import { describe, expect, it } from "vitest";
import { insertarIdempotente } from "./insertar-idempotente";

describe("insertarIdempotente", () => {
  it("si el primer intento inserta, devuelve la fila y no hace nada más", async () => {
    const llamadas: string[] = [];
    const fila = await insertarIdempotente(
      () => {
        llamadas.push("intentar");
        return Promise.resolve("fila");
      },
      () => {
        llamadas.push("yaExiste");
        return Promise.resolve(true);
      },
      () => {
        llamadas.push("estricto");
        return Promise.resolve("otra");
      },
    );
    expect(fila).toBe("fila");
    expect(llamadas).toEqual(["intentar"]);
  });

  it("si no insertó y el id ya existía, es una repetición: undefined y sin repetir el alta", async () => {
    const llamadas: string[] = [];
    const fila = await insertarIdempotente(
      () => Promise.resolve(undefined),
      () => Promise.resolve(true),
      () => {
        llamadas.push("estricto");
        return Promise.resolve("otra");
      },
    );
    expect(fila).toBeUndefined();
    expect(llamadas).toEqual([]);
  });

  it("si no insertó y el id no existe, repite el alta estricta y deja pasar lo que lance (la unicidad real)", async () => {
    await expect(
      insertarIdempotente(
        () => Promise.resolve(undefined),
        () => Promise.resolve(false),
        () => Promise.reject(new Error("unicidad")),
      ),
    ).rejects.toThrow("unicidad");
    expect(
      await insertarIdempotente(
        () => Promise.resolve(undefined),
        () => Promise.resolve(false),
        () => Promise.resolve("fila"),
      ),
    ).toBe("fila");
  });
});
