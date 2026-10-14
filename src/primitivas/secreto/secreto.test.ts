import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Secreto } from "./secreto";

const CLAVE = "-----BEGIN PRIVATE KEY-----\nclave-de-prueba\n-----END PRIVATE KEY-----";

describe("Secreto", () => {
  it("revelar devuelve el texto tal cual (es la única vía de salida)", () => {
    expect(new Secreto(CLAVE).revelar()).toBe(CLAVE);
    expect(new Secreto("").revelar()).toBe("");
  });

  it("ninguna otra vía lo muestra: JSON, texto, plantilla, inspect, volcado de un objeto y de un error", () => {
    const secreto = new Secreto(CLAVE);
    expect(JSON.stringify(secreto)).toBe('"[secreto]"');
    expect(JSON.stringify({ clave: secreto, lista: [secreto] })).toBe(
      '{"clave":"[secreto]","lista":["[secreto]"]}',
    );
    expect(String(secreto)).toBe("[secreto]");
    expect(`${secreto.toString()}`).toBe("[secreto]");
    expect(inspect(secreto)).toBe("[secreto]");
    expect(inspect({ dentro: secreto }, { depth: 5 })).toBe("{ dentro: [secreto] }");
    expect(Object.keys(secreto)).toEqual([]);
    expect(Object.getOwnPropertyNames(secreto)).toEqual([]);
    const error = new Error("falló", { cause: secreto });
    expect(inspect(error)).not.toContain("clave-de-prueba");
  });

  it("dos secretos se comparan con esIgualA, no con toEqual (lo privado no se ve)", () => {
    expect(new Secreto("a").esIgualA(new Secreto("a"))).toBe(true);
    expect(new Secreto("a").esIgualA(new Secreto("b"))).toBe(false);
  });
});
