import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  LETRAS_CON_ACENTO_DE_BUSQUEDA,
  LETRAS_SIN_ACENTO_DE_BUSQUEDA,
  claseDeCoincidencia,
  nombreCompletoDeParte,
  normalizarParaBusqueda,
  ordenarCoincidencias,
  type CandidatoDeBusqueda,
} from "./busqueda";

const candidato = (id: string, nombre: string, doc: string | null = null): CandidatoDeBusqueda => ({
  id,
  nombreDeBusqueda: nombre,
  documentoNormalizado: doc,
});

describe("normalizarParaBusqueda", () => {
  it("las dos listas de letras tienen el mismo largo (una por una)", () => {
    expect([...LETRAS_CON_ACENTO_DE_BUSQUEDA]).toHaveLength(
      [...LETRAS_SIN_ACENTO_DE_BUSQUEDA].length,
    );
  });

  it("pasa a minúsculas y saca tildes, diéresis, ñ y ç", () => {
    expect(normalizarParaBusqueda("PÉREZ Ñandú")).toBe("perez nandu");
    expect(normalizarParaBusqueda("Açaí Güemes Ùlt")).toBe("acai guemes ult");
    expect(normalizarParaBusqueda("ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ")).toBe("aaaaaeeeeiiiiooooouuuunc");
    expect(normalizarParaBusqueda("áàäâãéèëêíìïîóòöôõúùüûñç")).toBe("aaaaaeeeeiiiiooooouuuunc");
  });

  it("deja igual lo que ya está normalizado y lo que no tiene tilde", () => {
    expect(normalizarParaBusqueda("juan 123 & co.")).toBe("juan 123 & co.");
    expect(normalizarParaBusqueda("")).toBe("");
  });

  it("propiedad: es idempotente", () => {
    fc.assert(
      fc.property(fc.string(), (t) => {
        expect(normalizarParaBusqueda(normalizarParaBusqueda(t))).toBe(normalizarParaBusqueda(t));
      }),
    );
  });
});

describe("claseDeCoincidencia", () => {
  const c = candidato("1", "perez juan", "T30712345671");

  it("el documento idéntico gana aunque el nombre también coincida", () => {
    expect(claseDeCoincidencia(c, "perez", "T30712345671")).toBe("DOCUMENTO");
    expect(claseDeCoincidencia(c, "zzz", "T30712345671")).toBe("DOCUMENTO");
  });

  it("un documento distinto, o el candidato sin documento, no coincide por documento", () => {
    expect(claseDeCoincidencia(c, "zzz", "T20000000001")).toBeNull();
    expect(claseDeCoincidencia(candidato("2", "ana"), "zzz", "T30712345671")).toBeNull();
    expect(claseDeCoincidencia(candidato("2", "ana"), "ana", null)).toBe("EMPIEZA");
  });

  it("empieza, contiene y no coincide", () => {
    expect(claseDeCoincidencia(c, "perez", null)).toBe("EMPIEZA");
    expect(claseDeCoincidencia(c, "perez juan", null)).toBe("EMPIEZA");
    expect(claseDeCoincidencia(c, "juan", null)).toBe("CONTIENE");
    expect(claseDeCoincidencia(c, "ez j", null)).toBe("CONTIENE");
    expect(claseDeCoincidencia(c, "lopez", null)).toBeNull();
  });

  it("un texto vacío no coincide con nada (ni empieza ni contiene)", () => {
    expect(claseDeCoincidencia(c, "", null)).toBeNull();
    expect(claseDeCoincidencia(c, "", "T30712345671")).toBe("DOCUMENTO");
  });
});

describe("ordenarCoincidencias", () => {
  it("por clase, luego por nombre y luego por id", () => {
    const a = candidato("3", "ana");
    const b = candidato("1", "beto");
    const b2 = candidato("2", "beto");
    const c = candidato("4", "carlos");
    const d = candidato("9", "zoe");
    const resultado = ordenarCoincidencias([
      { clase: "CONTIENE", candidato: a },
      { clase: "EMPIEZA", candidato: c },
      { clase: "EMPIEZA", candidato: b2 },
      { clase: "DOCUMENTO", candidato: d },
      { clase: "EMPIEZA", candidato: b },
    ]);
    expect(resultado.map((x) => x.id)).toEqual(["9", "1", "2", "4", "3"]);
  });

  it("no cambia la lista de entrada y un orden ya correcto queda igual", () => {
    const entrada = [
      { clase: "DOCUMENTO", candidato: candidato("1", "a") },
      { clase: "EMPIEZA", candidato: candidato("2", "b") },
    ] as const;
    expect(ordenarCoincidencias(entrada).map((x) => x.id)).toEqual(["1", "2"]);
    expect(entrada.map((x) => x.candidato.id)).toEqual(["1", "2"]);
  });

  it("dos coincidencias idénticas conservan un orden estable por id", () => {
    const r = ordenarCoincidencias([
      { clase: "EMPIEZA", candidato: candidato("b", "x") },
      { clase: "EMPIEZA", candidato: candidato("a", "x") },
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("nombreCompletoDeParte", () => {
  it("apellido, nombre y alias separados por un espacio; sin blancos de más cuando falta alguno", () => {
    expect(nombreCompletoDeParte({ apellido: "Pérez", nombre: "Juan", alias: "Juancho" })).toBe(
      "Pérez Juan Juancho",
    );
    expect(
      nombreCompletoDeParte({ apellido: null, nombre: "Distribuidora Sur", alias: null }),
    ).toBe("Distribuidora Sur");
    expect(nombreCompletoDeParte({ apellido: "Pérez", nombre: "Juan", alias: null })).toBe(
      "Pérez Juan",
    );
    expect(nombreCompletoDeParte({ apellido: null, nombre: "Sur", alias: "El Sur" })).toBe(
      "Sur El Sur",
    );
    expect(nombreCompletoDeParte({ apellido: null, nombre: null, alias: null })).toBe("");
  });
});

describe("ordenarCoincidencias: propiedad", () => {
  const clase = fc.constantFrom("DOCUMENTO", "EMPIEZA", "CONTIENE" as const);
  const coincidencia = fc.record({
    clase,
    candidato: fc.record({
      id: fc.string({ minLength: 1, maxLength: 3, unit: fc.constantFrom("a", "b", "c") }),
      nombreDeBusqueda: fc.string({ maxLength: 3, unit: fc.constantFrom("a", "b", "c") }),
      documentoNormalizado: fc.constant(null),
    }),
  });

  it("devuelve las mismas coincidencias, ordenadas por clase, nombre e id", () => {
    const orden = { DOCUMENTO: 0, EMPIEZA: 1, CONTIENE: 2 } as const;
    fc.assert(
      fc.property(
        fc.uniqueArray(coincidencia, { selector: (c) => c.candidato.id, maxLength: 12 }),
        (coincidencias) => {
          const salida = ordenarCoincidencias(coincidencias);
          expect(salida.map((c) => c.id).sort()).toEqual(
            coincidencias.map((c) => c.candidato.id).sort(),
          );
          const claseDe = (id: string) =>
            coincidencias.find((c) => c.candidato.id === id)?.clase ?? "CONTIENE";
          for (let i = 1; i < salida.length; i++) {
            const a = salida[i - 1];
            const b = salida[i];
            if (a === undefined || b === undefined) throw new Error("hueco");
            const ca = orden[claseDe(a.id)];
            const cb = orden[claseDe(b.id)];
            const mal =
              ca > cb ||
              (ca === cb && a.nombreDeBusqueda > b.nombreDeBusqueda) ||
              (ca === cb && a.nombreDeBusqueda === b.nombreDeBusqueda && a.id > b.id);
            expect(mal, `${a.id} antes que ${b.id}`).toBe(false);
          }
        },
      ),
    );
  });
});
