import { describe, expect, it } from "vitest";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  agotadaEnElResultado,
  agotadaSegunElRegistro,
  codigoDe,
  correrEnParalelo,
  esConcurrenciaAgotada,
  perdedorAceptable,
  reintentarSiAgotada,
  repetirSiAgotada,
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

describe("concurrencia-apoyo: agotadaEnElResultado", () => {
  it("solo el error tipado de agotamiento; un éxito o un error de negocio no", () => {
    expect(agotadaEnElResultado(AGOTADA)).toBe(true);
    expect(agotadaEnElResultado(ok(1))).toBe(false);
    expect(agotadaEnElResultado(err("ConcurrenciaAgotada"))).toBe(false);
    expect(agotadaEnElResultado(err({ tipo: "Unicidad" }))).toBe(false);
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

describe("concurrencia-apoyo: repetirSiAgotada y agotadaSegunElRegistro", () => {
  it("repite con la misma entrada mientras agota y devuelve el resultado, éxito o error de negocio", async () => {
    let llamadas = 0;
    const r = await repetirSiAgotada(
      () => {
        llamadas += 1;
        return Promise.resolve<Cualquiera>(llamadas < 3 ? AGOTADA : err("YA_HAY_BORRADOR"));
      },
      { esAgotada: agotadaEnElResultado },
    );
    expect(r).toEqual(err("YA_HAY_BORRADOR"));
    expect(llamadas).toBe(3);
    expect(
      await repetirSiAgotada(() => Promise.resolve(ok(7)), { esAgotada: agotadaEnElResultado }),
    ).toEqual(ok(7));
  });

  it("si el agotamiento persiste falla al llegar al tope, con el contexto", async () => {
    let llamadas = 0;
    await expect(
      repetirSiAgotada(
        () => {
          llamadas += 1;
          return Promise.resolve<Cualquiera>(AGOTADA);
        },
        { esAgotada: agotadaEnElResultado, tope: 2, contexto: "ronda 1" },
      ),
    ).rejects.toThrow(/^ronda 1: ConcurrenciaAgotada persistió tras 2 reintentos/);
    expect(llamadas).toBe(3);
  });

  describe("en la web: el agotamiento sale como ERROR_INTERNO y solo lo delata el registro", () => {
    const interno = (referencia: string | undefined) => ({
      ok: false,
      error: { codigo: "ERROR_INTERNO", ...(referencia === undefined ? {} : { referencia }) },
    });

    it("reconoce ERROR_INTERNO cuya referencia está registrada con ConcurrenciaAgotada", () => {
      const registro = ["PD-AAAA ConcurrenciaAgotada"];
      const esAgotada = agotadaSegunElRegistro(registro);
      expect(esAgotada(interno("PD-AAAA"))).toBe(true);
      // El registro es una lista viva: lo que se registra después también cuenta.
      registro.push("PD-BBBB ConcurrenciaAgotada");
      expect(esAgotada(interno("PD-BBBB"))).toBe(true);
    });

    it("NO reconoce otro error interno, otra referencia, otro código, un éxito ni una respuesta sin referencia", () => {
      const esAgotada = agotadaSegunElRegistro([
        "PD-AAAA ConcurrenciaAgotada",
        "PD-CCCC Error: se cayó la base",
        "PD-DDDD ConcurrenciaAgotada con detalle de más",
      ]);
      expect(esAgotada(interno("PD-CCCC"))).toBe(false);
      expect(esAgotada(interno("PD-DDDD"))).toBe(false);
      expect(esAgotada(interno("PD-ZZZZ"))).toBe(false);
      expect(esAgotada(interno(undefined))).toBe(false);
      expect(esAgotada({ ok: false, error: { codigo: "FISCAL_PEDIDO_REPETIDO" } })).toBe(false);
      expect(
        esAgotada({ ok: false, error: { codigo: "NO_DISPONIBLE", referencia: "PD-AAAA" } }),
      ).toBe(false);
      expect(esAgotada({ ok: true })).toBe(false);
    });

    it("con repetirSiAgotada: repite el agotamiento y deja pasar un error interno real", async () => {
      const registro = ["PD-AAAA ConcurrenciaAgotada", "PD-CCCC Error: se cayó la base"];
      let llamadas = 0;
      const r = await repetirSiAgotada(
        () => {
          llamadas += 1;
          return Promise.resolve(llamadas === 1 ? interno("PD-AAAA") : interno("PD-CCCC"));
        },
        { esAgotada: agotadaSegunElRegistro(registro) },
      );
      expect(r).toEqual(interno("PD-CCCC"));
      expect(llamadas).toBe(2);
    });
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
