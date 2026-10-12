import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { nivelParaLoNuevo } from "./niveles";

/** Una escalera de ejemplo con códigos en mayúsculas del módulo (reglas transversales §7.11). */
type Momento = "AL_COBRAR" | "AL_SOLICITAR" | "AL_CERRAR";
const NIVELES: readonly Momento[] = ["AL_COBRAR", "AL_SOLICITAR", "AL_CERRAR"];

describe("nivelParaLoNuevo: la matriz", () => {
  it("sin elección, el estándar (aunque haya otros habilitados)", () => {
    expect(
      nivelParaLoNuevo({
        estandar: "AL_COBRAR",
        elegido: null,
        habilitados: new Set<Momento>(["AL_COBRAR", "AL_SOLICITAR"]),
      }),
    ).toBe("AL_COBRAR");
  });

  it("elegido y habilitado: el elegido", () => {
    expect(
      nivelParaLoNuevo({
        estandar: "AL_COBRAR",
        elegido: "AL_SOLICITAR",
        habilitados: new Set<Momento>(["AL_COBRAR", "AL_SOLICITAR"]),
      }),
    ).toBe("AL_SOLICITAR");
  });

  it("elegido pero ya no habilitado (bajó el plan): el estándar", () => {
    expect(
      nivelParaLoNuevo({
        estandar: "AL_COBRAR",
        elegido: "AL_SOLICITAR",
        habilitados: new Set<Momento>(["AL_COBRAR"]),
      }),
    ).toBe("AL_COBRAR");
  });

  it("elegir el estándar devuelve el estándar", () => {
    expect(
      nivelParaLoNuevo({
        estandar: "AL_COBRAR",
        elegido: "AL_COBRAR",
        habilitados: new Set<Momento>(["AL_COBRAR"]),
      }),
    ).toBe("AL_COBRAR");
  });

  it("una elección ausente nunca se busca entre los habilitados", () => {
    // Un conjunto armado a mano con `null` adentro no puede hacer que «sin elección» devuelva null.
    const habilitados = new Set<Momento | null>(["AL_COBRAR", null]) as ReadonlySet<Momento>;
    expect(nivelParaLoNuevo({ estandar: "AL_COBRAR", elegido: null, habilitados })).toBe(
      "AL_COBRAR",
    );
  });

  it("no modifica el conjunto de habilitados", () => {
    const habilitados = new Set<Momento>(["AL_COBRAR", "AL_CERRAR"]);
    nivelParaLoNuevo({ estandar: "AL_COBRAR", elegido: "AL_CERRAR", habilitados });
    expect([...habilitados]).toEqual(["AL_COBRAR", "AL_CERRAR"]);
  });
});

describe("nivelParaLoNuevo: propiedades", () => {
  const escalera = fc
    .record({
      estandar: fc.constantFrom(...NIVELES),
      elegido: fc.option(fc.constantFrom(...NIVELES), { nil: null }),
      otros: fc.subarray([...NIVELES]),
    })
    .map(({ estandar, elegido, otros }) => ({
      estandar,
      elegido,
      // El estándar está siempre habilitado.
      habilitados: new Set<Momento>([estandar, ...otros]),
    }));

  it("siempre devuelve un nivel habilitado", () => {
    fc.assert(
      fc.property(escalera, (e) => {
        expect(e.habilitados.has(nivelParaLoNuevo(e))).toBe(true);
      }),
    );
  });

  it("devuelve la elección si está habilitada y, si no, el estándar", () => {
    fc.assert(
      fc.property(escalera, (e) => {
        const esperado =
          e.elegido !== null && e.habilitados.has(e.elegido) ? e.elegido : e.estandar;
        expect(nivelParaLoNuevo(e)).toBe(esperado);
      }),
    );
  });

  it("quitar habilitaciones nunca deja un nivel que ya no esté: cae al estándar", () => {
    fc.assert(
      fc.property(escalera, fc.subarray([...NIVELES]), (e, quedan) => {
        const habilitados = new Set<Momento>([e.estandar, ...quedan]);
        const nivel = nivelParaLoNuevo({ ...e, habilitados });
        expect(habilitados.has(nivel)).toBe(true);
        if (e.elegido !== null && !habilitados.has(e.elegido)) expect(nivel).toBe(e.estandar);
      }),
    );
  });

  it("es una función de sus tres datos: repetirla da lo mismo", () => {
    fc.assert(
      fc.property(escalera, (e) => {
        expect(nivelParaLoNuevo(e)).toBe(nivelParaLoNuevo(e));
      }),
    );
  });
});
