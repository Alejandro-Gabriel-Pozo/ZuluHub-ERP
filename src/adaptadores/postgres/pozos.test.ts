import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorDeConfiguracion } from "./errores";
import {
  CONEXIONES_POR_POZO,
  PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS,
  cantidadDePozosAbiertos,
  tomarPozo,
  type PozoTomado,
} from "./pozos";

/**
 * El registro de pozos: UN pozo por cadena (por rol) en cada proceso, que se cierra con el último que lo suelta. Estas pruebas no abren
 * ninguna conexión (un pozo de `pg` se conecta recién al pedir una); las de conexiones reales están en `test/integracion/pozo-por-rol.test.ts`.
 */

const APP = "postgres://pedernal_app:x@127.0.0.1:1/base";
const AUTENTICACION = "postgres://pedernal_autenticacion:x@127.0.0.1:1/base";

describe("tomarPozo", () => {
  const tomados: PozoTomado[] = [];
  const tomar = (...args: Parameters<typeof tomarPozo>) => {
    const t = tomarPozo(...args);
    tomados.push(t);
    return t;
  };
  afterEach(async () => {
    await Promise.all(tomados.splice(0).map((t) => t.soltar()));
    expect(cantidadDePozosAbiertos()).toBe(0);
  });

  it("la misma cadena (el mismo rol) comparte UN pozo; otra cadena (otro rol), no", () => {
    const a = tomar({ url: APP });
    const b = tomar({ url: APP });
    const otro = tomar({ url: AUTENTICACION });
    expect(b.pozo).toBe(a.pozo);
    expect(otro.pozo).not.toBe(a.pozo);
    expect(cantidadDePozosAbiertos()).toBe(2);
  });

  it("nace chico y con espera acotada: no abre conexiones de más y, agotado, falla cerrado en vez de colgarse", () => {
    const { pozo } = tomar({ url: APP });
    expect(pozo.options.max).toBe(CONEXIONES_POR_POZO);
    expect(CONEXIONES_POR_POZO).toBeGreaterThanOrEqual(2);
    expect(CONEXIONES_POR_POZO).toBeLessThanOrEqual(3);
    expect(pozo.options.connectionTimeoutMillis).toBe(PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS);
    const propio = tomar({
      url: AUTENTICACION,
      maximoDeConexiones: 1,
      plazoParaConseguirConexionEnMs: 50,
    });
    expect(propio.pozo.options.max).toBe(1);
    expect(propio.pozo.options.connectionTimeoutMillis).toBe(50);
  });

  it("dos usos de la misma cadena con topes distintos no se pisan (solo pasa en pruebas)", () => {
    const a = tomar({ url: APP, maximoDeConexiones: 2 });
    const b = tomar({ url: APP, maximoDeConexiones: 4 });
    expect(b.pozo).not.toBe(a.pozo);
    expect(a.pozo.options.max).toBe(2);
    expect(b.pozo.options.max).toBe(4);
  });

  it("soltar un uso no cierra el pozo de los demás; el último en soltar lo cierra y lo saca del registro", async () => {
    const a = tomar({ url: APP });
    const b = tomar({ url: APP });
    await a.soltar();
    expect(a.pozo.ended).toBe(false);
    expect(cantidadDePozosAbiertos()).toBe(1);
    await b.soltar();
    expect(b.pozo.ended).toBe(true);
    expect(cantidadDePozosAbiertos()).toBe(0);
    // Uno nuevo de la misma cadena empieza de cero (otro pozo), no reabre el cerrado.
    const nuevo = tomar({ url: APP });
    expect(nuevo.pozo).not.toBe(a.pozo);
    expect(nuevo.pozo.ended).toBe(false);
  });

  it("soltar dos veces es lo mismo que una: no le quita el pozo a otro", async () => {
    const a = tomar({ url: APP });
    const b = tomar({ url: APP });
    await a.soltar();
    await a.soltar();
    await a.paraKysely.end();
    expect(b.pozo.ended).toBe(false);
    expect(cantidadDePozosAbiertos()).toBe(1);
  });

  it("el `end` que se le da a Kysely suelta ese uso, no cierra el pozo de todos", async () => {
    const a = tomar({ url: APP });
    const b = tomar({ url: APP });
    await a.paraKysely.end();
    expect(b.pozo.ended).toBe(false);
    await b.paraKysely.end();
    expect(b.pozo.ended).toBe(true);
  });

  it("el corte de una conexión ociosa se avisa a todos los que usan el pozo, y deja de avisarse a quien lo soltó", async () => {
    const avisoA = vi.fn();
    const avisoB = vi.fn();
    const a = tomar({ url: APP, alCortarseUnaConexionOciosa: avisoA });
    tomar({ url: APP, alCortarseUnaConexionOciosa: avisoB });
    const falla = new Error("conexión cortada");
    a.pozo.emit("error", falla, undefined);
    expect(avisoA).toHaveBeenCalledWith(falla);
    expect(avisoB).toHaveBeenCalledWith(falla);
    await a.soltar();
    a.pozo.emit("error", falla, undefined);
    expect(avisoA).toHaveBeenCalledTimes(1);
    expect(avisoB).toHaveBeenCalledTimes(2);
  });

  it("sin oyente propio, el corte de una conexión ociosa no tira abajo el proceso", () => {
    const a = tomar({ url: APP });
    expect(() => a.pozo.emit("error", new Error("cortada"), undefined)).not.toThrow();
  });

  it("falla cerrado ante una cadena vacía o un tope que no sirve", () => {
    expect(() => tomarPozo({ url: "" })).toThrow(ErrorDeConfiguracion);
    for (const maximo of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tomarPozo({ url: APP, maximoDeConexiones: maximo }), String(maximo)).toThrow(
        RangeError,
      );
    }
    expect(cantidadDePozosAbiertos()).toBe(0);
  });
});
