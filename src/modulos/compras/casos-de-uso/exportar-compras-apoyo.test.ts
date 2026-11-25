import { describe, expect, it } from "vitest";
import { agrupar, enTandas, TAMANO_DE_TANDA_DE_LOS_IDS } from "./exportar-compras-apoyo";

describe("agrupar", () => {
  it("da lo mismo que filtrar la lista por cada clave, en el mismo orden", () => {
    const filas = Array.from({ length: 200 }, (_, i) => ({ k: `c${i % 7}`, i }));
    const grupos = agrupar(filas, (f) => f.k);
    expect([...grupos.keys()].sort()).toEqual([...new Set(filas.map((f) => f.k))].sort());
    for (const [k, lista] of grupos) expect(lista).toEqual(filas.filter((f) => f.k === k));
  });
  it("una lista vacía no tiene grupos y una clave que no está no devuelve nada", () => {
    expect(agrupar([], (x: string) => x).size).toBe(0);
    expect(agrupar(["a"], (x) => x).get("b")).toBeUndefined();
  });
});

describe("enTandas", () => {
  it("parte los ids en tandas del tamaño fijado, sin perder ni repetir ninguno y en orden", async () => {
    const ids = Array.from({ length: TAMANO_DE_TANDA_DE_LOS_IDS * 2 + 3 }, (_, i) => i);
    const tamanos: number[] = [];
    const salida = await enTandas(ids, (parte) => {
      tamanos.push(parte.length);
      return Promise.resolve(parte.map((n) => n * 2));
    });
    expect(tamanos).toEqual([TAMANO_DE_TANDA_DE_LOS_IDS, TAMANO_DE_TANDA_DE_LOS_IDS, 3]);
    expect(salida).toEqual(ids.map((n) => n * 2));
  });
  it("sin ids no consulta nada; con uno solo hace una consulta", async () => {
    let llamadas = 0;
    const leer = (p: readonly number[]) => {
      llamadas += 1;
      return Promise.resolve(p);
    };
    expect(await enTandas([], leer)).toEqual([]);
    expect(llamadas).toBe(0);
    expect(await enTandas([1], leer)).toEqual([1]);
    expect(llamadas).toBe(1);
  });
  it("el tope de la tanda queda por debajo de los 65.535 parámetros de una consulta", () => {
    expect(TAMANO_DE_TANDA_DE_LOS_IDS).toBeLessThan(65_535);
  });
});
