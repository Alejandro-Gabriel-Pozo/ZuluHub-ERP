import { describe, expect, it } from "vitest";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  codigoDe,
  correrEnParalelo,
  esConcurrenciaAgotada,
  perdedorAceptable,
  reintentarSiAgotada,
} from "./concurrencia-apoyo";

const AGOTADA = err({ tipo: "ConcurrenciaAgotada" as const });
type Cualquiera = Resultado<unknown, unknown>;

describe("concurrencia-apoyo: esConcurrenciaAgotada y codigoDe", () => {
  it("reconoce solo el error tipado del adaptador", () => {
    expect(esConcurrenciaAgotada({ tipo: "ConcurrenciaAgotada" })).toBe(true);
    for (const otro of [
      "ConcurrenciaAgotada",
      { tipo: "Unica" },
      { codigo: "ConcurrenciaAgotada" },
      null,
      undefined,
      42,
    ]) {
      expect(esConcurrenciaAgotada(otro), JSON.stringify(otro)).toBe(false);
    }
  });

  it("codigoDe: ok, el texto del error, el tipo de un error tipado u otro", () => {
    expect(codigoDe(ok(1))).toBe("ok");
    expect(codigoDe(err("YA_HAY_BORRADOR"))).toBe("YA_HAY_BORRADOR");
    expect(codigoDe(AGOTADA)).toBe("ConcurrenciaAgotada");
    expect(codigoDe(err({ codigo: "X" }))).toBe("otro");
    expect(codigoDe(err(null))).toBe("otro");
  });
});

describe("concurrencia-apoyo: perdedorAceptable", () => {
  it("un ganador y un perdedor agotado pasa, y cuenta las agotadas", () => {
    expect(perdedorAceptable([ok(1), AGOTADA], { esperados: [] })).toEqual({
      ganadores: 1,
      agotadas: 1,
    });
  });

  it("un ganador y un perdedor con un error de negocio esperado pasa", () => {
    expect(
      perdedorAceptable([err("YA_HAY_BORRADOR"), ok(1), AGOTADA], {
        esperados: ["YA_HAY_BORRADOR"],
      }),
    ).toEqual({ ganadores: 1, agotadas: 1 });
  });

  it("todos ganan (el doble clic idempotente) pasa sin agotadas", () => {
    expect(perdedorAceptable([ok(1), ok(1)], { esperados: [] })).toEqual({
      ganadores: 2,
      agotadas: 0,
    });
  });

  it("si todos pierden por agotamiento FALLA: nadie ganó", () => {
    expect(() => perdedorAceptable([AGOTADA, AGOTADA, AGOTADA], { esperados: [] })).toThrow(
      /nadie ganó/,
    );
  });

  it("si nadie ganó pero hay perdedores de negocio esperados también FALLA", () => {
    expect(() =>
      perdedorAceptable([err("YA_HAY_BORRADOR"), AGOTADA], { esperados: ["YA_HAY_BORRADOR"] }),
    ).toThrow(/nadie ganó/);
  });

  it("un error distinto del esperado no se acepta y se muestra el error real", () => {
    const resultados: Cualquiera[] = [ok(1), err({ tipo: "Inesperado", mensaje: "se cayó" })];
    expect(() => perdedorAceptable(resultados, { esperados: ["YA_HAY_BORRADOR"] })).toThrow(
      /Inesperado.*se cayó/,
    );
    expect(() =>
      perdedorAceptable([ok(1), err("OTRO")], { esperados: ["YA_HAY_BORRADOR"] }),
    ).toThrow(/OTRO/);
  });

  it("sin esperados, un error de negocio tampoco se acepta", () => {
    expect(() => perdedorAceptable([ok(1), err("YA_HAY_BORRADOR")], { esperados: [] })).toThrow(
      /YA_HAY_BORRADOR/,
    );
  });

  it("sin resultados falla, y el contexto encabeza el mensaje", () => {
    expect(() => perdedorAceptable([], { esperados: [] })).toThrow(/ningún resultado/);
    expect(() => perdedorAceptable([AGOTADA], { esperados: [], contexto: "ronda 3" })).toThrow(
      /^ronda 3: nadie ganó/,
    );
  });
});

describe("concurrencia-apoyo: reintentarSiAgotada", () => {
  it("repite con la misma entrada solo ante ConcurrenciaAgotada y devuelve el valor", async () => {
    const entradas: string[] = [];
    const entrada = "la-misma-clave";
    let llamadas = 0;
    const valor = await reintentarSiAgotada(() => {
      entradas.push(entrada);
      llamadas += 1;
      return Promise.resolve(llamadas < 3 ? AGOTADA : ok("listo"));
    });
    expect(valor).toBe("listo");
    expect(llamadas).toBe(3);
    expect(entradas).toEqual([entrada, entrada, entrada]);
  });

  it("ante cualquier otro error no reintenta y falla mostrando el error real", async () => {
    let llamadas = 0;
    await expect(
      reintentarSiAgotada(
        () => {
          llamadas += 1;
          return Promise.resolve(err({ codigo: "LIMITE_DEL_PLAN", limite: 2n }));
        },
        { contexto: "no emitió" },
      ),
    ).rejects.toThrow(/^no emitió: falló: .*LIMITE_DEL_PLAN.*"2"/);
    expect(llamadas).toBe(1);
    await expect(reintentarSiAgotada(() => Promise.resolve(err("SERIE_OCUPADA")))).rejects.toThrow(
      /SERIE_OCUPADA/,
    );
  });

  it("si el agotamiento persiste falla al llegar al tope (tope reintentos, tope + 1 intentos)", async () => {
    let llamadas = 0;
    await expect(
      reintentarSiAgotada(
        () => {
          llamadas += 1;
          return Promise.resolve(AGOTADA);
        },
        { tope: 4 },
      ),
    ).rejects.toThrow(/persistió tras 4 reintentos/);
    expect(llamadas).toBe(5);
  });

  it("con tope 0 no reintenta", async () => {
    let llamadas = 0;
    await expect(
      reintentarSiAgotada(
        () => {
          llamadas += 1;
          return Promise.resolve(AGOTADA);
        },
        { tope: 0 },
      ),
    ).rejects.toThrow(/persistió/);
    expect(llamadas).toBe(1);
  });
});

describe("concurrencia-apoyo: correrEnParalelo", () => {
  it("lanza n llamadas a la vez con su índice y devuelve los resultados en orden", async () => {
    expect(await correrEnParalelo(3, (i) => Promise.resolve(i * 10))).toEqual([0, 10, 20]);
  });

  it("deja puesta la barrera mientras corren y la quita al terminar", async () => {
    const vistas: ((() => Promise<void>) | null)[] = [];
    let enCurso: (() => Promise<void>) | null = null;
    const fijar = (b: (() => Promise<void>) | null) => {
      enCurso = b;
      vistas.push(b);
    };
    const durante: boolean[] = [];
    await correrEnParalelo(
      2,
      async () => {
        durante.push(enCurso !== null);
        await enCurso?.();
      },
      fijar,
    );
    expect(durante).toEqual([true, true]);
    expect(vistas).toHaveLength(2);
    expect(vistas[1]).toBeNull();
  });

  it("quita la barrera aunque una llamada falle", async () => {
    let enCurso: (() => Promise<void>) | null = null;
    await expect(
      correrEnParalelo(
        2,
        (i) => (i === 1 ? Promise.reject(new Error("se cayó")) : Promise.resolve()),
        (b) => {
          enCurso = b;
        },
      ),
    ).rejects.toThrow("se cayó");
    expect(enCurso).toBeNull();
  });
});
