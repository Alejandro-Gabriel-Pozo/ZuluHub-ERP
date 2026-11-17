import { describe, expect, it } from "vitest";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  UNICAS_DE_LA_ANULACION,
  UNICAS_DE_LA_APERTURA,
  UNICAS_DEL_MOVIMIENTO,
  repetirSiOtroGano,
} from "./comun";

/**
 * Dos pedidos iguales a la vez que chocan en una restricción única: el caso se vuelve a correr UNA vez (el otro ya ganó y la segunda
 * vuelta ve lo hecho). Todo lo demás sale como vino. Previene que el doble clic devuelva un error de persistencia en vez de «ya estaba».
 */

const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

/** Un caso que devuelve, en orden, los resultados dados, y cuenta cuántas veces se corrió. */
function caso(...resultados: Resultado<string, string | ErrorDePersistencia>[]) {
  let corridas = 0;
  return {
    correr: () => {
      const resultado = resultados[Math.min(corridas, resultados.length - 1)];
      corridas += 1;
      return Promise.resolve(resultado as Resultado<string, string | ErrorDePersistencia>);
    },
    corridas: () => corridas,
  };
}

describe("repetirSiOtroGano", () => {
  it("un éxito sale tal cual y no se repite", async () => {
    const c = caso(ok("hecho"));
    expect(await repetirSiOtroGano(c.correr, ["x_uk"])).toEqual(ok("hecho"));
    expect(c.corridas()).toBe(1);
  });

  it("un choque con una única de la lista se repite una vez y devuelve la segunda vuelta", async () => {
    const c = caso(err(unicidad("x_uk")), ok("ya estaba"));
    expect(await repetirSiOtroGano(c.correr, ["otra_uk", "x_uk"])).toEqual(ok("ya estaba"));
    expect(c.corridas()).toBe(2);
    const d = caso(err(unicidad("x_uk")), err("CAJA_YA_ABIERTA"));
    expect(await repetirSiOtroGano(d.correr, ["x_uk"])).toEqual(err("CAJA_YA_ABIERTA"));
    expect(d.corridas()).toBe(2);
  });

  it("una segunda unicidad no se vuelve a repetir: sale como el error tipado que es", async () => {
    const c = caso(err(unicidad("x_uk")), err(unicidad("x_uk")), ok("nunca"));
    expect(await repetirSiOtroGano(c.correr, ["x_uk"])).toEqual(err(unicidad("x_uk")));
    expect(c.corridas()).toBe(2);
  });

  it("una unicidad de otra restricción, sin nombre, o cualquier otro error, no se repite", async () => {
    for (const error of [
      unicidad("ajena_uk"),
      unicidad(null),
      { tipo: "Check", restriccion: "x_uk" } as const,
      { tipo: "ConcurrenciaAgotada" } as const,
      "SESION_CERRADA",
    ]) {
      const c = caso(err(error), ok("no"));
      expect(await repetirSiOtroGano(c.correr, ["x_uk"]), JSON.stringify(error)).toEqual(
        err(error),
      );
      expect(c.corridas(), JSON.stringify(error)).toBe(1);
    }
  });

  it("los errores de negocio que son objetos con `tipo` ajeno no se confunden con una unicidad", async () => {
    const c = caso(
      err({ codigo: "CAJA_YA_ABIERTA", sesionId: "s" } as unknown as string),
      ok("no"),
    );
    expect((await repetirSiOtroGano(c.correr, ["x_uk"])).ok).toBe(false);
    expect(c.corridas()).toBe(1);
  });

  it("las listas de cada operación: la apertura (clave y una sesión por caja), el movimiento (clave) y la anulación (clave y una vez)", () => {
    expect([...UNICAS_DE_LA_APERTURA].sort()).toEqual([
      "sesion_caja_clave_uk",
      "sesion_caja_vigente_uk",
    ]);
    expect([...UNICAS_DEL_MOVIMIENTO]).toEqual(["movimiento_caja_clave_uk"]);
    expect([...UNICAS_DE_LA_ANULACION].sort()).toEqual([
      "movimiento_caja_anula_uk",
      "movimiento_caja_clave_uk",
    ]);
  });
});
